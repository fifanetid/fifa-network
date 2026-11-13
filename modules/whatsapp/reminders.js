"use strict";

const { db } = require("../../database/db");
const { sendText } = require("./client");

const jakartaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const dateDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
const rupiah = (n) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

let running = false;

function reminderStage(daysUntilDue) {
  if (daysUntilDue === 3) return "h3";
  if (daysUntilDue === 0) return "due";
  if (daysUntilDue === -3) return "overdue3";
  if (daysUntilDue < -3 && (Math.abs(daysUntilDue) - 3) % 7 === 0) return "overdue" + Math.abs(daysUntilDue);
  return null;
}

function reminderStageLabel(daysUntilDue) {
  if (daysUntilDue === 3) return "H-3";
  if (daysUntilDue === 0) return "Jatuh tempo";
  if (daysUntilDue === -3) return "H+3";
  return daysUntilDue < -3 ? "H+" + Math.abs(daysUntilDue) : "-";
}

function maskPhone(value) {
  const phone = String(value || "").replace(/\D/g, "");
  if (phone.length < 7) return "••••";
  return phone.slice(0, 3) + "••••" + phone.slice(-4);
}

function collectReminderCandidates(today) {
  const rows = db.prepare(`
    SELECT i.id AS invoice_id, i.invoice_number, i.due_date, i.billing_period,
      i.total_idr, c.id AS customer_id, c.customer_code, c.full_name, c.phone,
      COALESCE((SELECT SUM(amount_idr) FROM payments WHERE invoice_id=i.id),0)
      - COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments p ON p.id=r.payment_id WHERE p.invoice_id=i.id),0) AS paid_idr
    FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE i.status IN ('unpaid','partial') AND c.status='active' AND c.whatsapp_opt_in=1
      AND i.due_date <= date(?, '+3 days')
    ORDER BY i.due_date ASC, i.id ASC
  `).all(today);

  const candidates = [];
  for (const row of rows) {
    const remaining = row.total_idr - row.paid_idr;
    if (remaining <= 0) continue;

    const days = dateDiff(row.due_date, today);
    const stage = reminderStage(days);
    if (!stage) continue;

    const key = row.invoice_id + ":" + stage;
    const exists = db.prepare("SELECT id,status FROM whatsapp_message_logs WHERE dedupe_key=?").get(key);
    candidates.push({
      ...row,
      remaining_idr: remaining,
      days_until_due: days,
      stage,
      stage_label: reminderStageLabel(days),
      dedupe_key: key,
      existing_log_id: exists?.id || null,
      already_sent: exists?.status === "sent",
      masked_phone: maskPhone(row.phone)
    });
  }

  return { checked: rows.length, candidates };
}

function getReminderPreview({ today = jakartaDate(), limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Batas pratinjau harus 1 sampai 100.");
  }

  const { checked, candidates } = collectReminderCandidates(today);
  const pending = candidates.filter((row) => !row.already_sent);
  return {
    date: today,
    checked,
    total: pending.length,
    previouslySent: candidates.length - pending.length,
    limit,
    candidates: pending.slice(0, limit).map(({ phone, ...row }) => row)
  };
}

async function processReminders({ today = jakartaDate(), limit = 20, delayMs = 5000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Batas pengiriman harus 1 sampai 100.");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60000) {
    throw new RangeError("Jeda pengiriman harus 0 sampai 60000 milidetik.");
  }
  if (running) return { checked: 0, sent: 0, failed: 0, skipped: 0, busy: true, date: today };
  running = true;
  try {
    const { checked, candidates } = collectReminderCandidates(today);
    let sent = 0, failed = 0, skipped = 0;

    for (const row of candidates) {
      if (sent >= limit) break;
      if (row.already_sent) {
        skipped++;
        continue;
      }

      const days = row.days_until_due;
      const exists = row.existing_log_id ? { id: row.existing_log_id } : null;
      const message = days > 0
        ? "Halo " + row.full_name + ", pengingat tagihan internet FF NETWORK. Invoice " + row.invoice_number + " periode " + row.billing_period + " sebesar " + rupiah(row.remaining_idr) + " jatuh tempo " + row.due_date + " (H-" + days + "). Jika sudah membayar, abaikan pesan ini. Terima kasih."
        : days === 0
          ? "Halo " + row.full_name + ", hari ini adalah tanggal jatuh tempo tagihan internet FF NETWORK. Invoice " + row.invoice_number + " sebesar " + rupiah(row.remaining_idr) + " jatuh tempo hari ini. Jika sudah membayar, abaikan pesan ini. Terima kasih."
          : "Halo " + row.full_name + ", tagihan internet FF NETWORK untuk invoice " + row.invoice_number + " sebesar " + rupiah(row.remaining_idr) + " sudah melewati jatuh tempo " + Math.abs(days) + " hari. Mohon periksa pembayaran Anda. Jika sudah membayar, abaikan pesan ini. Terima kasih.";

      try {
        await sendText(row.phone, message);
        if (exists) {
          db.prepare("UPDATE whatsapp_message_logs SET status='sent',error_message=NULL,created_at=CURRENT_TIMESTAMP WHERE id=?").run(exists.id);
        } else {
          db.prepare("INSERT INTO whatsapp_message_logs (customer_id,invoice_id,phone,message_type,dedupe_key,status) VALUES (?,?,?,'reminder',?,'sent')")
            .run(row.customer_id, row.invoice_id, row.phone, row.dedupe_key);
        }
        sent++;
      } catch (error) {
        if (exists) {
          db.prepare("UPDATE whatsapp_message_logs SET status='failed',error_message=?,created_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(String(error.message).slice(0, 500), exists.id);
        } else {
          db.prepare("INSERT INTO whatsapp_message_logs (customer_id,invoice_id,phone,message_type,dedupe_key,status,error_message) VALUES (?,?,?,'reminder',?,'failed',?)")
            .run(row.customer_id, row.invoice_id, row.phone, row.dedupe_key, String(error.message).slice(0, 500));
        }
        failed++;
      }
      if (sent + failed < limit) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return { checked, sent, failed, skipped, date: today };
  } finally {
    running = false;
  }
}

module.exports = { processReminders, reminderStage, getReminderPreview, jakartaDate, maskPhone };

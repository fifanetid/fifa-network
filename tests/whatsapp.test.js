const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-whatsapp-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "whatsapp.sqlite");

const { db } = require("../database/db");
const { reminderStage, getReminderPreview } = require("../modules/whatsapp/reminders");

test("jadwal pengingat WhatsApp mengikuti H-3, hari H, H+3 dan setiap 7 hari", () => {
  assert.equal(reminderStage(3), "h3");
  assert.equal(reminderStage(0), "due");
  assert.equal(reminderStage(-3), "overdue3");
  assert.equal(reminderStage(-10), "overdue10");
  assert.equal(reminderStage(-17), "overdue17");
  assert.equal(reminderStage(2), null);
  assert.equal(reminderStage(-4), null);
});

test("pratinjau hanya menampilkan invoice belum lunas dari pelanggan aktif yang setuju WhatsApp", () => {
  const customer = db.prepare(`
    INSERT INTO customers (customer_code, full_name, phone, address, status, whatsapp_opt_in)
    VALUES ('PREVIEW-1', 'Pelanggan Preview', '081234567890', 'Jalan Contoh 123', 'active', 1)
  `).run();

  const plan = db.prepare(`
    INSERT INTO internet_plans (plan_code, name, speed_mbps, monthly_price_idr)
    VALUES ('PREVIEW10', 'Paket Preview', 10, 50000)
  `).run();

  const subscription = db.prepare(`
    INSERT INTO subscriptions (customer_id, plan_id, start_date, status)
    VALUES (?, ?, '2026-01-01', 'active')
  `).run(customer.lastInsertRowid, plan.lastInsertRowid);

  const invoice = db.prepare(`
    INSERT INTO invoices (
      invoice_number, subscription_id, customer_id, billing_period, due_date,
      subtotal_idr, discount_idr, total_idr, status
    ) VALUES ('PREVIEW-INV-1', ?, ?, '2026-11', '2026-11-13', 50000, 0, 50000, 'unpaid')
  `).run(subscription.lastInsertRowid, customer.lastInsertRowid);

  const preview = getReminderPreview({ today: "2026-11-13" });
  assert.equal(preview.date, "2026-11-13");
  assert.equal(preview.total, 1);
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].invoice_number, "PREVIEW-INV-1");
  assert.equal(preview.candidates[0].stage, "due");
  assert.equal(preview.candidates[0].stage_label, "Jatuh tempo");
  assert.equal(preview.candidates[0].remaining_idr, 50000);
  assert.equal(preview.candidates[0].masked_phone, "081••••7890");
  assert.equal(Object.hasOwn(preview.candidates[0], "phone"), false);

  db.prepare(`
    INSERT INTO whatsapp_message_logs (customer_id, invoice_id, phone, message_type, dedupe_key, status)
    VALUES (?, ?, '081234567890', 'reminder', ?, 'sent')
  `).run(customer.lastInsertRowid, invoice.lastInsertRowid, invoice.lastInsertRowid + ":due");

  const afterSent = getReminderPreview({ today: "2026-11-13" });
  assert.equal(afterSent.total, 0);
  assert.equal(afterSent.previouslySent, 1);
});

test("pratinjau menolak batas tampilan di luar rentang aman", () => {
  assert.throws(() => getReminderPreview({ today: "2026-11-13", limit: 0 }), /Batas pratinjau/);
  assert.throws(() => getReminderPreview({ today: "2026-11-13", limit: 101 }), /Batas pratinjau/);
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

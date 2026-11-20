"use strict";

const router = require("express").Router();
const { db } = require("../../../database/db");
const { recordAudit } = require("../../../modules/audit");
const { requireRole } = require("../middleware/auth");

router.use(requireRole("admin", "finance", "teknisi"));

const statuses = new Set(["open", "in_progress", "waiting_customer", "resolved", "closed"]);
const priorities = new Set(["low", "normal", "high", "urgent"]);
const statusLabels = {
  open: "Baru",
  in_progress: "Sedang ditangani",
  waiting_customer: "Menunggu pelanggan",
  resolved: "Selesai",
  closed: "Ditutup"
};
const categoryLabels = {
  internet: "Gangguan internet",
  billing: "Tagihan / pembayaran",
  account: "Akun pelanggan",
  other: "Lainnya"
};
const priorityLabels = { low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Mendesak" };

function ticketIdFromParam(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function ticketExists(id, tenantId) {
  return db.prepare("SELECT * FROM support_tickets WHERE id=? AND tenant_id=?").get(id,tenantId);
}

router.get("/", (req, res) => {
  const allowedStatus = statuses.has(String(req.query.status || "")) ? String(req.query.status) : "";
  const allowedCategory = Object.hasOwn(categoryLabels, String(req.query.category || "")) ? String(req.query.category) : "";
  const query = String(req.query.q || "").trim().slice(0, 100);
  const where = ["t.tenant_id=?"];
  const params = [req.tenant.id];
  if (allowedStatus) { where.push("t.status=?"); params.push(allowedStatus); }
  if (allowedCategory) { where.push("t.category=?"); params.push(allowedCategory); }
  if (query) {
    where.push("(t.ticket_number LIKE ? OR t.subject LIKE ? OR c.customer_code LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ?)");
    const needle = "%" + query + "%";
    params.push(needle, needle, needle, needle, needle);
  }
  const tickets = db.prepare(`
    SELECT t.*,c.customer_code,c.full_name,c.phone,
      u.name AS assigned_name,
      (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id AND m.tenant_id=t.tenant_id) AS message_count,
      (SELECT m.message FROM support_ticket_messages m
       WHERE m.ticket_id=t.id AND m.tenant_id=t.tenant_id ORDER BY m.id DESC LIMIT 1) AS latest_message
    FROM support_tickets t
    JOIN customers c ON c.id=t.customer_id AND c.tenant_id=t.tenant_id
    LEFT JOIN users u ON u.id=t.assigned_to
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY
      CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1
        WHEN 'waiting_customer' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
      t.last_activity_at DESC,t.id DESC
    LIMIT 200
  `).all(...params);
  const statusCounts = Object.fromEntries(db.prepare(`
    SELECT status,COUNT(*) AS total FROM support_tickets WHERE tenant_id=? GROUP BY status
  `).all(req.tenant.id).map(row => [row.status, row.total]));
  for (const status of statuses) if (!(status in statusCounts)) statusCounts[status] = 0;

  res.render("support-tickets", {
    title: "Keluhan Pelanggan",
    tickets,
    statusCounts,
    filters: { status: allowedStatus, category: allowedCategory, q: query },
    statusLabels,
    categoryLabels,
    priorityLabels
  });
});

router.get("/:id", (req, res) => {
  const id = ticketIdFromParam(req.params.id);
  if (!id) return res.status(404).send("Laporan tidak ditemukan.");
  const ticket = db.prepare(`
    SELECT t.*,c.customer_code,c.full_name,c.phone,c.email,c.address,
      u.name AS assigned_name
    FROM support_tickets t
    JOIN customers c ON c.id=t.customer_id
    LEFT JOIN users u ON u.id=t.assigned_to
    WHERE t.id=? AND t.tenant_id=?
  `).get(id,req.tenant.id);
  if (!ticket) return res.status(404).send("Laporan tidak ditemukan.");
  const messages = db.prepare(`
    SELECT m.*,u.name AS staff_name,c.full_name AS customer_name
    FROM support_ticket_messages m
    LEFT JOIN users u ON u.id=m.sender_user_id
    LEFT JOIN customers c ON c.id=m.sender_customer_id
    WHERE m.ticket_id=? AND m.tenant_id=?
    ORDER BY m.id ASC
  `).all(id,req.tenant.id);
  const staffUsers = db.prepare(`
    SELECT u.id,u.name,m.role FROM users u
    JOIN tenant_memberships m ON m.user_id=u.id AND m.tenant_id=? AND m.status='active'
    WHERE u.is_active=1 AND m.role IN ('admin','finance','teknisi')
    ORDER BY CASE m.role WHEN 'teknisi' THEN 0 WHEN 'finance' THEN 1 ELSE 2 END,u.name COLLATE NOCASE
  `).all(req.tenant.id);

  res.render("support-ticket-detail", {
    title: ticket.ticket_number,
    ticket,
    messages,
    staffUsers,
    statusLabels,
    categoryLabels,
    priorityLabels,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

router.post("/:id/update", (req, res) => {
  const id = ticketIdFromParam(req.params.id);
  if (!id) return res.status(404).send("Laporan tidak ditemukan.");
  const current = ticketExists(id,req.tenant.id);
  if (!current) return res.status(404).send("Laporan tidak ditemukan.");

  const status = String(req.body.status || "");
  const priority = String(req.body.priority || "");
  const assignedRaw = String(req.body.assigned_to || "").trim();
  if (!statuses.has(status) || !priorities.has(priority)) {
    return res.redirect("/admin/tickets/" + id + "?error=" + encodeURIComponent("Status atau prioritas tidak valid."));
  }
  let assignedTo = null;
  if (assignedRaw) {
    assignedTo = Number(assignedRaw);
    if (!Number.isSafeInteger(assignedTo) || assignedTo < 1) {
      return res.redirect("/admin/tickets/" + id + "?error=" + encodeURIComponent("Petugas yang dipilih tidak valid."));
    }
    const assignee = db.prepare("SELECT u.id FROM users u JOIN tenant_memberships m ON m.user_id=u.id AND m.tenant_id=? AND m.status='active' WHERE u.id=? AND u.is_active=1 AND m.role IN ('admin','finance','teknisi')").get(req.tenant.id,assignedTo);
    if (!assignee) {
      return res.redirect("/admin/tickets/" + id + "?error=" + encodeURIComponent("Petugas tidak ditemukan atau tidak aktif."));
    }
  }

  const statusChanged = status !== current.status;
  const priorityChanged = priority !== current.priority;
  const assigneeChanged = Number(current.assigned_to || 0) !== Number(assignedTo || 0);
  db.transaction(() => {
    db.prepare(`
      UPDATE support_tickets
      SET status=?,priority=?,assigned_to=?,
        resolved_at=CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at,CURRENT_TIMESTAMP)
          WHEN ? IN ('open','in_progress','waiting_customer') THEN NULL ELSE resolved_at END,
        closed_at=CASE WHEN ?='closed' THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?
    `).run(status, priority, assignedTo, status, status, status, id,req.tenant.id);

    const changes = [];
    if (statusChanged) changes.push("Status: " + (statusLabels[current.status] || current.status) + " → " + statusLabels[status]);
    if (priorityChanged) changes.push("Prioritas: " + (priorityLabels[current.priority] || current.priority) + " → " + priorityLabels[priority]);
    if (assigneeChanged) {
      const assigneeName = assignedTo
        ? db.prepare("SELECT u.name FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.id=? AND m.tenant_id=? AND m.status='active'").get(assignedTo,req.tenant.id).name
        : "Belum ditugaskan";
      changes.push("Petugas: " + assigneeName);
    }
    if (changes.length) {
      db.prepare(`
        INSERT INTO support_ticket_messages (tenant_id,ticket_id,sender_type,message)
        VALUES (?,?,'system',?)
      `).run(req.tenant.id,id, changes.join(" · "));
      recordAudit({
        user: req.session.user,
        action: "support_ticket.update",
        entityType: "support_ticket",
        entityId: id,
        summary: "Memperbarui " + current.ticket_number + ": " + changes.join("; "),
        tenantId:req.tenant.id
      });
    }
  })();
  res.redirect("/admin/tickets/" + id + "?notice=" + encodeURIComponent("Laporan berhasil diperbarui."));
});

router.post("/:id/reply", (req, res) => {
  const id = ticketIdFromParam(req.params.id);
  if (!id) return res.status(404).send("Laporan tidak ditemukan.");
  const message = String(req.body.message || "").trim();
  if (message.length < 1 || message.length > 5000) {
    return res.redirect("/admin/tickets/" + id + "?error=" + encodeURIComponent("Balasan harus 1–5.000 karakter."));
  }
  const ticket = ticketExists(id,req.tenant.id);
  if (!ticket) return res.status(404).send("Laporan tidak ditemukan.");
  if (ticket.status === "closed") {
    return res.redirect("/admin/tickets/" + id + "?error=" + encodeURIComponent("Laporan sudah ditutup. Ubah statusnya terlebih dahulu untuk melanjutkan."));
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO support_ticket_messages (tenant_id,ticket_id,sender_type,sender_user_id,message)
      VALUES (?,?,'staff',?,?)
    `).run(req.tenant.id,id, req.session.user.id, message);
    db.prepare(`
      UPDATE support_tickets
      SET status='waiting_customer',first_response_at=COALESCE(first_response_at,CURRENT_TIMESTAMP),
        resolved_at=NULL,updated_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?
    `).run(id,req.tenant.id);
    recordAudit({
      user: req.session.user,
      action: "support_ticket.reply",
      entityType: "support_ticket",
      entityId: id,
      summary: "Membalas laporan " + ticket.ticket_number,
      tenantId:req.tenant.id
    });
  })();
  res.redirect("/admin/tickets/" + id + "?notice=" + encodeURIComponent("Balasan berhasil dikirim."));
});

module.exports = router;

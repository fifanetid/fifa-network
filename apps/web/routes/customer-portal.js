"use strict";

const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { db } = require("../../../database/db");
const billing = require("../../../modules/billing");
const { requireCustomerPortal } = require("../middleware/customer-portal");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Terlalu banyak percobaan login portal. Coba lagi dalam 15 menit."
});

const ticketCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => "customer:" + String(req.customer.id),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Terlalu banyak laporan dibuat. Coba lagi dalam 15 menit."
});

const ticketCategories = new Set(["internet", "billing", "account", "other"]);

function newTicketNumber() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit"
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return "TKT-" + parts.year + parts.month + "-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

const rupiah = (value) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(value);

router.get("/login", (req, res) => {
  if (req.session.portalCustomer) return res.redirect("/customer");
  res.render("customer/login", {
    title: "Portal Pelanggan",
    error: req.query.error ? "ID pelanggan atau password salah, atau akun tidak aktif." : null
  });
});

router.post("/login", loginLimiter, (req, res, next) => {
  const customerCode = String(req.body.customer_code || "").trim().toUpperCase();
  const password = String(req.body.password || "");
  if (!customerCode || customerCode.length > 30 || !password || password.length > 200) {
    return res.redirect("/customer/login?error=1");
  }

  const account = db.prepare(`
    SELECT a.customer_id, a.password_hash, c.customer_code, c.full_name
    FROM customer_portal_accounts a
    JOIN customers c ON c.id=a.customer_id AND a.tenant_id=c.tenant_id
    WHERE c.tenant_id=1 AND c.customer_code=? COLLATE NOCASE
      AND a.is_active=1 AND c.status='active'
    LIMIT 1
  `).get(customerCode);

  if (!account || !bcrypt.compareSync(password, account.password_hash)) {
    return res.redirect("/customer/login?error=1");
  }

  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.portalCustomer = {
      id: account.customer_id,
      customerCode: account.customer_code,
      fullName: account.full_name
    };
    db.prepare("UPDATE customer_portal_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE customer_id=? AND tenant_id=1")
      .run(account.customer_id);
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.redirect("/customer");
    });
  });
});

router.use(requireCustomerPortal);

router.get("/", (req, res) => {
  const customerId = req.customer.id;
  const invoices = db.prepare(`
    SELECT i.*,
      COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      - COALESCE((
        SELECT SUM(r.amount_idr) FROM payment_reversals r
        JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id
      ),0) AS paid_idr,
      (SELECT COUNT(*) FROM customer_payment_confirmations pc
       WHERE pc.invoice_id=i.id AND pc.status='pending') AS pending_confirmations
    FROM invoices i
    WHERE i.customer_id=? AND i.tenant_id=? AND i.status<>'void'
    ORDER BY i.id DESC LIMIT 100
  `).all(customerId,req.customer.tenantId).map(invoice => ({
    ...invoice,
    remaining_idr: Math.max(0, invoice.total_idr - invoice.paid_idr)
  }));

  const subscriptions = db.prepare(`
    SELECT s.id, s.start_date, s.end_date, s.status, s.external_device_ref,
      p.plan_code, p.name AS plan_name, p.speed_mbps, p.monthly_price_idr
    FROM subscriptions s JOIN internet_plans p ON p.id=s.plan_id AND p.tenant_id=s.tenant_id
    WHERE s.customer_id=? AND s.tenant_id=? ORDER BY s.id DESC
  `).all(customerId,req.customer.tenantId);

  const confirmations = db.prepare(`
    SELECT pc.*, i.invoice_number,
      COALESCE(p.amount_idr,0) AS recorded_payment_idr,
      COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r
        WHERE r.payment_id=pc.payment_id),0) AS reversed_amount_idr,
      CASE
        WHEN pc.status='approved' AND pc.payment_id IS NOT NULL
          AND COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r
            WHERE r.payment_id=pc.payment_id),0) >= COALESCE(p.amount_idr,0)
          THEN 'reversed'
        WHEN pc.status='approved' AND pc.payment_id IS NOT NULL
          AND COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r
            WHERE r.payment_id=pc.payment_id),0) > 0
          THEN 'partially_reversed'
        ELSE pc.status
      END AS display_status
    FROM customer_payment_confirmations pc
    JOIN invoices i ON i.id=pc.invoice_id AND i.tenant_id=pc.tenant_id
    LEFT JOIN payments p ON p.id=pc.payment_id AND p.tenant_id=pc.tenant_id
    WHERE pc.customer_id=? AND pc.tenant_id=?
    ORDER BY pc.id DESC LIMIT 50
  `).all(customerId,req.customer.tenantId);

  const customer = db.prepare(`
    SELECT customer_code, full_name, phone, email, address
    FROM customers WHERE id=? AND tenant_id=?
  `).get(customerId,req.customer.tenantId);
  const supportTicketCount = db.prepare(
    "SELECT COUNT(*) AS total FROM support_tickets WHERE customer_id=? AND tenant_id=?"
  ).get(customerId,req.customer.tenantId).total;
  const openSupportTicketCount = db.prepare(
    "SELECT COUNT(*) AS total FROM support_tickets WHERE customer_id=? AND tenant_id=? AND status NOT IN ('resolved','closed')"
  ).get(customerId,req.customer.tenantId).total;

  res.render("customer/dashboard", {
    title: "Portal Pelanggan",
    customer,
    invoices,
    subscriptions,
    confirmations,
    supportTicketCount,
    openSupportTicketCount,
    notice: req.query.notice || null,
    rupiah
  });
});

router.get("/invoices/:id/print", (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return res.status(404).send("Invoice tidak ditemukan.");

  const invoice = db.prepare(`
    SELECT i.*, c.customer_code, c.full_name, c.phone, c.email, c.address,
      p.plan_code, p.name AS plan_name, p.speed_mbps,
      COALESCE((SELECT SUM(pay.amount_idr) FROM payments pay WHERE pay.invoice_id=i.id),0)
      - COALESCE((
        SELECT SUM(r.amount_idr) FROM payment_reversals r
        JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id
      ),0) AS paid_idr
    FROM invoices i
    JOIN customers c ON c.id=i.customer_id
    JOIN subscriptions s ON s.id=i.subscription_id
    JOIN internet_plans p ON p.id=s.plan_id
    WHERE i.id=? AND i.customer_id=? AND i.tenant_id=? AND i.status<>'void'
  `).get(invoiceId, req.customer.id,req.customer.tenantId);

  if (!invoice) return res.status(404).send("Invoice tidak ditemukan.");
  res.render("customer/invoice-print", { title: "Invoice " + invoice.invoice_number, invoice, rupiah });
});

router.post("/invoices/:id/confirm-payment", (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) {
    return res.status(404).send("Invoice tidak ditemukan.");
  }

  try {
    const invoice = db.prepare(`
      SELECT i.*,
        COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
        - COALESCE((
          SELECT SUM(r.amount_idr) FROM payment_reversals r
          JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id
        ),0) AS paid_idr
      FROM invoices i
      WHERE i.id=? AND i.customer_id=? AND i.tenant_id=? AND i.status IN ('unpaid','partial')
    `).get(invoiceId, req.customer.id,req.customer.tenantId);

    if (!invoice) throw new Error("Invoice tidak ditemukan atau sudah lunas.");
    const pending = db.prepare(`
      SELECT COUNT(*) AS total FROM customer_payment_confirmations
      WHERE invoice_id=? AND customer_id=? AND tenant_id=? AND status='pending'
    `).get(invoiceId, req.customer.id,req.customer.tenantId).total;
    if (pending > 0) throw new Error("Konfirmasi pembayaran untuk invoice ini masih menunggu pemeriksaan admin.");

    const amount = Number(req.body.amount_idr);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > invoice.total_idr - invoice.paid_idr) {
      throw new Error("Nominal pembayaran tidak valid atau melebihi sisa tagihan.");
    }

    const method = String(req.body.payment_method || "");
    if (!["bank_transfer", "qris", "other"].includes(method)) {
      throw new Error("Metode pembayaran tidak valid.");
    }

    const reference = String(req.body.payment_reference || "").trim();
    if (reference.length < 3 || reference.length > 100) {
      throw new Error("Nomor referensi pembayaran wajib diisi (3–100 karakter).");
    }
    const paidAt = billing.validateDate(req.body.paid_at, "Tanggal pembayaran");
    const notes = billing.optionalText(req.body.notes, "Catatan pembayaran");

    db.prepare(`
      INSERT INTO customer_payment_confirmations
        (tenant_id,customer_id,invoice_id,amount_idr,payment_method,payment_reference,paid_at,notes)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(req.customer.tenantId,req.customer.id, invoiceId, amount, method, reference, paidAt, notes);

    res.redirect("/customer?notice=" + encodeURIComponent("Konfirmasi pembayaran berhasil dikirim dan menunggu pemeriksaan admin."));
  } catch (error) {
    const message = error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Nomor referensi transaksi tersebut sudah pernah digunakan."
      : error.message;
    res.redirect("/customer?notice=" + encodeURIComponent(message));
  }
});

router.get("/tickets", (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id) AS message_count,
      (SELECT m.message FROM support_ticket_messages m
       WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS latest_message
    FROM support_tickets t
    WHERE t.customer_id=? AND t.tenant_id=?
    ORDER BY t.last_activity_at DESC,t.id DESC
    LIMIT 100
  `).all(req.customer.id,req.customer.tenantId);
  res.render("customer/tickets", {
    title: "Keluhan Saya",
    customer: req.customer,
    tickets,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

router.post("/tickets", ticketCreateLimiter, (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const category = String(req.body.category || "");
  const message = String(req.body.message || "").trim();
  if (subject.length < 5 || subject.length > 120) {
    return res.redirect("/customer/tickets?error=" + encodeURIComponent("Judul laporan harus 5–120 karakter."));
  }
  if (!ticketCategories.has(category)) {
    return res.redirect("/customer/tickets?error=" + encodeURIComponent("Kategori laporan tidak valid."));
  }
  if (message.length < 10 || message.length > 5000) {
    return res.redirect("/customer/tickets?error=" + encodeURIComponent("Detail gangguan harus 10–5.000 karakter."));
  }

  try {
    const ticketId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO support_tickets (tenant_id,ticket_number,customer_id,category,subject)
        VALUES (?,?,?,?,?)
      `).run(req.customer.tenantId,newTicketNumber(), req.customer.id, category, subject);
      db.prepare(`
        INSERT INTO support_ticket_messages
          (tenant_id,ticket_id,sender_type,sender_customer_id,message)
        VALUES (?,?,'customer',?,?)
      `).run(req.customer.tenantId,result.lastInsertRowid, req.customer.id, message);
      return Number(result.lastInsertRowid);
    })();
    return res.redirect("/customer/tickets/" + ticketId + "?notice=" + encodeURIComponent("Laporan berhasil dikirim."));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.redirect("/customer/tickets?error=" + encodeURIComponent("Nomor laporan bentrok. Silakan kirim ulang."));
    }
    throw error;
  }
});

router.get("/tickets/:id", (req, res) => {
  const ticketId = Number(req.params.id);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return res.status(404).send("Laporan tidak ditemukan.");
  const ticket = db.prepare(`
    SELECT t.* FROM support_tickets t
    WHERE t.id=? AND t.customer_id=? AND t.tenant_id=?
  `).get(ticketId, req.customer.id,req.customer.tenantId);
  if (!ticket) return res.status(404).send("Laporan tidak ditemukan.");
  const messages = db.prepare(`
    SELECT m.id,m.sender_type,m.message,m.created_at,
      CASE
        WHEN m.sender_type='customer' THEN 'Kamu'
        WHEN m.sender_type='staff' THEN COALESCE(u.name,'Petugas FF BILLING')
        ELSE 'Sistem'
      END AS sender_name
    FROM support_ticket_messages m
    LEFT JOIN users u ON u.id=m.sender_user_id
    WHERE m.ticket_id=? AND m.tenant_id=?
    ORDER BY m.id ASC
  `).all(ticketId,req.customer.tenantId);
  res.render("customer/ticket", {
    title: ticket.ticket_number,
    customer: req.customer,
    ticket,
    messages,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

router.post("/tickets/:id/reply", (req, res) => {
  const ticketId = Number(req.params.id);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return res.status(404).send("Laporan tidak ditemukan.");
  const message = String(req.body.message || "").trim();
  if (message.length < 1 || message.length > 5000) {
    return res.redirect("/customer/tickets/" + ticketId + "?error=" + encodeURIComponent("Balasan harus 1–5.000 karakter."));
  }
  const ticket = db.prepare(`
    SELECT id,status FROM support_tickets WHERE id=? AND customer_id=? AND tenant_id=?
  `).get(ticketId, req.customer.id,req.customer.tenantId);
  if (!ticket) return res.status(404).send("Laporan tidak ditemukan.");
  if (ticket.status === "closed") {
    return res.redirect("/customer/tickets/" + ticketId + "?error=" + encodeURIComponent("Laporan sudah ditutup. Buat laporan baru bila gangguan masih terjadi."));
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO support_ticket_messages
        (tenant_id,ticket_id,sender_type,sender_customer_id,message)
      VALUES (?,?,'customer',?,?)
    `).run(req.customer.tenantId,ticketId, req.customer.id, message);
    const nextStatus = ticket.status === "resolved" ? "open"
      : ticket.status === "waiting_customer" ? "in_progress" : ticket.status;
    db.prepare(`
      UPDATE support_tickets
      SET status=?,resolved_at=CASE WHEN ?='open' THEN NULL ELSE resolved_at END,
          updated_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?
    `).run(nextStatus, nextStatus, ticketId,req.customer.tenantId);
  })();
  res.redirect("/customer/tickets/" + ticketId + "?notice=" + encodeURIComponent("Balasan berhasil dikirim."));
});

router.post("/account/password", (req, res, next) => {
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  if (newPassword.length < 12 || newPassword.length > 200) {
    return res.redirect("/customer?notice=" + encodeURIComponent("Password baru harus 12–200 karakter."));
  }

  const account = db.prepare("SELECT password_hash FROM customer_portal_accounts WHERE customer_id=? AND tenant_id=?")
    .get(req.customer.id,req.customer.tenantId);
  if (!account || !bcrypt.compareSync(currentPassword, account.password_hash)) {
    return res.redirect("/customer?notice=" + encodeURIComponent("Password saat ini tidak sesuai."));
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);
  db.prepare("UPDATE customer_portal_accounts SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND tenant_id=?")
    .run(passwordHash, req.customer.id,req.customer.tenantId);
  res.redirect("/customer?notice=" + encodeURIComponent("Password portal berhasil diperbarui."));
});

router.post("/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("ffbilling.sid");
    res.redirect("/customer/login");
  });
});

module.exports = router;

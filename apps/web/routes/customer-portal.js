"use strict";

const router = require("express").Router();
const bcrypt = require("bcryptjs");
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
    JOIN customers c ON c.id=a.customer_id
    WHERE c.customer_code=? COLLATE NOCASE
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
    db.prepare("UPDATE customer_portal_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE customer_id=?")
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
    WHERE i.customer_id=? AND i.status<>'void'
    ORDER BY i.id DESC LIMIT 100
  `).all(customerId).map(invoice => ({
    ...invoice,
    remaining_idr: Math.max(0, invoice.total_idr - invoice.paid_idr)
  }));

  const subscriptions = db.prepare(`
    SELECT s.id, s.start_date, s.end_date, s.status, s.external_device_ref,
      p.plan_code, p.name AS plan_name, p.speed_mbps, p.monthly_price_idr
    FROM subscriptions s JOIN internet_plans p ON p.id=s.plan_id
    WHERE s.customer_id=? ORDER BY s.id DESC
  `).all(customerId);

  const confirmations = db.prepare(`
    SELECT pc.*, i.invoice_number
    FROM customer_payment_confirmations pc
    JOIN invoices i ON i.id=pc.invoice_id
    WHERE pc.customer_id=?
    ORDER BY pc.id DESC LIMIT 50
  `).all(customerId);

  const customer = db.prepare(`
    SELECT customer_code, full_name, phone, email, address
    FROM customers WHERE id=?
  `).get(customerId);

  res.render("customer/dashboard", {
    title: "Portal Pelanggan",
    customer,
    invoices,
    subscriptions,
    confirmations,
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
    WHERE i.id=? AND i.customer_id=? AND i.status<>'void'
  `).get(invoiceId, req.customer.id);

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
      WHERE i.id=? AND i.customer_id=? AND i.status IN ('unpaid','partial')
    `).get(invoiceId, req.customer.id);

    if (!invoice) throw new Error("Invoice tidak ditemukan atau sudah lunas.");
    const pending = db.prepare(`
      SELECT COUNT(*) AS total FROM customer_payment_confirmations
      WHERE invoice_id=? AND customer_id=? AND status='pending'
    `).get(invoiceId, req.customer.id).total;
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
        (customer_id,invoice_id,amount_idr,payment_method,payment_reference,paid_at,notes)
      VALUES (?,?,?,?,?,?,?)
    `).run(req.customer.id, invoiceId, amount, method, reference, paidAt, notes);

    res.redirect("/customer?notice=" + encodeURIComponent("Konfirmasi pembayaran berhasil dikirim dan menunggu pemeriksaan admin."));
  } catch (error) {
    res.redirect("/customer?notice=" + encodeURIComponent(error.message));
  }
});

router.post("/account/password", (req, res, next) => {
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  if (newPassword.length < 12 || newPassword.length > 200) {
    return res.redirect("/customer?notice=" + encodeURIComponent("Password baru harus 12–200 karakter."));
  }

  const account = db.prepare("SELECT password_hash FROM customer_portal_accounts WHERE customer_id=?")
    .get(req.customer.id);
  if (!account || !bcrypt.compareSync(currentPassword, account.password_hash)) {
    return res.redirect("/customer?notice=" + encodeURIComponent("Password saat ini tidak sesuai."));
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);
  db.prepare("UPDATE customer_portal_accounts SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE customer_id=?")
    .run(passwordHash, req.customer.id);
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

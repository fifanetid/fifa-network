const { randomUUID } = require("node:crypto");
const { db } = require("../../database/db");
const domain = require("./domain");

function createInvoice({ subscriptionId, period, dueDate, discount = 0, notes = "" }) {
  const id = Number(subscriptionId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Langganan tidak valid.");
  const billingPeriod = domain.validatePeriod(period);
  const due = domain.validateDate(dueDate, "Tanggal jatuh tempo");
  const invoiceNotes = domain.optionalText(notes, "Catatan invoice");
  return db.transaction(() => {
    const subscription = db.prepare(`
      SELECT s.id, s.customer_id, s.status, p.monthly_price_idr
      FROM subscriptions s JOIN internet_plans p ON p.id=s.plan_id
      WHERE s.id=?
    `).get(id);
    if (!subscription || subscription.status === "terminated") throw new Error("Langganan tidak ditemukan atau sudah dihentikan.");
    const amounts = domain.calculateInvoice(subscription.monthly_price_idr, discount);
    const invoiceNumber = "FN-" + billingPeriod.replace("-", "") + "-" + randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,status,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(invoiceNumber,id,subscription.customer_id,billingPeriod,due,amounts.subtotal_idr,amounts.discount_idr,amounts.total_idr,amounts.total_idr === 0 ? "paid" : "unpaid",invoiceNotes);
    return db.prepare("SELECT * FROM invoices WHERE id=?").get(result.lastInsertRowid);
  })();
}
function generateMonthlyInvoices({ period, dueDate }) {
  const billingPeriod = domain.validatePeriod(period);
  const due = domain.validateDate(dueDate, "Tanggal jatuh tempo");
  const periodStart = billingPeriod + "-01";
  const eligible = db.prepare(`
    SELECT s.id AS subscription_id, s.customer_id, p.monthly_price_idr
    FROM subscriptions s
    JOIN internet_plans p ON p.id=s.plan_id
    WHERE s.status='active'
      AND s.start_date <= ?
      AND (s.end_date IS NULL OR s.end_date >= ?)
    ORDER BY s.id
  `).all(periodStart, periodStart);

  return db.transaction(() => {
    const created = [];
    const insert = db.prepare(`
      INSERT INTO invoices
        (invoice_number,subscription_id,customer_id,billing_period,due_date,
         subtotal_idr,discount_idr,total_idr,status,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(subscription_id,billing_period) DO NOTHING
    `);
    for (const subscription of eligible) {
      const amount = subscription.monthly_price_idr;
      const invoiceNumber = "FN-" + billingPeriod.replace("-", "") + "-" +
        randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
      const result = insert.run(
        invoiceNumber, subscription.subscription_id, subscription.customer_id,
        billingPeriod, due, amount, 0, amount, amount === 0 ? "paid" : "unpaid",
        "Invoice bulanan otomatis"
      );
      if (result.changes) {
        created.push(db.prepare("SELECT * FROM invoices WHERE id=?").get(result.lastInsertRowid));
      }
    }
    return created;
  })();
}
function recordPayment({ invoiceId, input, userId }) {
  const id = Number(invoiceId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invoice tidak valid.");
  return db.transaction(() => {
    const invoice = db.prepare("SELECT * FROM invoices WHERE id=?").get(id);
    if (!invoice || invoice.status === "void") throw new Error("Invoice tidak ditemukan atau sudah dibatalkan.");
    const paid = db.prepare(`
      SELECT COALESCE(SUM(p.amount_idr),0) - COALESCE((
        SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=p.invoice_id
      ),0) AS total
      FROM payments p WHERE p.invoice_id=?
    `).get(id).total;
    const payment = domain.validatePayment(input, invoice.total_idr - paid);
    const reference = "PAY-" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const result = db.prepare(`
      INSERT INTO payments (invoice_id,payment_reference,amount_idr,payment_method,paid_at,received_by,notes)
      VALUES (?,?,?,?,?,?,?)
    `).run(id,reference,payment.amount_idr,payment.payment_method,payment.paid_at,userId || null,payment.notes);
    const newPaid = paid + payment.amount_idr;
    db.prepare("UPDATE invoices SET status=? WHERE id=?").run(domain.calculateInvoiceStatus(invoice.total_idr,newPaid),id);
    return db.prepare("SELECT * FROM payments WHERE id=?").get(result.lastInsertRowid);
  })();
}
function recordPaymentReversal({ paymentId, input, userId }) {
  const id = Number(paymentId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Pembayaran tidak valid.");
  return db.transaction(() => {
    const payment = db.prepare(`
      SELECT p.*, i.status AS invoice_status
      FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.id=?
    `).get(id);
    if (!payment || payment.invoice_status === "void") throw new Error("Pembayaran tidak ditemukan atau invoice sudah dibatalkan.");
    const reversed = db.prepare("SELECT COALESCE(SUM(amount_idr),0) AS total FROM payment_reversals WHERE payment_id=?").get(id).total;
    const reversal = domain.validateReversal(input, payment.amount_idr - reversed);
    const reference = "REV-" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const result = db.prepare(`
      INSERT INTO payment_reversals (payment_id,reversal_reference,amount_idr,reason,created_by)
      VALUES (?,?,?,?,?)
    `).run(id, reference, reversal.amount_idr, reversal.reason, userId || null);
    return db.prepare("SELECT * FROM payment_reversals WHERE id=?").get(result.lastInsertRowid);
  })();
}
function getDueReminders({ today, daysAhead = 7 }) {
  const referenceDate = domain.validateDate(today, "Tanggal acuan");
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 31) {
    throw new Error("Rentang pengingat harus 0 sampai 31 hari.");
  }
  return db.prepare(`
    SELECT i.id, i.invoice_number, i.billing_period, i.due_date, i.total_idr,
      c.customer_code, c.full_name, c.phone,
      COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      - COALESCE((
        SELECT SUM(r.amount_idr) FROM payment_reversals r
        JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id
      ),0) AS paid_idr,
      CAST(julianday(?) - julianday(i.due_date) AS INTEGER) AS days_overdue
    FROM invoices i
    JOIN customers c ON c.id=i.customer_id
    WHERE i.status IN ('unpaid','partial')
      AND i.due_date <= date(?, '+' || ? || ' days')
      AND i.status <> 'void'
    HAVING (i.total_idr - paid_idr) > 0
    ORDER BY i.due_date ASC, c.full_name COLLATE NOCASE
  `).all(referenceDate, referenceDate, daysAhead).map(row => ({
    ...row,
    remaining_idr: row.total_idr - row.paid_idr,
    is_overdue: row.days_overdue > 0
  }));
}

function getOutstandingBalance() {
  return db.prepare(`
    SELECT COALESCE(SUM(
      i.total_idr
      - COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      + COALESCE((
        SELECT SUM(r.amount_idr)
        FROM payment_reversals r
        JOIN payments rp ON rp.id=r.payment_id
        WHERE rp.invoice_id=i.id
      ),0)
    ),0) AS total
    FROM invoices i
    WHERE i.status <> 'void'
  `).get().total;
}

module.exports = { ...domain, createInvoice, generateMonthlyInvoices, getDueReminders, recordPayment, recordPaymentReversal, getOutstandingBalance };

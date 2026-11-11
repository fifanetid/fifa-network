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
function generateInvoicesForPeriod({ period, dueDate, notes = "" }) {
  const billingPeriod = domain.validatePeriod(period);
  const due = domain.validateDate(dueDate, "Tanggal jatuh tempo");
  const invoiceNotes = domain.optionalText(notes, "Catatan invoice");
  const [year, month] = billingPeriod.split("-").map(Number);
  const periodStart = billingPeriod + "-01";
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  return db.transaction(() => {
    const candidates = db.prepare(`
      SELECT s.id AS subscription_id, s.customer_id, p.monthly_price_idr
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      JOIN internet_plans p ON p.id = s.plan_id
      WHERE s.status = 'active'
        AND c.status = 'active'
        AND s.start_date <= ?
        AND (s.end_date IS NULL OR s.end_date >= ?)
      ORDER BY s.id
    `).all(periodEnd, periodStart);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO invoices
        (invoice_number, subscription_id, customer_id, billing_period, due_date,
         subtotal_idr, discount_idr, total_idr, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const created = [];
    let skipped = 0;

    for (const subscription of candidates) {
      const amounts = domain.calculateInvoice(subscription.monthly_price_idr);
      const invoiceNumber = "FN-" + billingPeriod.replace("-", "") + "-" +
        randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
      const result = insert.run(
        invoiceNumber, subscription.subscription_id, subscription.customer_id,
        billingPeriod, due, amounts.subtotal_idr, amounts.total_idr,
        amounts.total_idr === 0 ? "paid" : "unpaid", invoiceNotes
      );
      if (result.changes) {
        created.push(db.prepare("SELECT * FROM invoices WHERE id=?").get(result.lastInsertRowid));
      } else {
        skipped += 1;
      }
    }
    return { period: billingPeriod, created, createdCount: created.length, skippedCount: skipped, eligibleCount: candidates.length };
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
module.exports = { ...domain, createInvoice, generateInvoicesForPeriod, recordPayment, recordPaymentReversal };

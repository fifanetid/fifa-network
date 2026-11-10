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
      INSERT INTO invoices (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,notes)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(invoiceNumber,id,subscription.customer_id,billingPeriod,due,amounts.subtotal_idr,amounts.discount_idr,amounts.total_idr,invoiceNotes);
    return db.prepare("SELECT * FROM invoices WHERE id=?").get(result.lastInsertRowid);
  })();
}
function recordPayment({ invoiceId, input, userId }) {
  const id = Number(invoiceId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invoice tidak valid.");
  return db.transaction(() => {
    const invoice = db.prepare("SELECT * FROM invoices WHERE id=?").get(id);
    if (!invoice || invoice.status === "void") throw new Error("Invoice tidak ditemukan atau sudah dibatalkan.");
    const paid = db.prepare("SELECT COALESCE(SUM(amount_idr),0) AS total FROM payments WHERE invoice_id=?").get(id).total;
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
module.exports = { ...domain, createInvoice, recordPayment };

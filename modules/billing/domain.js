const PAYMENT_METHODS = ["cash", "bank_transfer", "qris", "other"];
const INVOICE_STATUSES = ["unpaid", "partial", "paid", "void"];
const SUBSCRIPTION_STATUSES = ["active", "suspended", "terminated"];

function text(value, max) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new Error("Kolom wajib diisi dan panjangnya tidak valid.");
  return result;
}
function optionalText(value, field = "Catatan", max = 500) {
  const result = String(value ?? "").trim();
  if (result.length > max) throw new Error(field + " maksimal " + max + " karakter.");
  return result || null;
}
function positiveInteger(value, field, allowZero = false) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new Error(field + " harus berupa bilangan bulat " + (allowZero ? "nol atau lebih." : "lebih dari nol."));
  return number;
}
function validateCustomer(input) {
  const full_name = text(input.full_name, 120);
  const phone = text(input.phone, 30);
  const address = text(input.address, 500);
  const email = String(input.email ?? "").trim().toLowerCase();
  if (full_name.length < 2 || phone.length < 6 || address.length < 5) throw new Error("Nama, nomor telepon, atau alamat terlalu pendek.");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\\.[^\s@]+$/.test(email))) throw new Error("Format email tidak valid.");
  return { full_name, phone, address, email: email || null, customer_code: text(input.customer_code, 30).toUpperCase(), identity_number: optionalText(input.identity_number, "Nomor identitas", 80), notes: optionalText(input.notes) };
}
function validatePlan(input) {
  const speed_mbps = positiveInteger(input.speed_mbps, "Kecepatan");
  const monthly_price_idr = positiveInteger(input.monthly_price_idr, "Harga", true);
  return { plan_code: text(input.plan_code, 30).toUpperCase(), name: text(input.name, 100), speed_mbps, monthly_price_idr, description: optionalText(input.description, "Deskripsi") };
}
function validatePeriod(period) {
  const value = String(period || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("Periode tagihan harus berformat YYYY-MM.");
  return value;
}
function validateDate(value, field) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0,10) !== date) throw new Error(field + " tidak valid.");
  return date;
}
function calculateInvoice(subtotal, discount = 0) {
  const amount = positiveInteger(subtotal, "Subtotal", true);
  const reduction = positiveInteger(discount, "Diskon", true);
  if (reduction > amount) throw new Error("Diskon tidak boleh melebihi subtotal.");
  return { subtotal_idr: amount, discount_idr: reduction, total_idr: amount - reduction, currency: "IDR" };
}
function calculateInvoiceStatus(total, paid) {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}
function validatePayment(input, remaining) {
  const amount_idr = positiveInteger(input.amount_idr, "Nominal pembayaran");
  if (amount_idr > remaining) throw new Error("Pembayaran melebihi sisa tagihan.");
  const payment_method = String(input.payment_method || "");
  if (!PAYMENT_METHODS.includes(payment_method)) throw new Error("Metode pembayaran tidak valid.");
  return { amount_idr, payment_method, paid_at: validateDate(input.paid_at, "Tanggal pembayaran"), notes: optionalText(input.notes) };
}
function validateSubscriptionStatus(currentStatus, nextStatus) {
  if (!SUBSCRIPTION_STATUSES.includes(currentStatus) || !SUBSCRIPTION_STATUSES.includes(nextStatus)) throw new Error("Status langganan tidak valid.");
  if (currentStatus === "terminated" && nextStatus !== "terminated") throw new Error("Langganan yang sudah dihentikan tidak dapat diaktifkan kembali; buat langganan baru.");
  return nextStatus;
}
module.exports = { PAYMENT_METHODS, INVOICE_STATUSES, SUBSCRIPTION_STATUSES, validateCustomer, validatePlan, validatePeriod, validateDate, calculateInvoice, calculateInvoiceStatus, validatePayment, optionalText, validateSubscriptionStatus };

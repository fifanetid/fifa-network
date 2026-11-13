const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-reports-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "billing.sqlite");
const { db } = require("../database/db");
const billing = require("../modules/billing");
const reports = require("../modules/reports");

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("laporan menghitung pembayaran bersih dan reversal berdasarkan tanggal transaksi", () => {
  const customer = db.prepare("INSERT INTO customers (customer_code,full_name,phone,address) VALUES ('RPT-01','Pelanggan Laporan','081234567890','Alamat Laporan')").run();
  const plan = db.prepare("INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr) VALUES ('RPT-PLAN','Paket Laporan',10,100000)").run();
  const sub = db.prepare("INSERT INTO subscriptions (customer_id,plan_id,start_date) VALUES (?,?,'2026-11-01')").run(customer.lastInsertRowid,plan.lastInsertRowid);
  const invoice = billing.createInvoice({subscriptionId:sub.lastInsertRowid,period:"2026-11",dueDate:"2026-11-20"});
  const payment = billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:80000,payment_method:"qris",paid_at:"2026-11-12"}});
  billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:20000,reason:"Koreksi pembayaran"},userId:null});
  const report = reports.getFinancialReport({from:"2026-11-01",to:"2026-11-30"});
  assert.equal(report.summary.received_idr,80000);
  assert.equal(report.summary.reversed_idr,20000);
  assert.equal(report.summary.net_received_idr,60000);
  assert.equal(report.summary.outstanding_idr,40000);
  assert.equal(report.monthly[0].net_idr,60000);
  assert.equal(report.methods[0].net_idr,60000);
});

test("laporan menolak rentang tanggal tidak valid", () => {
  assert.throws(() => reports.getFinancialReport({from:"2026-02-31",to:"2026-03-01"}));
  assert.throws(() => reports.getFinancialReport({from:"2026-11-30",to:"2026-11-01"}));
});


test("laporan metode tetap mencatat reversal walau pembayaran asal di luar periode", () => {
  const customer = db.prepare("INSERT INTO customers (customer_code,full_name,phone,address) VALUES ('RPT-02','Pelanggan Reversal','081234567890','Alamat Reversal')").run();
  const plan = db.prepare("INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr) VALUES ('RPT-PLAN-2','Paket Reversal',10,100000)").run();
  const sub = db.prepare("INSERT INTO subscriptions (customer_id,plan_id,start_date) VALUES (?,?,'2026-10-01')").run(customer.lastInsertRowid,plan.lastInsertRowid);
  const invoice = billing.createInvoice({subscriptionId:sub.lastInsertRowid,period:"2026-10",dueDate:"2026-10-20"});
  const payment = billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:50000,payment_method:"bank_transfer",paid_at:"2026-10-12"}});
  billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:10000,reason:"Reversal pada bulan berikutnya"},userId:null});
  const report = reports.getFinancialReport({from:"2026-11-01",to:"2026-11-30"});
  const transfer = report.methods.find(row => row.payment_method === "bank_transfer");
  assert.equal(report.summary.received_idr,80000); // pembayaran dari tes sebelumnya masih dalam rentang laporan
  assert.equal(report.summary.reversed_idr,30000); // termasuk reversal dari tes sebelumnya
  assert.equal(report.summary.net_received_idr,50000);
  assert.equal(transfer.reversed_idr,10000);
  assert.equal(transfer.net_idr,-10000);
});

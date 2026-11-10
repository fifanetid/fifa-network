const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fifa-billing-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "billing.sqlite");
const { db } = require("../database/db");
const domain = require("../modules/billing/domain");
const billing = require("../modules/billing");

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

let seedNumber = 0;
function seed() {
  seedNumber += 1;
  const customer = db.prepare(`INSERT INTO customers (customer_code,full_name,phone,address)
    VALUES (?,?,'081234567890','Jl. Contoh No. 1')`).run("FN-TEST-" + seedNumber, "Pelanggan Uji " + seedNumber);
  const plan = db.prepare(`INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr)
    VALUES (?,'Paket 10 Mbps',10,100000)`).run("FIF10-" + seedNumber);
  const subscription = db.prepare(`INSERT INTO subscriptions (customer_id,plan_id,start_date,billing_day)
    VALUES (?,?,'2026-11-01',1)`).run(customer.lastInsertRowid,plan.lastInsertRowid);
  return { customerId: customer.lastInsertRowid, planId: plan.lastInsertRowid, subscriptionId: subscription.lastInsertRowid };
}

test("migrasi membuat lima tabel billing dan foreign key aktif", () => {
  for (const table of ["customers","internet_plans","subscriptions","invoices","payments"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }
  assert.equal(db.pragma("foreign_keys",{simple:true}),1);
});

test("validasi pelanggan dan paket menerima input yang benar", () => {
  assert.equal(domain.validateCustomer({customer_code:"fn-2",full_name:"Nama Uji",phone:"08123456789",address:"Alamat Rumah"}).customer_code,"FN-2");
  assert.equal(domain.validatePlan({plan_code:"fif15",name:"Paket 15",speed_mbps:"15",monthly_price_idr:"125000"}).monthly_price_idr,125000);
});

test("validasi menolak email, harga, periode, dan diskon yang tidak valid", () => {
  assert.throws(() => domain.validateCustomer({customer_code:"A",full_name:"Nama",phone:"081234567",address:"Alamat rumah",email:"bukan-email"}));
  assert.throws(() => domain.validatePlan({plan_code:"X",name:"Paket",speed_mbps:0,monthly_price_idr:100}));
  assert.throws(() => domain.validatePeriod("2026-13"));
  assert.throws(() => domain.validateDate("2026-02-31","Tanggal"));
  assert.throws(() => domain.calculateInvoice(100000,100001));
});

test("perhitungan invoice IDR mengurangi diskon dengan benar", () => {
  assert.deepEqual(domain.calculateInvoice(150000,10000),{subtotal_idr:150000,discount_idr:10000,total_idr:140000,currency:"IDR"});
});

test("invoice dibuat dari snapshot harga paket dan periode unik", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2026-11",dueDate:"2026-11-20",discount:10000});
  assert.equal(invoice.subtotal_idr,100000);
  assert.equal(invoice.total_idr,90000);
  assert.equal(invoice.status,"unpaid");
  assert.throws(()=>billing.createInvoice({subscriptionId,period:"2026-11",dueDate:"2026-11-20"}));
});

test("pembayaran parsial lalu lunas memperbarui status invoice", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2026-12",dueDate:"2026-12-20"});
  const first=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:"40000",payment_method:"cash",paid_at:"2026-12-01"},userId:null});
  assert.equal(first.amount_idr,40000);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status,"partial");
  billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:"60000",payment_method:"bank_transfer",paid_at:"2026-12-02"},userId:null});
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status,"paid");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM payments WHERE invoice_id=?").get(invoice.id).total,2);
});

test("pembayaran menolak nominal melebihi sisa dan metode tidak dikenal", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-01",dueDate:"2027-01-20"});
  assert.throws(()=>billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:100001,payment_method:"cash",paid_at:"2027-01-01"}}));
  assert.throws(()=>billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:1000,payment_method:"crypto",paid_at:"2027-01-01"}}));
});

test("database menolak relasi pelanggan yang tidak ada", () => {
  assert.throws(()=>db.prepare("INSERT INTO subscriptions (customer_id,plan_id,start_date) VALUES (999999,999999,'2026-11-01')").run());
});

test("status langganan yang dihentikan bersifat terminal", () => {
  assert.equal(domain.validateSubscriptionStatus("active","suspended"),"suspended");
  assert.equal(domain.validateSubscriptionStatus("suspended","active"),"active");
  assert.throws(() => domain.validateSubscriptionStatus("terminated","active"), /tidak dapat diaktifkan kembali/);
});
test("catatan dan referensi perangkat memiliki batas panjang", () => {
  assert.throws(() => domain.optionalText("x".repeat(501),"Catatan"), /maksimal 500/);
  assert.throws(() => domain.optionalText("x".repeat(151),"Referensi perangkat",150), /maksimal 150/);
});
test("invoice yang sudah lunas atau void tidak menerima pembayaran tambahan", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-02",dueDate:"2027-02-20"});
  billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:100000,payment_method:"cash",paid_at:"2027-02-01"}});
  assert.throws(() => billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:1,payment_method:"cash",paid_at:"2027-02-02"}}));
  const second=billing.createInvoice({subscriptionId,period:"2027-03",dueDate:"2027-03-20"});
  db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(second.id);
  assert.throws(() => billing.recordPayment({invoiceId:second.id,input:{amount_idr:1,payment_method:"cash",paid_at:"2027-03-02"}}));
});

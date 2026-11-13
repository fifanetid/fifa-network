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

test("migrasi membuat tabel billing dan reversal serta foreign key aktif", () => {
  for (const table of ["customers","internet_plans","subscriptions","invoices","payments","payment_reversals"]) {
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

test("database memastikan invoice terhubung ke pelanggan langganan yang sama", () => {
  const first=seed();
  const second=seed();
  assert.throws(() => db.prepare(`
    INSERT INTO invoices (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr)
    VALUES ('FN-MISMATCH',?,?, '2027-04','2027-04-20',100000,0,100000)
  `).run(first.subscriptionId,second.customerId), /invoice customer must match subscription customer/);
});
test("trigger SQLite mencegah pembayaran berlebih dan perubahan riwayat pembayaran", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-05",dueDate:"2027-05-20"});
  billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:90000,payment_method:"cash",paid_at:"2027-05-01"}});
  assert.throws(() => db.prepare(`
    INSERT INTO payments (invoice_id,payment_reference,amount_idr,payment_method,paid_at)
    VALUES (?, 'PAY-OVER', 20000, 'cash', '2027-05-02')
  `).run(invoice.id), /payment exceeds invoice total/);
  assert.throws(() => db.prepare("UPDATE payments SET amount_idr=1 WHERE invoice_id=?").run(invoice.id), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM payments WHERE invoice_id=?").run(invoice.id), /immutable/);
});
test("invoice bernilai nol langsung berstatus lunas", () => {
  const customer=db.prepare("INSERT INTO customers (customer_code,full_name,phone,address) VALUES ('FREE-01','Pelanggan Gratis','081234567890','Alamat Pelanggan Gratis')").run();
  const plan=db.prepare("INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr) VALUES ('FREE-PLAN','Paket Gratis',1,0)").run();
  const subscription=db.prepare("INSERT INTO subscriptions (customer_id,plan_id,start_date) VALUES (?,?,'2027-06-01')").run(customer.lastInsertRowid,plan.lastInsertRowid);
  const invoice=billing.createInvoice({subscriptionId:subscription.lastInsertRowid,period:"2027-06",dueDate:"2027-06-20"});
  assert.equal(invoice.total_idr,0);
  assert.equal(invoice.status,"paid");
});


test("reversal parsial dan penuh memperbarui saldo serta status invoice", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-07",dueDate:"2027-07-20"});
  const payment=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:100000,payment_method:"cash",paid_at:"2027-07-01"}});
  const first=billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:30000,reason:"Salah input nominal"},userId:null});
  assert.equal(first.amount_idr,30000);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status,"partial");
  const second=billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:70000,reason:"Pengembalian sisa dana"},userId:null});
  assert.equal(second.amount_idr,70000);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status,"unpaid");
  const net=db.prepare("SELECT (SELECT SUM(amount_idr) FROM payments WHERE invoice_id=?) - (SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments p ON p.id=r.payment_id WHERE p.invoice_id=?) AS total").get(invoice.id,invoice.id);
  assert.equal(net.total,0);
  assert.throws(()=>billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:1,reason:"Kelebihan reversal"},userId:null}),/melebihi pembayaran/);
});

test("reversal tidak dapat melebihi pembayaran asal dan riwayatnya immutable", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-08",dueDate:"2027-08-20"});
  const payment=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:25000,payment_method:"qris",paid_at:"2027-08-01"}});
  assert.throws(()=>db.prepare("INSERT INTO payment_reversals (payment_id,reversal_reference,amount_idr,reason) VALUES (?, 'REV-TOO-MUCH', 25001, 'Kesalahan uji reversal')").run(payment.id),/reversal exceeds original payment/);
  billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:10000,reason:"Koreksi transaksi"},userId:null});
  assert.throws(()=>db.prepare("UPDATE payment_reversals SET amount_idr=1 WHERE payment_id=?").run(payment.id),/immutable/);
  assert.throws(()=>db.prepare("DELETE FROM payment_reversals WHERE payment_id=?").run(payment.id),/immutable/);
});

test("pembayaran yang sudah memiliki reversal dihitung berdasarkan saldo bersih", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-09",dueDate:"2027-09-20"});
  const payment=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:100000,payment_method:"bank_transfer",paid_at:"2027-09-01"}});
  billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:40000,reason:"Koreksi sebagian"},userId:null});
  const next=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:40000,payment_method:"cash",paid_at:"2027-09-02"}});
  assert.equal(next.amount_idr,40000);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status,"paid");
});

test("reversal ditolak untuk invoice void", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-10",dueDate:"2027-10-20"});
  const payment=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:10000,payment_method:"cash",paid_at:"2027-10-01"}});
  db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(invoice.id);
  assert.throws(()=>billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:10000,reason:"Pembatalan transaksi"},userId:null}),/invoice sudah dibatalkan/);
});


test("trigger status invoice memakai saldo bersih saat pembayaran baru masuk setelah reversal", () => {
  const {subscriptionId}=seed();
  const invoice=billing.createInvoice({subscriptionId,period:"2027-11",dueDate:"2027-11-20"});
  const payment=billing.recordPayment({invoiceId:invoice.id,input:{amount_idr:100000,payment_method:"cash",paid_at:"2027-11-01"}});
  billing.recordPaymentReversal({paymentId:payment.id,input:{amount_idr:40000,reason:"Koreksi sebagian pembayaran"},userId:null});
  db.prepare("INSERT INTO payments (invoice_id,payment_reference,amount_idr,payment_method,paid_at) VALUES (?,?,?,?,?)")
    .run(invoice.id,"PAY-DIRECT-AFTER-REVERSAL",10000,"cash","2027-11-02");
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status,"partial");
});


test("saldo tagihan dashboard menghitung pembayaran bersih setelah reversal", () => {
  const before = billing.getOutstandingBalance();
  const { subscriptionId } = seed();
  const invoice = billing.createInvoice({ subscriptionId, period: "2027-12", dueDate: "2027-12-20" });
  const payment = billing.recordPayment({
    invoiceId: invoice.id,
    input: { amount_idr: 60000, payment_method: "cash", paid_at: "2027-12-01" },
    userId: null
  });
  billing.recordPaymentReversal({
    paymentId: payment.id,
    input: { amount_idr: 20000, reason: "Koreksi pembayaran" },
    userId: null
  });
  assert.equal(billing.getOutstandingBalance(), before + 60000);
});

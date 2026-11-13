const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-customer-portal-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "portal.sqlite");
process.env.SESSION_SECRET = "customer-portal-test-secret-long-enough-123456";

const { db } = require("../../database/db");
const app = require("../../apps/web/app");
const billing = require("../../modules/billing");

const adminId = db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
  .run("Portal Admin", "portal-admin@example.test", bcrypt.hashSync("admin-test-password", 4)).lastInsertRowid;

function addCustomer(code, name, phone) {
  return db.prepare(`
    INSERT INTO customers (customer_code,full_name,phone,address,status)
    VALUES (?,?,?,'Alamat pengujian portal','active')
  `).run(code, name, phone).lastInsertRowid;
}
function addInvoice(customerId, code) {
  const planId = db.prepare(`
    INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr)
    VALUES (?,?,10,100000)
  `).run("PLAN-" + code, "Paket " + code).lastInsertRowid;
  const subscriptionId = db.prepare(`
    INSERT INTO subscriptions (customer_id,plan_id,start_date,status)
    VALUES (?,?,?,'active')
  `).run(customerId, planId, "2026-01-01").lastInsertRowid;
  return db.prepare(`
    INSERT INTO invoices
      (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,status)
    VALUES (?,?,?,?,?,100000,0,100000,'unpaid')
  `).run("INV-" + code, subscriptionId, customerId, "2026-11", "2026-11-20").lastInsertRowid;
}

const customerA = addCustomer("FN-PORTAL-A", "Pelanggan Portal A", "081234567801");
const customerB = addCustomer("FN-PORTAL-B", "Pelanggan Portal B", "081234567802");
const invoiceA = addInvoice(customerA, "PORTAL-A");
const invoiceB = addInvoice(customerB, "PORTAL-B");
for (const [customerId, password] of [[customerA, "customer-a-password"], [customerB, "customer-b-password"]]) {
  db.prepare("INSERT INTO customer_portal_accounts (customer_id,password_hash) VALUES (?,?)")
    .run(customerId, bcrypt.hashSync(password, 4));
}

const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  db.close();
  fs.rmSync(tempDir,{recursive:true,force:true});
});

function tokenFrom(html) {
  const match=html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match,"Rendered form must contain CSRF token");
  return match[1];
}
function cookieFrom(response,current) {
  const value=response.headers.get("set-cookie");
  return value?value.split(";")[0]:current;
}
async function get(pathname,session,redirect="follow") {
  const response=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect});
  session.cookie=cookieFrom(response,session.cookie||"");
  return response;
}
async function post(pathname,session,values) {
  const response=await fetch(baseUrl+pathname,{
    method:"POST",
    redirect:"manual",
    headers:{
      "content-type":"application/x-www-form-urlencoded",
      "x-csrf-token":session.token,
      cookie:session.cookie
    },
    body:new URLSearchParams({...values,_csrf:session.token})
  });
  session.cookie=cookieFrom(response,session.cookie);
  return response;
}
async function login(pathname,identifier,password) {
  const session={cookie:""};
  const page=await get(pathname,session);
  assert.equal(page.status,200);
  session.token=tokenFrom(await page.text());
  const endpoint=pathname==="/login"?"/login":"/customer/login";
  const fields=pathname==="/login"
    ? {identifier,password}
    : {customer_code:identifier,password};
  const response=await post(endpoint,session,fields);
  assert.equal(response.status,302);
  return session;
}
async function refreshToken(pathname,session) {
  const page=await get(pathname,session);
  assert.equal(page.status,200);
  const html=await page.text();
  session.token=tokenFrom(html);
  return html;
}

test("portal pelanggan membatasi data dan aksi pada pelanggan yang sedang login", async () => {
  const anonymous=await fetch(baseUrl+"/customer",{redirect:"manual"});
  assert.equal(anonymous.status,302);
  assert.equal(anonymous.headers.get("location"),"/customer/login");

  const customer=await login("/customer/login","FN-PORTAL-A","customer-a-password");
  const html=await refreshToken("/customer",customer);
  assert.match(html,/INV-PORTAL-A/);
  assert.doesNotMatch(html,/INV-PORTAL-B/);

  const ownPrint=await get("/customer/invoices/"+invoiceA+"/print",customer);
  assert.equal(ownPrint.status,200);
  assert.match(await ownPrint.text(),/INV-PORTAL-A/);

  const otherPrint=await get("/customer/invoices/"+invoiceB+"/print",customer);
  assert.equal(otherPrint.status,404);

  await refreshToken("/customer",customer);
  const foreignConfirmation=await post("/customer/invoices/"+invoiceB+"/confirm-payment",customer,{
    amount_idr:"100000",payment_method:"bank_transfer",
    payment_reference:"REF-FOREIGN-001",paid_at:"2026-11-13"
  });
  assert.equal(foreignConfirmation.status,302);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customer_payment_confirmations WHERE payment_reference='REF-FOREIGN-001'").get().n,0);

  await refreshToken("/customer",customer);
  const confirmation=await post("/customer/invoices/"+invoiceA+"/confirm-payment",customer,{
    amount_idr:"100000",payment_method:"bank_transfer",
    payment_reference:"REF-PORTAL-A-001",paid_at:"2026-11-13",notes:"Pembayaran via transfer"
  });
  assert.equal(confirmation.status,302);
  const saved=db.prepare("SELECT * FROM customer_payment_confirmations WHERE payment_reference='REF-PORTAL-A-001'").get();
  assert.ok(saved);
  assert.equal(saved.status,"pending");
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoiceA).status,"unpaid");

  const forbiddenAdmin=await get("/billing",customer,"manual");
  assert.equal(forbiddenAdmin.status,302);
  assert.equal(forbiddenAdmin.headers.get("location"),"/login");
});

test("admin menyetujui konfirmasi portal dan pembayaran baru dicatat setelah persetujuan", async () => {
  const admin=await login("/login","portal-admin@example.test","admin-test-password");
  await refreshToken("/billing",admin);
  const confirmation=db.prepare("SELECT id FROM customer_payment_confirmations WHERE payment_reference='REF-PORTAL-A-001'").get();
  assert.ok(confirmation);
  const response=await post("/billing/payment-confirmations/"+confirmation.id+"/approve",admin,{});
  assert.equal(response.status,302);

  const saved=db.prepare("SELECT status,payment_id FROM customer_payment_confirmations WHERE id=?").get(confirmation.id);
  assert.equal(saved.status,"approved");
  assert.ok(saved.payment_id);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoiceA).status,"paid");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE invoice_id=?").get(invoiceA).n,1);

  billing.recordPaymentReversal({
    paymentId:saved.payment_id,
    input:{amount_idr:"100000",reason:"Simulasi integrasi: koreksi pembayaran uji."},
    userId:adminId
  });

  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoiceA).status,"unpaid");
  assert.equal(db.prepare(`
    SELECT COALESCE(p.amount_idr,0)-COALESCE(SUM(r.amount_idr),0) AS net
    FROM payments p LEFT JOIN payment_reversals r ON r.payment_id=p.id
    WHERE p.id=?
    GROUP BY p.id
  `).get(saved.payment_id).net,0);

  // The immutable approval record remains unchanged; both interfaces derive
  // the customer-facing status from the linked payment's reversal history.
  assert.equal(db.prepare("SELECT status FROM customer_payment_confirmations WHERE id=?").get(confirmation.id).status,"approved");
  const adminHtml=await refreshToken("/billing",admin);
  assert.match(adminHtml,/Dibalik/);

  const customer=await login("/customer/login","FN-PORTAL-A","customer-a-password");
  const customerHtml=await refreshToken("/customer",customer);
  assert.match(customerHtml,/Dibalik/);
  assert.match(customerHtml,/INV-PORTAL-A/);
});

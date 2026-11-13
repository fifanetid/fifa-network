const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-billing-http-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "billing.sqlite");
process.env.SESSION_SECRET = "http-test-secret-that-is-long-enough-123456";
const { db } = require("../../database/db");
const app = require("../../apps/web/app");

for (const [name, email, role] of [
  ["Admin HTTP", "admin-http@example.test", "admin"],
  ["Finance HTTP", "finance-http@example.test", "finance"],
  ["Teknisi HTTP", "teknisi-http@example.test", "teknisi"]
]) {
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)")
    .run(name, email, bcrypt.hashSync("test-password-123", 4), role);
}

const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function tokenFrom(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, "CSRF token must be present in rendered form");
  return match[1];
}
function cookieFrom(response, current) {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";")[0] : current;
}
async function login(email) {
  let cookie = "";
  const loginPage = await fetch(baseUrl + "/login");
  cookie = cookieFrom(loginPage, cookie);
  const token = tokenFrom(await loginPage.text());
  const response = await fetch(baseUrl + "/login", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ identifier: email, password: "test-password-123", _csrf: token })
  });
  cookie = cookieFrom(response, cookie);
  assert.equal(response.status, 302, "valid credentials should log in");
  return { cookie };
}
async function get(pathname, session) {
  const response = await fetch(baseUrl + pathname, { headers: { cookie: session.cookie } });
  session.cookie = cookieFrom(response, session.cookie);
  return response;
}
async function post(pathname, session, values, csrf = true) {
  const response = await fetch(baseUrl + pathname, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: session.cookie
    },
    body: new URLSearchParams(csrf ? { ...values, _csrf: session.token } : values)
  });
  session.cookie = cookieFrom(response, session.cookie);
  return response;
}
async function refreshToken(session) {
  const page = await get("/billing", session);
  assert.equal(page.status, 200);
  session.token = tokenFrom(await page.text());
}

test("billing HTTP flow enforces login, role, CSRF, CRUD and invoice payment lifecycle", async () => {
  const anonymous = await fetch(baseUrl + "/billing", { redirect: "manual" });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("location"), "/login");

  const technician = await login("teknisi-http@example.test");
  const technicianPage = await get("/billing", technician);
  assert.equal(technicianPage.status, 403);

  const finance = await login("finance-http@example.test");
  await refreshToken(finance);
  const noCsrf = await post("/billing/customers", finance, {
    customer_code: "HTTP-NOCSRF",
    full_name: "Customer Without CSRF",
    phone: "081234567890",
    address: "Alamat Uji HTTP"
  }, false);
  assert.equal(noCsrf.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE customer_code='HTTP-NOCSRF'").get().n, 0);

  const financePlan = await post("/billing/plans", finance, {
    plan_code: "HTTP-FINANCE",
    name: "Paket Finance",
    speed_mbps: "10",
    monthly_price_idr: "100000"
  });
  assert.equal(financePlan.status, 403, "finance must not create or edit plans");

  const createdCustomer = await post("/billing/customers", finance, {
    customer_code: "HTTP-FN-001",
    full_name: "Pelanggan HTTP",
    phone: "081234567890",
    email: "http-customer@example.test",
    address: "Jl. Pengujian HTTP No. 1"
  });
  assert.equal(createdCustomer.status, 302);
  await refreshToken(finance);
  const customerId = db.prepare("SELECT id FROM customers WHERE customer_code='HTTP-FN-001'").get().id;
  const updatedCustomer = await post("/billing/customers/" + customerId + "/update", finance, {
    customer_code: "HTTP-FN-001",
    full_name: "Pelanggan HTTP Diperbarui",
    phone: "081234567890",
    email: "http-customer@example.test",
    address: "Jl. Pengujian HTTP No. 2"
  });
  assert.equal(updatedCustomer.status, 302);
  await refreshToken(finance);

  const admin = await login("admin-http@example.test");
  await refreshToken(admin);
  const createdPlan = await post("/billing/plans", admin, {
    plan_code: "HTTP-FIF10",
    name: "Paket Uji 10 Mbps",
    speed_mbps: "10",
    monthly_price_idr: "100000"
  });
  assert.equal(createdPlan.status, 302);
  await refreshToken(admin);
  const planId = db.prepare("SELECT id FROM internet_plans WHERE plan_code='HTTP-FIF10'").get().id;

  const createdSubscription = await post("/billing/subscriptions", finance, {
    customer_id: String(customerId),
    plan_id: String(planId),
    start_date: "2026-11-01",
    billing_day: "1",
    external_device_ref: "EXT-DEVICE-HTTP-001"
  });
  assert.equal(createdSubscription.status, 302);
  await refreshToken(finance);
  const subscriptionId = db.prepare("SELECT id FROM subscriptions WHERE customer_id=? AND plan_id=?").get(customerId, planId).id;

  const invalidInvoice = await post("/billing/invoices", finance, {
    subscription_id: String(subscriptionId),
    billing_period: "2026-13",
    due_date: "2026-12-20",
    discount_idr: "0"
  });
  assert.equal(invalidInvoice.status, 400);

  await refreshToken(finance);
  const createdInvoice = await post("/billing/invoices", finance, {
    subscription_id: String(subscriptionId),
    billing_period: "2026-11",
    due_date: "2026-11-20",
    discount_idr: "10000"
  });
  assert.equal(createdInvoice.status, 302);
  await refreshToken(finance);
  const invoice = db.prepare("SELECT * FROM invoices WHERE subscription_id=? AND billing_period='2026-11'").get(subscriptionId);
  assert.equal(invoice.total_idr, 90000);

  const firstPayment = await post("/billing/invoices/" + invoice.id + "/payments", finance, {
    amount_idr: "40000",
    payment_method: "cash",
    paid_at: "2026-11-10"
  });
  assert.equal(firstPayment.status, 302);
  await refreshToken(finance);
  const payment = db.prepare("SELECT * FROM payments WHERE invoice_id=?").get(invoice.id);
  assert.equal(payment.amount_idr, 40000);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status, "partial");

  const financeReversal = await post("/billing/payments/" + payment.id + "/reversals", finance, {
    amount_idr: "10000",
    reason: "Finance tidak berwenang reversal"
  });
  assert.equal(financeReversal.status, 403);

  await refreshToken(admin);
  const reversal = await post("/billing/payments/" + payment.id + "/reversals", admin, {
    amount_idr: "10000",
    reason: "Koreksi transaksi uji"
  });
  assert.equal(reversal.status, 302);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status, "partial");

  await refreshToken(finance);
  const finalPayment = await post("/billing/invoices/" + invoice.id + "/payments", finance, {
    amount_idr: "60000",
    payment_method: "bank_transfer",
    paid_at: "2026-11-11"
  });
  assert.equal(finalPayment.status, 302);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=?").get(invoice.id).status, "paid");

  const page = await get("/billing", finance);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Pelanggan HTTP Diperbarui/);
});

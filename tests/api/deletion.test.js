const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-safe-delete-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "delete.sqlite");
process.env.SESSION_SECRET = "safe-delete-test-secret-long-enough-123456";

const { db } = require("../../database/db");
const app = require("../../apps/web/app");
const { recordAudit } = require("../../modules/audit");

function addUser(name, email, role) {
  return db.prepare(
    "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)"
  ).run(name, email, bcrypt.hashSync("delete-test-password", 4), role).lastInsertRowid;
}

function addCustomer(code, name, phone) {
  return db.prepare(`
    INSERT INTO customers (customer_code,full_name,phone,address,status)
    VALUES (?,?,?,'Alamat pengujian hapus data','active')
  `).run(code, name, phone).lastInsertRowid;
}

const adminOne = addUser("Admin One", "admin-one@example.test", "admin");
const adminTwo = addUser("Admin Two", "admin-two@example.test", "admin");
const financeId = addUser("Finance", "finance-delete@example.test", "finance");

const cleanCustomer = addCustomer("DELETE-CLEAN", "Pelanggan Tanpa Riwayat", "081234567801");
db.prepare("INSERT INTO customer_portal_accounts (customer_id,password_hash) VALUES (?,?)")
  .run(cleanCustomer, bcrypt.hashSync("portal-test-password", 4));

const historyCustomer = addCustomer("DELETE-HISTORY", "Pelanggan Berriwayat", "081234567802");
const planId = db.prepare(`
  INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr)
  VALUES ('DELETE-PLAN','Paket Riwayat',10,100000)
`).run().lastInsertRowid;
const subscriptionId = db.prepare(`
  INSERT INTO subscriptions (customer_id,plan_id,start_date,status)
  VALUES (?,?,?,'active')
`).run(historyCustomer, planId, "2026-11-01").lastInsertRowid;
const invoiceId = db.prepare(`
  INSERT INTO invoices
    (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,status)
  VALUES ('INV-DELETE-HISTORY',?,?, '2026-11','2026-11-20',100000,0,100000,'unpaid')
`).run(subscriptionId, historyCustomer).lastInsertRowid;
db.prepare(`
  INSERT INTO whatsapp_message_logs (customer_id,invoice_id,phone,message_type,status)
  VALUES (?,?,?,'reminder','sent')
`).run(historyCustomer, invoiceId, "081234567802");

recordAudit({
  user: { id: adminTwo, name: "Admin Two", role: "admin" },
  action: "test.user.history",
  entityType: "test",
  entityId: "user-" + adminTwo,
  summary: "Riwayat audit sebelum akun target dihapus"
});

const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function tokenFrom(html) {
  const match = html.match(/name="_csrf"\\s+value="([^"]+)"/);
  assert.ok(match, "CSRF token harus tersedia pada halaman.");
  return match[1];
}

function cookieFrom(response, current = "") {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";")[0] : current;
}

async function get(pathname, session, redirect = "follow") {
  const response = await fetch(baseUrl + pathname, {
    headers: { cookie: session.cookie || "" },
    redirect
  });
  session.cookie = cookieFrom(response, session.cookie || "");
  return response;
}

async function post(pathname, session, values = {}) {
  const response = await fetch(baseUrl + pathname, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": session.token,
      cookie: session.cookie
    },
    body: new URLSearchParams({ ...values, _csrf: session.token })
  });
  session.cookie = cookieFrom(response, session.cookie);
  return response;
}

async function login(email) {
  const session = { cookie: "" };
  const page = await get("/login", session);
  assert.equal(page.status, 200);
  session.token = tokenFrom(await page.text());
  const response = await post("/login", session, {
    identifier: email,
    password: "delete-test-password"
  });
  assert.equal(response.status, 302);
  return session;
}

async function refreshToken(pathname, session) {
  const page = await get(pathname, session);
  assert.equal(page.status, 200);
  session.token = tokenFrom(await page.text());
  return page.text();
}

test("admin dapat menghapus pengguna lain, tetapi bukan dirinya; sesi akun terhapus dicabut", async () => {
  const admin = await login("admin-one@example.test");
  const targetSession = await login("admin-two@example.test");

  await refreshToken("/admin/users", admin);
  const selfDelete = await post("/admin/users/" + adminOne + "/delete", admin);
  assert.equal(selfDelete.status, 302);
  assert.ok(db.prepare("SELECT id FROM users WHERE id=?").get(adminOne));

  await refreshToken("/admin/users", admin);
  const deleteTarget = await post("/admin/users/" + adminTwo + "/delete", admin);
  assert.equal(deleteTarget.status, 302);
  assert.equal(db.prepare("SELECT id FROM users WHERE id=?").get(adminTwo), undefined);

  const preservedAudit = db.prepare(`
    SELECT actor_user_id,actor_name,summary
    FROM audit_logs
    WHERE action='test.user.history' AND entity_id=?
  `).get("user-" + adminTwo);
  assert.equal(preservedAudit.actor_user_id, null);
  assert.equal(preservedAudit.actor_name, "Admin Two");
  assert.equal(preservedAudit.summary, "Riwayat audit sebelum akun target dihapus");

  const staleSession = await get("/admin/users", targetSession, "manual");
  assert.equal(staleSession.status, 302);
  assert.equal(staleSession.headers.get("location"), "/login");
});

test("admin dapat menghapus pelanggan tanpa riwayat dan akun portal ikut dicabut", async () => {
  const admin = await login("admin-one@example.test");
  await refreshToken("/billing", admin);
  const response = await post("/billing/customers/" + cleanCustomer + "/delete", admin);
  assert.equal(response.status, 302);
  assert.equal(db.prepare("SELECT id FROM customers WHERE id=?").get(cleanCustomer), undefined);
  assert.equal(db.prepare("SELECT id FROM customer_portal_accounts WHERE customer_id=?").get(cleanCustomer), undefined);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='customer.delete' AND entity_id=?")
      .get(String(cleanCustomer)).total,
    1
  );
});

test("pelanggan dengan riwayat layanan atau WhatsApp tidak dapat dihapus permanen", async () => {
  const admin = await login("admin-one@example.test");
  await refreshToken("/billing", admin);
  const response = await post("/billing/customers/" + historyCustomer + "/delete", admin);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"), baseUrl);
  assert.match(location.searchParams.get("error"), /tidak dapat dihapus/i);
  assert.ok(db.prepare("SELECT id FROM customers WHERE id=?").get(historyCustomer));
  assert.ok(db.prepare("SELECT id FROM subscriptions WHERE customer_id=?").get(historyCustomer));
  assert.ok(db.prepare("SELECT id FROM invoices WHERE id=?").get(invoiceId));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM whatsapp_message_logs WHERE customer_id=?").get(historyCustomer).total,
    1
  );
});

test("finance tidak memiliki izin menghapus pelanggan", async () => {
  const finance = await login("finance-delete@example.test");
  await refreshToken("/billing", finance);
  const response = await post("/billing/customers/" + historyCustomer + "/delete", finance);
  assert.equal(response.status, 403);
  assert.ok(db.prepare("SELECT id FROM customers WHERE id=?").get(historyCustomer));
});

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-plans-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "plans.sqlite");
process.env.SESSION_SECRET = "plans-test-secret-that-is-long-enough-123456";

const { db } = require("../../database/db");
const app = require("../../apps/web/app");

for (const [name, email, role] of [
  ["Admin Plans", "admin-plans@example.test", "admin"],
  ["Finance Plans", "finance-plans@example.test", "finance"],
  ["Teknisi Plans", "teknisi-plans@example.test", "teknisi"]
]) {
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)")
    .run(name, email, bcrypt.hashSync("plans-test-password", 4), role);
}

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
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, "CSRF token harus tersedia.");
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
    password: "plans-test-password"
  });
  assert.equal(response.status, 302);
  return session;
}

async function refreshToken(pathname, session) {
  const page = await get(pathname, session);
  assert.equal(page.status, 200);
  const html = await page.text();
  session.token = tokenFrom(html);
  return html;
}

test("satu menu Paket Internet menyediakan tab bulanan dan voucher untuk admin dan finance", async () => {
  const admin = await login("admin-plans@example.test");
  const monthlyHtml = await refreshToken("/plans", admin);
  assert.match(monthlyHtml, /Paket Internet/);
  assert.match(monthlyHtml, /href="\/plans"/);
  assert.match(monthlyHtml, /href="\/plans\?type=monthly"/);
  assert.match(monthlyHtml, /href="\/plans\?type=voucher"/);
  assert.match(monthlyHtml, /Paket Bulanan/);
  assert.match(monthlyHtml, /Paket Voucher/);
  assert.match(monthlyHtml, /class="plan-add-details plan-modal"/);
  assert.match(monthlyHtml, /Tambah paket internet bulanan/);
  assert.match(monthlyHtml, /Daftar paket bulanan/);
  assert.doesNotMatch(monthlyHtml, /Daftar paket voucher/);

  const voucherHtml = await refreshToken("/plans?type=voucher", admin);
  assert.match(voucherHtml, /class="plan-type-tabs"/);
  assert.match(voucherHtml, /aria-current="page"/);
  assert.match(voucherHtml, /Daftar paket voucher/);
  assert.doesNotMatch(voucherHtml, /Daftar paket bulanan/);
  assert.match(voucherHtml, /Tambah paket voucher/);

  // Legacy bookmarks keep working but lead to the matching tab on the same page.
  const legacyMonthly = await get("/plans/monthly", admin, "manual");
  assert.equal(legacyMonthly.status, 302);
  assert.equal(legacyMonthly.headers.get("location"), "/plans?type=monthly");
  const legacyVoucher = await get("/plans/voucher", admin, "manual");
  assert.equal(legacyVoucher.status, 302);
  assert.equal(legacyVoucher.headers.get("location"), "/plans?type=voucher");

  const modalCssResponse = await fetch(baseUrl + "/assets/css/billing.css");
  assert.equal(modalCssResponse.status, 200);
  const modalCss = await modalCssResponse.text();
  assert.ok(modalCss.includes(".plan-modal[open]"));
  assert.ok(modalCss.includes("overflow-y:auto"));
  assert.ok(modalCss.includes(".plan-modal-actions"));

  const finance = await login("finance-plans@example.test");
  const financeHtml = await refreshToken("/plans", finance);
  assert.match(financeHtml, /Paket Internet/);
  assert.doesNotMatch(financeHtml, /Tambah paket/);
});
test("paket bulanan dapat dibuat, diubah, dan dinonaktifkan oleh admin", async () => {
  const admin = await login("admin-plans@example.test");
  await refreshToken("/plans?type=monthly", admin);

  const created = await post("/plans/monthly", admin, {
    plan_code: "MONTH-15",
    name: "Internet 15 Mbps",
    speed_mbps: "15",
    monthly_price_idr: "125000",
    description: "Paket internet rumah"
  });
  assert.equal(created.status, 302);
  const plan = db.prepare("SELECT * FROM internet_plans WHERE plan_code='MONTH-15'").get();
  assert.ok(plan);
  assert.equal(plan.speed_mbps, 15);
  assert.equal(plan.monthly_price_idr, 125000);
  assert.equal(plan.is_active, 1);

  await refreshToken("/plans?type=monthly", admin);
  const updated = await post("/plans/monthly/" + plan.id + "/update", admin, {
    plan_code: "MONTH-15",
    name: "Internet 15 Mbps Plus",
    speed_mbps: "15",
    monthly_price_idr: "130000",
    description: "Harga diperbarui"
  });
  assert.equal(updated.status, 302);
  const saved = db.prepare("SELECT * FROM internet_plans WHERE id=?").get(plan.id);
  assert.equal(saved.name, "Internet 15 Mbps Plus");
  assert.equal(saved.monthly_price_idr, 130000);

  await refreshToken("/plans?type=monthly", admin);
  const disabled = await post("/plans/monthly/" + plan.id + "/status", admin);
  assert.equal(disabled.status, 302);
  assert.equal(db.prepare("SELECT is_active FROM internet_plans WHERE id=?").get(plan.id).is_active, 0);

  const monthlyPage = await refreshToken("/plans?type=monthly", admin);
  assert.match(monthlyPage, new RegExp("/plans/monthly/" + plan.id + "/delete"));
  const deleted = await post("/plans/monthly/" + plan.id + "/delete", admin);
  assert.equal(deleted.status, 302);
  assert.equal(db.prepare("SELECT id FROM internet_plans WHERE id=?").get(plan.id), undefined);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='plan.delete' AND entity_id=?")
      .get(String(plan.id)).total,
    1
  );
});

test("paket bulanan yang sudah dipakai langganan tidak dapat dihapus", async () => {
  const admin = await login("admin-plans@example.test");
  const planId = db.prepare(`
    INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr)
    VALUES ('MONTH-USED','Paket Terpakai',10,100000)
  `).run().lastInsertRowid;
  const customerId = db.prepare(`
    INSERT INTO customers (customer_code,full_name,phone,address)
    VALUES ('CUST-PLAN-USED','Pelanggan Paket Terpakai','081234567899','Alamat pengujian paket terpakai')
  `).run().lastInsertRowid;
  const subscriptionId = db.prepare(`
    INSERT INTO subscriptions (customer_id,plan_id,start_date)
    VALUES (?,?,?)
  `).run(customerId, planId, "2026-11-01").lastInsertRowid;

  const html = await refreshToken("/plans?type=monthly", admin);
  assert.match(html, new RegExp("Paket masih digunakan oleh 1 langganan"));
  assert.match(html, /class="danger-button is-disabled" type="button" disabled/);

  const response = await post("/plans/monthly/" + planId + "/delete", admin);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"), baseUrl);
  assert.match(location.searchParams.get("error"), /1 langganan/i);
  assert.ok(db.prepare("SELECT id FROM internet_plans WHERE id=?").get(planId));
  assert.ok(db.prepare("SELECT id FROM subscriptions WHERE id=?").get(subscriptionId));
});

test("paket voucher menyimpan masa berlaku, kuota, kecepatan dan harga secara terpisah", async () => {
  const admin = await login("admin-plans@example.test");
  await refreshToken("/plans?type=voucher", admin);

  const created = await post("/plans/voucher", admin, {
    package_code: "VCR-2GB-1D",
    name: "Voucher 2 GB 1 Hari",
    validity_value: "1",
    validity_unit: "days",
    quota_mb: "2048",
    speed_mbps: "10",
    price_idr: "7000",
    description: "Voucher harian"
  });
  assert.equal(created.status, 302);
  const voucher = db.prepare("SELECT * FROM voucher_packages WHERE package_code='VCR-2GB-1D'").get();
  assert.ok(voucher);
  assert.equal(voucher.validity_value, 1);
  assert.equal(voucher.validity_unit, "days");
  assert.equal(voucher.quota_mb, 2048);
  assert.equal(voucher.speed_mbps, 10);
  assert.equal(voucher.price_idr, 7000);
  assert.equal(voucher.is_active, 1);

  await refreshToken("/plans?type=voucher", admin);
  const updated = await post("/plans/voucher/" + voucher.id + "/update", admin, {
    package_code: "VCR-2GB-1D",
    name: "Voucher Harian 2 GB",
    validity_value: "24",
    validity_unit: "hours",
    quota_mb: "",
    speed_mbps: "",
    price_idr: "8000",
    description: "Masa 24 jam tanpa batas kuota"
  });
  assert.equal(updated.status, 302);
  const saved = db.prepare("SELECT * FROM voucher_packages WHERE id=?").get(voucher.id);
  assert.equal(saved.name, "Voucher Harian 2 GB");
  assert.equal(saved.validity_unit, "hours");
  assert.equal(saved.quota_mb, null);
  assert.equal(saved.speed_mbps, null);
  assert.equal(saved.price_idr, 8000);

  await refreshToken("/plans?type=voucher", admin);
  const disabled = await post("/plans/voucher/" + voucher.id + "/status", admin);
  assert.equal(disabled.status, 302);
  assert.equal(db.prepare("SELECT is_active FROM voucher_packages WHERE id=?").get(voucher.id).is_active, 0);

  const voucherPage = await refreshToken("/plans?type=voucher", admin);
  assert.match(voucherPage, new RegExp("/plans/voucher/" + voucher.id + "/delete"));
  const deleted = await post("/plans/voucher/" + voucher.id + "/delete", admin);
  assert.equal(deleted.status, 302);
  assert.equal(db.prepare("SELECT id FROM voucher_packages WHERE id=?").get(voucher.id), undefined);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='voucher_plan.delete' AND entity_id=?")
      .get(String(voucher.id)).total,
    1
  );
});

test("validasi voucher menolak masa berlaku dan nilai harga yang tidak valid", async () => {
  const admin = await login("admin-plans@example.test");
  await refreshToken("/plans?type=voucher", admin);
  const invalid = await post("/plans/voucher", admin, {
    package_code: "VCR-BAD",
    name: "Voucher tidak valid",
    validity_value: "0",
    validity_unit: "weeks",
    quota_mb: "-5",
    speed_mbps: "0",
    price_idr: "-1"
  });
  assert.equal(invalid.status, 302);
  assert.match(invalid.headers.get("location"), /error=/);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM voucher_packages WHERE package_code='VCR-BAD'").get().total, 0);
});

test("finance dapat melihat katalog tetapi tidak dapat mengubah paket; teknisi tidak dapat membuka katalog", async () => {
  const finance = await login("finance-plans@example.test");
  await refreshToken("/plans?type=voucher", finance);
  const denied = await post("/plans/voucher", finance, {
    package_code: "VCR-FINANCE",
    name: "Voucher Finance",
    validity_value: "1",
    validity_unit: "days",
    price_idr: "5000"
  });
  assert.equal(denied.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM voucher_packages WHERE package_code='VCR-FINANCE'").get().total, 0);

  const voucherId = db.prepare(`
    INSERT INTO voucher_packages
      (package_code,name,validity_value,validity_unit,price_idr)
    VALUES ('VCR-FIN-DELETE','Voucher Finance Delete',1,'days',5000)
  `).run().lastInsertRowid;
  const deniedDelete = await post("/plans/voucher/" + voucherId + "/delete", finance);
  assert.equal(deniedDelete.status, 403);
  assert.ok(db.prepare("SELECT id FROM voucher_packages WHERE id=?").get(voucherId));

  const technician = await login("teknisi-plans@example.test");
  const deniedPage = await get("/plans?type=monthly", technician);
  assert.equal(deniedPage.status, 403);
});

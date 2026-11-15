const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-support-tickets-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "support.sqlite");
process.env.SESSION_SECRET = "support-ticket-test-secret-long-enough-123456";

const { db } = require("../../database/db");
const app = require("../../apps/web/app");

function addUser(name, email, role, active = 1) {
  return db.prepare(
    "INSERT INTO users (name,email,password_hash,role,is_active) VALUES (?,?,?,?,?)"
  ).run(name, email, bcrypt.hashSync("support-test-password", 4), role, active).lastInsertRowid;
}
function addCustomer(code, name, phone) {
  return db.prepare(`
    INSERT INTO customers (customer_code,full_name,phone,address,status)
    VALUES (?,?,?,'Alamat uji keluhan','active')
  `).run(code, name, phone).lastInsertRowid;
}
function addPortalAccount(customerId, password) {
  db.prepare("INSERT INTO customer_portal_accounts (customer_id,password_hash) VALUES (?,?)")
    .run(customerId, bcrypt.hashSync(password, 4));
}

const adminId = addUser("Admin Support", "admin-support@example.test", "admin");
const financeId = addUser("Finance Support", "finance-support@example.test", "finance");
const technicianId = addUser("Teknisi Support", "teknisi-support@example.test", "teknisi");
addUser("Teknisi Nonaktif", "inactive-support@example.test", "teknisi", 0);
const customerA = addCustomer("FN-SUPPORT-A", "Pelanggan Support A", "081234567801");
const customerB = addCustomer("FN-SUPPORT-B", "Pelanggan Support B", "081234567802");
addPortalAccount(customerA, "customer-a-support-password");
addPortalAccount(customerB, "customer-b-support-password");

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
  assert.ok(match, "CSRF token must be present in rendered forms");
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
async function login(staff, identifier) {
  const session = { cookie: "" };
  const loginPage = await get(staff ? "/login" : "/customer/login", session);
  assert.equal(loginPage.status, 200);
  session.token = tokenFrom(await loginPage.text());
  const response = await post(staff ? "/login" : "/customer/login", session, staff
    ? { identifier, password: "support-test-password" }
    : { customer_code: identifier, password: identifier === "FN-SUPPORT-A" ? "customer-a-support-password" : "customer-b-support-password" });
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
async function createPortalTicket(customerSession, subject = "Internet sering terputus", message = "Koneksi terputus setiap beberapa menit sejak pagi.") {
  await refreshToken("/customer/tickets", customerSession);
  const response = await post("/customer/tickets", customerSession, {
    category: "internet", subject, message
  });
  assert.equal(response.status, 302);
  const ticket = db.prepare("SELECT * FROM support_tickets WHERE subject=?").get(subject);
  assert.ok(ticket);
  return ticket;
}

test("pelanggan dapat membuat laporan, melihat percakapan, dan hanya mengakses tiket miliknya", async () => {
  const anonymous = await fetch(baseUrl + "/customer/tickets", { redirect: "manual" });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("location"), "/customer/login");

  const customer = await login(false, "FN-SUPPORT-A");
  const ticket = await createPortalTicket(customer);
  assert.equal(ticket.customer_id, customerA);
  assert.equal(ticket.status, "open");
  assert.equal(ticket.priority, "normal");
  assert.match(ticket.ticket_number, /^TKT-\d{6}-[A-F0-9]{10}$/);

  let ownHtml = await refreshToken("/customer/tickets/" + ticket.id, customer);
  assert.match(ownHtml, /Internet sering terputus/);
  assert.match(ownHtml, /Koneksi terputus setiap beberapa menit/);

  const otherCustomer = await login(false, "FN-SUPPORT-B");
  const foreignPage = await get("/customer/tickets/" + ticket.id, otherCustomer);
  assert.equal(foreignPage.status, 404);
  const foreignList = await refreshToken("/customer/tickets", otherCustomer);
  assert.doesNotMatch(foreignList, new RegExp(ticket.ticket_number));

  await refreshToken("/customer/tickets/" + ticket.id, customer);
  const reply = await post("/customer/tickets/" + ticket.id + "/reply", customer, {
    message: "Lampu LOS tidak menyala, tetapi lampu internet berkedip."
  });
  assert.equal(reply.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM support_ticket_messages WHERE ticket_id=?").get(ticket.id).total, 2);
  assert.equal(db.prepare("SELECT status FROM support_tickets WHERE id=?").get(ticket.id).status, "open");

  const dashboard = await refreshToken("/customer", customer);
  assert.match(dashboard, /Keluhan dan gangguan/);
  assert.match(dashboard, /1 laporan/);
});

test("petugas dapat memfilter, menugaskan, mengubah status, dan membalas laporan", async () => {
  const customer = await login(false, "FN-SUPPORT-A");
  const ticket = await createPortalTicket(customer, "Tagihan tidak sesuai", "Nominal tagihan bulan ini berbeda dari informasi paket.");
  const technician = await login(true, "teknisi-support@example.test");

  let inbox = await refreshToken("/admin/tickets", technician);
  assert.match(inbox, /Keluhan Pelanggan/);
  assert.match(inbox, new RegExp(ticket.ticket_number));
  assert.match(inbox, /Tagihan tidak sesuai/);

  const detail = await refreshToken("/admin/tickets/" + ticket.id, technician);
  assert.match(detail, /Data pelanggan/);
  assert.match(detail, /Percakapan/);

  const updated = await post("/admin/tickets/" + ticket.id + "/update", technician, {
    status: "in_progress",
    priority: "high",
    assigned_to: String(technicianId)
  });
  assert.equal(updated.status, 302);
  let saved = db.prepare("SELECT status,priority,assigned_to FROM support_tickets WHERE id=?").get(ticket.id);
  assert.deepEqual(saved, { status: "in_progress", priority: "high", assigned_to: technicianId });

  await refreshToken("/admin/tickets/" + ticket.id, technician);
  const reply = await post("/admin/tickets/" + ticket.id + "/reply", technician, {
    message: "Kami sedang memeriksa profil jaringan dan perangkat pelanggan."
  });
  assert.equal(reply.status, 302);
  saved = db.prepare("SELECT status,first_response_at FROM support_tickets WHERE id=?").get(ticket.id);
  assert.equal(saved.status, "waiting_customer");
  assert.ok(saved.first_response_at);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM support_ticket_messages WHERE ticket_id=?").get(ticket.id).total, 2);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE entity_type='support_ticket' AND entity_id=?")
      .get(String(ticket.id)).total,
    2
  );

  // A staff account with immutable ticket replies cannot be deleted.
  const admin = await login(true, "admin-support@example.test");
  await refreshToken("/admin/users", admin);
  const deleteStaff = await post("/admin/users/" + technicianId + "/delete", admin);
  assert.equal(deleteStaff.status, 302);
  const location = new URL(deleteStaff.headers.get("location"), baseUrl);
  assert.match(location.searchParams.get("error"), /balasan keluhan pelanggan/i);
  assert.ok(db.prepare("SELECT id FROM users WHERE id=?").get(technicianId));
});

test("status selesai dapat dibuka kembali oleh pelanggan, tetapi tiket ditutup tidak menerima balasan", async () => {
  const customer = await login(false, "FN-SUPPORT-A");
  const ticket = await createPortalTicket(customer, "Akun portal tidak bisa dibuka", "Saya tidak dapat masuk ke portal meski password benar.");
  const admin = await login(true, "admin-support@example.test");

  await refreshToken("/admin/tickets/" + ticket.id, admin);
  let update = await post("/admin/tickets/" + ticket.id + "/update", admin, {
    status: "resolved", priority: "normal", assigned_to: ""
  });
  assert.equal(update.status, 302);
  assert.ok(db.prepare("SELECT resolved_at FROM support_tickets WHERE id=?").get(ticket.id).resolved_at);

  await refreshToken("/customer/tickets/" + ticket.id, customer);
  let reply = await post("/customer/tickets/" + ticket.id + "/reply", customer, {
    message: "Saya masih belum bisa masuk. Muncul pesan akun tidak ditemukan."
  });
  assert.equal(reply.status, 302);
  assert.equal(db.prepare("SELECT status FROM support_tickets WHERE id=?").get(ticket.id).status, "open");
  assert.equal(db.prepare("SELECT resolved_at FROM support_tickets WHERE id=?").get(ticket.id).resolved_at, null);

  await refreshToken("/admin/tickets/" + ticket.id, admin);
  update = await post("/admin/tickets/" + ticket.id + "/update", admin, {
    status: "closed", priority: "normal", assigned_to: ""
  });
  assert.equal(update.status, 302);
  assert.ok(db.prepare("SELECT closed_at FROM support_tickets WHERE id=?").get(ticket.id).closed_at);

  await refreshToken("/customer/tickets/" + ticket.id, customer);
  reply = await post("/customer/tickets/" + ticket.id + "/reply", customer, {
    message: "Balasan setelah ditutup seharusnya tidak disimpan."
  });
  assert.equal(reply.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM support_ticket_messages WHERE ticket_id=?").get(ticket.id).total, 3);
  assert.equal(db.prepare("SELECT status FROM support_tickets WHERE id=?").get(ticket.id).status, "closed");
});

test("validasi menolak tiket, balasan, status, prioritas, dan petugas yang tidak sah", async () => {
  const customer = await login(false, "FN-SUPPORT-B");
  await refreshToken("/customer/tickets", customer);
  await post("/customer/tickets", customer, {
    category: "invalid", subject: "No", message: "pendek"
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM support_tickets WHERE customer_id=?").get(customerB).total, 0);

  const ticket = await createPortalTicket(customer, "Koneksi lambat pada malam hari", "Kecepatan internet turun pada malam hari sejak tiga hari terakhir.");
  const admin = await login(true, "admin-support@example.test");
  await refreshToken("/admin/tickets/" + ticket.id, admin);
  let response = await post("/admin/tickets/" + ticket.id + "/update", admin, {
    status: "unknown", priority: "normal", assigned_to: ""
  });
  assert.equal(response.status, 302);
  assert.equal(db.prepare("SELECT status FROM support_tickets WHERE id=?").get(ticket.id).status, "open");

  await refreshToken("/admin/tickets/" + ticket.id, admin);
  response = await post("/admin/tickets/" + ticket.id + "/update", admin, {
    status: "in_progress", priority: "normal", assigned_to: "999999"
  });
  assert.equal(response.status, 302);
  assert.equal(db.prepare("SELECT assigned_to FROM support_tickets WHERE id=?").get(ticket.id).assigned_to, null);

  const inactiveId = db.prepare("SELECT id FROM users WHERE email='inactive-support@example.test'").get().id;
  await refreshToken("/admin/tickets/" + ticket.id, admin);
  response = await post("/admin/tickets/" + ticket.id + "/update", admin, {
    status: "in_progress", priority: "normal", assigned_to: String(inactiveId)
  });
  assert.equal(response.status, 302);
  assert.equal(db.prepare("SELECT assigned_to FROM support_tickets WHERE id=?").get(ticket.id).assigned_to, null);
});

test("tiket dan pesan memiliki pemilik tetap serta percakapan bersifat append-only", async () => {
  const customer = await login(false, "FN-SUPPORT-A");
  const ticket = await createPortalTicket(customer, "Router sering restart", "Router mati dan hidup kembali beberapa kali dalam sehari.");
  assert.throws(() => {
    db.prepare("UPDATE support_tickets SET customer_id=? WHERE id=?").run(customerB, ticket.id);
  }, /immutable/i);
  assert.throws(() => {
    db.prepare("INSERT INTO support_ticket_messages (ticket_id,sender_type,sender_customer_id,message) VALUES (?,'customer',?,?)")
      .run(ticket.id, customerB, "Pesan pelanggan lain yang tidak boleh masuk.");
  }, /must own the ticket/i);
  const messageId = db.prepare("SELECT id FROM support_ticket_messages WHERE ticket_id=?").get(ticket.id).id;
  assert.throws(() => {
    db.prepare("UPDATE support_ticket_messages SET message='diubah' WHERE id=?").run(messageId);
  }, /immutable/i);
  assert.throws(() => {
    db.prepare("DELETE FROM support_ticket_messages WHERE id=?").run(messageId);
  }, /immutable/i);
});

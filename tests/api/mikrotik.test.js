const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-mikrotik-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "mikrotik.sqlite");
process.env.SESSION_SECRET = "mikrotik-test-secret-long-enough-123456";
process.env.APP_ENCRYPTION_KEY = "a".repeat(64);

const { db } = require("../../database/db");
const app = require("../../apps/web/app");
const { encryptSecret, decryptSecret, loadEncryptionKey } = require("../../modules/security/secrets");
const { inspectRouter } = require("../../modules/mikrotik/client");
const mikrotikClient = require("../../modules/mikrotik/client");
const { isPrivateIpv4 } = require("../../apps/web/routes/mikrotik");

const adminId = db.prepare(
  "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')"
).run("Admin MikroTik", "admin-mikrotik@example.test", bcrypt.hashSync("mikrotik-test-password", 4)).lastInsertRowid;
db.prepare(
  "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'finance')"
).run("Finance MikroTik", "finance-mikrotik@example.test", bcrypt.hashSync("mikrotik-test-password", 4));

const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  mikrotikClient.inspectRouter = inspectRouter;
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
async function login(email) {
  const session = { cookie: "" };
  const page = await get("/login", session);
  assert.equal(page.status, 200);
  session.token = tokenFrom(await page.text());
  const response = await post("/login", session, {
    identifier: email,
    password: "mikrotik-test-password"
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

test("password dan sertifikat router dienkripsi dengan AES-256-GCM", () => {
  const password = "router-secret-password";
  const envelope = encryptSecret(password);
  assert.notEqual(envelope, password);
  assert.match(envelope, /^v1:/);
  assert.equal(decryptSecret(envelope), password);
  assert.throws(() => decryptSecret(envelope, "b".repeat(64)), /Unsupported state|authenticity|authenticate/i);
  assert.throws(() => loadEncryptionKey("not-a-valid-key"), /64 karakter hex/i);
  assert.throws(() => encryptSecret(""), /kosong/i);
});

test("validasi host hanya menerima IPv4 privat (loopback hanya untuk development)", () => {
  for (const host of ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.88.1"]) {
    assert.equal(isPrivateIpv4(host), true, host);
  }
  for (const host of ["8.8.8.8", "172.32.0.1", "192.167.1.1", "169.254.1.1", "router.local", "2001:db8::1"]) {
    assert.equal(isPrivateIpv4(host), false, host);
  }
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.equal(isPrivateIpv4("127.0.0.1"), false);
  process.env.NODE_ENV = previous;
});

test("client RouterOS hanya membaca identity, resource dan sesi PPP lalu menutup koneksi", async () => {
  const ca = "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----";
  const commands = [];
  let closed = false;
  let options;
  class FakeClient {
    constructor(value) { options = value; this.connected = false; }
    on() { return this; }
    async connect() { this.connected = true; }
    async write(command) {
      commands.push(command);
      if (command === "/system/identity/print") return [{ name: "CHR-UTAMA" }];
      if (command === "/system/resource/print") return [{
        version: "6.49.21", uptime: "2d", "cpu-load": "12",
        "cpu-count": "4", "free-memory": "900000000", "total-memory": "1000000000"
      }];
      if (command === "/ppp/active/print") return [
        { name: "pelanggan-01", service: "pppoe", "caller-id": "AA:BB:CC:DD:EE:FF", address: "10.10.10.2", uptime: "1h" },
        { name: "pelanggan-02", service: "l2tp", "caller-id": "AA:BB:CC:DD:EE:00", address: "10.10.10.3", uptime: "2h", password: "must-not-be-exposed" }
      ];
      throw new Error("Perintah tidak diizinkan oleh test.");
    }
    async close() { closed = true; this.connected = false; }
  }
  const router = {
    host: "192.168.88.1", api_port: 8729, api_tls: 1,
    api_username: "ffbilling",
    api_password_encrypted: encryptSecret("router-secret-password"),
    api_tls_ca_encrypted: encryptSecret(ca)
  };
  const result = await inspectRouter(router, { Client: FakeClient });
  assert.deepEqual(commands, [
    "/system/identity/print",
    "/system/resource/print",
    "/ppp/active/print"
  ]);
  assert.equal(options.host, "192.168.88.1");
  assert.equal(options.port, 8729);
  assert.equal(options.user, "ffbilling");
  assert.equal(options.password, "router-secret-password");
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.tls.ca.toString("utf8"), ca);
  assert.equal(closed, true);
  assert.equal(result.identity, "CHR-UTAMA");
  assert.equal(result.version, "6.49.21");
  assert.equal(result.cpuLoad, 12);
  assert.equal(result.activePppCount, 2);
  assert.equal(result.activePpp[0].name, "pelanggan-01");
  assert.equal(JSON.stringify(result.activePpp).includes("must-not-be-exposed"), false);
});

test("client menutup koneksi ketika perintah baca gagal", async () => {
  let closed = false;
  class FailingClient {
    constructor() { this.connected = false; }
    on() { return this; }
    async connect() { this.connected = true; }
    async write() { throw new Error("API permission denied"); }
    async close() { closed = true; this.connected = false; }
  }
  const router = {
    host: "192.168.88.1", api_port: 8728, api_tls: 0,
    api_username: "ffbilling",
    api_password_encrypted: encryptSecret("router-secret-password")
  };
  await assert.rejects(inspectRouter(router, { Client: FailingClient }), /permission denied/i);
  assert.equal(closed, true);
});

test("admin dapat menyimpan router, menguji koneksi, mengedit dan menghapus data koneksinya", async () => {
  const admin = await login("admin-mikrotik@example.test");
  let html = await refreshToken("/admin/mikrotik", admin);
  assert.match(html, /Router MikroTik/);
  assert.match(html, /APP_ENCRYPTION_KEY/);

  const invalid = await post("/admin/mikrotik/routers", admin, {
    router_name: "Router Publik", host: "8.8.8.8",
    api_username: "ffbilling", api_password: "router-secret-password"
  });
  assert.equal(invalid.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM mikrotik_routers").get().total, 0);

  await refreshToken("/admin/mikrotik", admin);
  const saved = await post("/admin/mikrotik/routers", admin, {
    router_name: "CHR Utama", host: "192.168.88.1",
    api_username: "ffbilling", api_password: "router-secret-password"
  });
  assert.equal(saved.status, 302);
  let router = db.prepare("SELECT * FROM mikrotik_routers").get();
  assert.ok(router);
  assert.equal(router.api_port, 8728);
  assert.notEqual(router.api_password_encrypted, "router-secret-password");
  assert.equal(decryptSecret(router.api_password_encrypted), "router-secret-password");

  const fakeResult = {
    identity: "CHR-UTAMA", version: "6.49.21", uptime: "2d",
    cpuLoad: 9, cpuCount: 4, memoryFreeBytes: 800000000,
    memoryTotalBytes: 1000000000, activePppCount: 1,
    activePpp: [{ name: "pelanggan-01", service: "pppoe", callerId: "AA:BB:CC:DD:EE:FF", address: "10.10.10.2", uptime: "1h", encoding: "" }]
  };
  mikrotikClient.inspectRouter = async target => {
    assert.equal(target.host, "192.168.88.1");
    return fakeResult;
  };

  await refreshToken("/admin/mikrotik", admin);
  const checked = await post("/admin/mikrotik/routers/" + router.id + "/test", admin);
  assert.equal(checked.status, 302);
  router = db.prepare("SELECT * FROM mikrotik_routers WHERE id=?").get(router.id);
  assert.equal(router.connection_status, "connected");
  assert.equal(router.active_ppp_count, 1);
  assert.equal(JSON.parse(router.active_ppp_json)[0].name, "pelanggan-01");
  html = await refreshToken("/admin/mikrotik", admin);
  assert.match(html, /CHR-UTAMA/);
  assert.match(html, /pelanggan-01/);
  assert.match(html, /6\.49\.21/);
  assert.doesNotMatch(html, /router-secret-password/);

  const ca = "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----";
  await refreshToken("/admin/mikrotik", admin);
  const edited = await post("/admin/mikrotik/routers/" + router.id + "/update", admin, {
    router_name: "CHR Utama TLS", host: "192.168.88.2",
    api_username: "ffbilling", api_password: "",
    api_tls: "1", api_tls_ca: ca
  });
  assert.equal(edited.status, 302);
  router = db.prepare("SELECT * FROM mikrotik_routers WHERE id=?").get(router.id);
  assert.equal(router.api_port, 8729);
  assert.equal(router.api_tls, 1);
  assert.equal(decryptSecret(router.api_password_encrypted), "router-secret-password");
  assert.equal(decryptSecret(router.api_tls_ca_encrypted), ca);
  assert.equal(router.connection_status, "not_tested");

  await refreshToken("/admin/mikrotik", admin);
  const removed = await post("/admin/mikrotik/routers/" + router.id + "/delete", admin);
  assert.equal(removed.status, 302);
  assert.equal(db.prepare("SELECT id FROM mikrotik_routers WHERE id=?").get(router.id), undefined);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE entity_type='mikrotik_router'").get().total,
    4
  );
  assert.equal(adminId > 0, true);
});

test("finance tidak dapat membuka atau mengubah konfigurasi MikroTik", async () => {
  const finance = await login("finance-mikrotik@example.test");
  const response = await get("/admin/mikrotik", finance, "manual");
  assert.equal(response.status, 403);
});

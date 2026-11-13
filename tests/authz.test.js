const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-authz-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "authz.sqlite");

const { db } = require("../database/db");
const { requireRole } = require("../apps/web/middleware/auth");

function addUser(name, role, active = 1) {
  return db.prepare(
    "INSERT INTO users (name,email,password_hash,role,is_active) VALUES (?,?,? ,?,?)"
  ).run(name, name.toLowerCase()+"@example.test", "test-hash", role, active).lastInsertRowid;
}

const ids = {
  admin: addUser("Admin", "admin"),
  finance: addUser("Finance", "finance"),
  technician: addUser("Teknisi", "teknisi"),
  inactive: addUser("Inactive", "admin", 0)
};

function invoke(userId, expected) {
  const req = { session: {
    user: userId ? { id: userId, role: "stale-role" } : null,
    destroy(callback) { callback(); }
  } };
  const res = {
    statusCode: 200,
    redirected: null,
    cleared: false,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(path) { this.redirected = path; return this; },
    clearCookie() { this.cleared = true; return this; }
  };
  let nextCalled = false;
  requireRole("admin", "finance")(req, res, () => { nextCalled = true; });
  if (expected === "next") assert.equal(nextCalled, true);
  if (expected === 403) assert.equal(res.statusCode, 403);
  if (expected === "login") {
    assert.equal(res.redirected, "/login");
    if (userId) assert.equal(res.cleared, true);
  }
  return { req, res, nextCalled };
}

test("admin dan finance dapat mengakses route billing manager", () => {
  assert.equal(invoke(ids.admin, "next").nextCalled, true);
  assert.equal(invoke(ids.finance, "next").nextCalled, true);
});

test("teknisi ditolak dari route billing manager", () => {
  assert.equal(invoke(ids.technician, 403).res.statusCode, 403);
});

test("pengguna anonim diarahkan ke login", () => {
  const result = invoke(null, "login");
  assert.equal(result.res.redirected, "/login");
});

test("role diambil dari database, bukan role lama pada session", () => {
  const result = invoke(ids.technician, 403);
  assert.equal(result.req.session.user.role, "teknisi");
});

test("pengguna yang sudah dihapus atau dinonaktifkan kehilangan akses dari session lama", () => {
  const removedId = addUser("ToDelete", "finance");
  db.prepare("DELETE FROM users WHERE id=?").run(removedId);
  assert.equal(invoke(removedId, "login").res.redirected, "/login");

  const inactiveId = ids.inactive;
  assert.equal(invoke(inactiveId, "login").res.redirected, "/login");
});

test("hanya admin yang dapat mencatat reversal pembayaran", () => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode=code; return this; },
    send(body) { this.body=body; return this; },
    redirect(path) { this.redirected=path; return this; },
    clearCookie() {}
  };
  let adminNext=false;
  requireRole("admin")({session:{user:{id:ids.admin,role:"admin"}}},res,()=>{adminNext=true;});
  assert.equal(adminNext,true);

  const financeRes = {
    statusCode: 200,
    status(code) { this.statusCode=code; return this; },
    send(body) { this.body=body; return this; },
    redirect(path) { this.redirected=path; return this; },
    clearCookie() {}
  };
  requireRole("admin")({session:{user:{id:ids.finance,role:"finance"}}},financeRes,()=>{});
  assert.equal(financeRes.statusCode,403);
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

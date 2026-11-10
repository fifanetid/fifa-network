const test = require("node:test");
const assert = require("node:assert/strict");
const { requireRole } = require("../apps/web/middleware/auth");

function invoke(role, expectedStatus) {
  const req = { session: role ? { user: { role } } : {} };
  const res = {
    statusCode: 200,
    redirected: null,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(path) { this.redirected = path; return this; }
  };
  let nextCalled = false;
  requireRole("admin", "finance")(req, res, () => { nextCalled = true; });
  if (expectedStatus === "next") assert.equal(nextCalled, true);
  if (expectedStatus === 403) assert.equal(res.statusCode, 403);
  if (expectedStatus === "login") assert.equal(res.redirected, "/login");
  return res;
}

test("admin dan finance dapat mengakses route billing manager", () => {
  invoke("admin", "next");
  invoke("finance", "next");
});
test("teknisi ditolak dari route billing manager", () => {
  invoke("teknisi", 403);
});
test("pengguna anonim diarahkan ke login", () => {
  invoke(null, "login");
});


test("hanya admin yang dapat mencatat reversal pembayaran", () => {
  const adminRes = { statusCode: 200, status(code) { this.statusCode=code; return this; }, send(body) { this.body=body; return this; }, redirect(path) { this.redirected=path; return this; } };
  let adminNext=false;
  requireRole("admin")({session:{user:{role:"admin"}}},adminRes,()=>{adminNext=true;});
  assert.equal(adminNext,true);
  const financeRes = { statusCode: 200, status(code) { this.statusCode=code; return this; }, send(body) { this.body=body; return this; }, redirect(path) { this.redirected=path; return this; } };
  requireRole("admin")({session:{user:{role:"finance"}}},financeRes,()=>{});
  assert.equal(financeRes.statusCode,403);
});

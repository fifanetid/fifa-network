const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-billing-auth-test-"));
const dbPath = path.join(tempDir, "auth.sqlite");
const scriptPath = path.join(__dirname, "..", "scripts", "create-default-admin.js");
const projectDir = path.join(__dirname, "..");

function runBootstrap(nodeEnv = "development", targetDb = dbPath) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: projectDir,
    env: { ...process.env, NODE_ENV: nodeEnv, BILLING_DB_PATH: targetDb },
    encoding: "utf8"
  });
}

test("akun admin/admin dibuat dan admin lama dapat diatur ulang tanpa mengubah pengguna lain", () => {
  const created = runBootstrap();
  assert.equal(created.status, 0, created.stderr);

  const db = new Database(dbPath);
  let user = db.prepare("SELECT id,name,email,password_hash,role FROM users WHERE lower(name)='admin'").get();
  assert.ok(user);
  assert.equal(user.email, "admin@ffbilling.local");
  assert.equal(user.role, "admin");
  assert.equal(bcrypt.compareSync("admin", user.password_hash), true);

  db.prepare("UPDATE users SET name='Administrator', password_hash=? WHERE id=?")
    .run(bcrypt.hashSync("password-lama", 4), user.id);
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'finance')")
    .run("Finance User", "finance@example.test", bcrypt.hashSync("finance-password", 4));
  db.close();

  const reset = runBootstrap();
  assert.equal(reset.status, 0, reset.stderr);
  const verify = new Database(dbPath);
  user = verify.prepare("SELECT name,password_hash,role FROM users WHERE email='admin@ffbilling.local'").get();
  assert.equal(user.name, "admin");
  assert.equal(user.role, "admin");
  assert.equal(bcrypt.compareSync("admin", user.password_hash), true);
  assert.equal(verify.prepare("SELECT name FROM users WHERE email='finance@example.test'").get().name, "Finance User");
  verify.close();
});

test("pembuatan atau pengaturan ulang admin default ditolak pada production", () => {
  const productionDb = path.join(tempDir, "production.sqlite");
  const result = runBootstrap("production", productionDb);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-production/);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

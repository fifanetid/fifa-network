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

test("akun admin/admin dibuat hanya pada database kosong non-production", () => {
  const env = { ...process.env, NODE_ENV: "development", BILLING_DB_PATH: dbPath };
  const created = spawnSync(process.execPath, [scriptPath], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);

  const db = new Database(dbPath);
  const user = db.prepare("SELECT name,email,password_hash,role FROM users WHERE lower(name)='admin'").get();
  assert.ok(user);
  assert.equal(user.email, "admin@ffbilling.local");
  assert.equal(user.role, "admin");
  assert.equal(bcrypt.compareSync("admin", user.password_hash), true);
  db.close();

  const secondRun = spawnSync(process.execPath, [scriptPath], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  assert.equal(secondRun.status, 1);
  assert.match(secondRun.stderr, /database sudah memiliki pengguna/);
});

test("pembuatan admin default ditolak pada production", () => {
  const productionDb = path.join(tempDir, "production.sqlite");
  const env = { ...process.env, NODE_ENV: "production", BILLING_DB_PATH: productionDb };
  const result = spawnSync(process.execPath, [scriptPath], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-production/);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

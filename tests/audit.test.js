const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-audit-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "audit.sqlite");
const { db } = require("../database/db");
const { recordAudit } = require("../modules/audit");

test("audit log menyimpan aktor, aksi, entitas, ringkasan dan waktu", () => {
  const user = db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)")
    .run("Admin Audit", "admin-audit@example.test", "test-hash", "admin");
  const id = recordAudit({
    user: { id: Number(user.lastInsertRowid), name: "Admin Audit", role: "admin" },
    action: "customer.create",
    entityType: "customer",
    entityId: 42,
    summary: "Menambahkan pelanggan FF-042"
  });
  const row = db.prepare("SELECT * FROM audit_logs WHERE id=?").get(id);
  assert.equal(row.actor_name, "Admin Audit");
  assert.equal(row.actor_role, "admin");
  assert.equal(row.action, "customer.create");
  assert.equal(row.entity_type, "customer");
  assert.equal(row.entity_id, "42");
  assert.equal(row.summary, "Menambahkan pelanggan FF-042");
  assert.ok(row.created_at);
});

test("audit log tidak dapat diubah atau dihapus", () => {
  const row = db.prepare("SELECT id FROM audit_logs ORDER BY id DESC LIMIT 1").get();
  assert.throws(() => db.prepare("UPDATE audit_logs SET summary='diubah' WHERE id=?").run(row.id), /audit log is immutable/);
  assert.throws(() => db.prepare("DELETE FROM audit_logs WHERE id=?").run(row.id), /audit log is immutable/);
});

test("audit log menolak data aktor atau aksi yang tidak lengkap", () => {
  assert.throws(() => recordAudit({ action: "customer.create", entityType: "customer", summary: "x" }), /terautentikasi/);
  assert.throws(() => recordAudit({
    user: { id: 1, name: "Admin", role: "admin" },
    action: "",
    entityType: "customer",
    summary: "x"
  }), /tidak lengkap/);
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

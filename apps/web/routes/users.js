const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { db } = require("../../../database/db");
const { recordAudit } = require("../../../modules/audit");
const { requireRole } = require("../middleware/auth");

router.use(requireRole("admin"));
router.get("/", (req, res) => {
  const users = db.prepare("SELECT id, name, email, role, is_active, created_at, last_login_at FROM users ORDER BY id DESC").all();
  res.render("users", { title: "Manajemen Pengguna", users, notice: req.query.notice || null, error: req.query.error || null });
});
router.post("/", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "");
  if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 200 || !["admin", "teknisi", "finance"].includes(role)) {
    return res.redirect("/admin/users?error=Data%20tidak%20valid.%20Password%20minimal%2012%20karakter.");
  }
  try {
    const result = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)").run(name, email, bcrypt.hashSync(password, 12), role);
    recordAudit({ user: req.session.user, action: "user.create", entityType: "user", entityId: result.lastInsertRowid, summary: "Membuat akun " + email + " dengan role " + role });
    res.redirect("/admin/users?notice=Akun%20berhasil%20dibuat.");
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") return res.redirect("/admin/users?error=Email%20sudah%20digunakan.");
    throw err;
  }
});
router.post("/:id/status", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).send("ID tidak valid.");
  if (id === req.session.user.id) return res.redirect("/admin/users?error=Akun%20yang%20sedang%20digunakan%20tidak%20dapat%20dinonaktifkan.");
  const user = db.prepare("SELECT id, is_active FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).send("Pengguna tidak ditemukan.");
  db.prepare("UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.is_active ? 0 : 1, id);
  recordAudit({ user: req.session.user, action: "user.status", entityType: "user", entityId: id, summary: (user.is_active ? "Menonaktifkan" : "Mengaktifkan") + " akun pengguna ID " + id });
  res.redirect("/admin/users?notice=Status%20akun%20diperbarui.");
});
router.post("/:id/password", (req, res) => {
  const id = Number(req.params.id);
  const password = String(req.body.password || "");
  if (!Number.isSafeInteger(id) || id <= 0 || password.length < 12 || password.length > 200) return res.redirect("/admin/users?error=Password%20baru%20minimal%2012%20karakter.");
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(id)) return res.status(404).send("Pengguna tidak ditemukan.");
  db.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(bcrypt.hashSync(password, 12), id);
  recordAudit({ user: req.session.user, action: "user.password_reset", entityType: "user", entityId: id, summary: "Mengubah password akun pengguna ID " + id });
  res.redirect("/admin/users?notice=Password%20akun%20berhasil%20diubah.");
});
module.exports = router;

const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { db } = require("../../../database/db");
const { recordAudit } = require("../../../modules/audit");
const { requireRole } = require("../middleware/auth");

router.use(requireRole("admin"));
router.get("/", (req, res) => {
  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM audit_logs a WHERE a.actor_user_id=u.id) AS audit_count,
      (SELECT COUNT(*) FROM payments p WHERE p.received_by=u.id) AS payment_count,
      (SELECT COUNT(*) FROM payment_reversals r WHERE r.created_by=u.id) AS reversal_count,
      (SELECT COUNT(*) FROM customer_payment_confirmations pc WHERE pc.reviewed_by=u.id) AS reviewed_confirmation_count,
      (SELECT COUNT(*) FROM app_settings s WHERE s.updated_by=u.id) AS settings_count,
      CASE WHEN
        (SELECT COUNT(*) FROM audit_logs a WHERE a.actor_user_id=u.id)=0
        AND (SELECT COUNT(*) FROM payments p WHERE p.received_by=u.id)=0
        AND (SELECT COUNT(*) FROM payment_reversals r WHERE r.created_by=u.id)=0
        AND (SELECT COUNT(*) FROM customer_payment_confirmations pc WHERE pc.reviewed_by=u.id)=0
        AND (SELECT COUNT(*) FROM app_settings s WHERE s.updated_by=u.id)=0
      THEN 1 ELSE 0 END AS can_delete
    FROM users u ORDER BY u.id DESC
  `).all();
  const activeAdminCount = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin' AND is_active=1").get().total;
  res.render("users", { title: "Manajemen Pengguna", users, activeAdminCount, notice: req.query.notice || null, error: req.query.error || null });
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
router.post("/:id/delete", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.redirect("/admin/users?error=" + encodeURIComponent("ID pengguna tidak valid."));
  }
  if (id === Number(req.session.user.id)) {
    return res.redirect("/admin/users?error=" + encodeURIComponent("Akun yang sedang digunakan tidak dapat dihapus."));
  }

  try {
    const deleted = db.transaction(() => {
      const target = db.prepare("SELECT id,name,email,role,is_active FROM users WHERE id=?").get(id);
      if (!target) throw new Error("Pengguna tidak ditemukan.");

      const references = {
        audit: db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE actor_user_id=?").get(id).total,
        payments: db.prepare("SELECT COUNT(*) AS total FROM payments WHERE received_by=?").get(id).total,
        reversals: db.prepare("SELECT COUNT(*) AS total FROM payment_reversals WHERE created_by=?").get(id).total,
        confirmations: db.prepare("SELECT COUNT(*) AS total FROM customer_payment_confirmations WHERE reviewed_by=?").get(id).total,
        settings: db.prepare("SELECT COUNT(*) AS total FROM app_settings WHERE updated_by=?").get(id).total
      };
      const history = [];
      if (references.audit) history.push(references.audit + " log audit");
      if (references.payments) history.push(references.payments + " pembayaran");
      if (references.reversals) history.push(references.reversals + " reversal");
      if (references.confirmations) history.push(references.confirmations + " pemeriksaan konfirmasi");
      if (references.settings) history.push(references.settings + " perubahan pengaturan");
      if (history.length) {
        throw new Error(
          "Akun tidak dapat dihapus karena sudah tercatat pada " + history.join(", ") +
          ". Nonaktifkan akun agar riwayat tetap utuh."
        );
      }

      if (target.role === "admin" && target.is_active) {
        const activeAdmins = db.prepare(
          "SELECT COUNT(*) AS total FROM users WHERE role='admin' AND is_active=1"
        ).get().total;
        if (activeAdmins <= 1) {
          throw new Error("Admin aktif terakhir tidak dapat dihapus. Buat admin pengganti terlebih dahulu.");
        }
      }

      db.prepare("DELETE FROM users WHERE id=?").run(id);
      recordAudit({
        user: req.session.user,
        action: "user.delete",
        entityType: "user",
        entityId: id,
        summary: "Menghapus akun " + target.email + " (role " + target.role + ")"
      });
      return target;
    })();

    return res.redirect("/admin/users?notice=" + encodeURIComponent(
      "Akun " + deleted.email + " berhasil dihapus. Referensi riwayat yang terkait tetap dipertahankan."
    ));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return res.redirect("/admin/users?error=" + encodeURIComponent(
        "Akun tidak dapat dihapus karena masih memiliki relasi yang dilindungi database."
      ));
    }
    return res.redirect("/admin/users?error=" + encodeURIComponent(error.message));
  }
});

module.exports = router;

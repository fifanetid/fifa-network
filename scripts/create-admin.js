require("dotenv").config();
const bcrypt = require("bcryptjs");
const { db } = require("../database/db");

const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const name = String(process.env.ADMIN_NAME || "Administrator").trim();
const password = String(process.env.ADMIN_PASSWORD || "");

if (db.prepare("SELECT COUNT(*) AS total FROM users").get().total > 0) {
  console.error("Admin awal hanya dapat dibuat saat database belum memiliki pengguna.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200 || name.length < 2) {
  console.error("Atur ADMIN_EMAIL, ADMIN_NAME, dan ADMIN_PASSWORD (minimal 12 karakter) di environment sebelum menjalankan perintah.");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(name, email, passwordHash);
console.log(`Administrator ${email} berhasil dibuat. Hapus ADMIN_PASSWORD dari environment setelah selesai.`);

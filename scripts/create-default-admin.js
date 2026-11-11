require("dotenv").config();
const bcrypt = require("bcryptjs");
const { db } = require("../database/db");

if (process.env.NODE_ENV === "production") {
  console.error("Akun admin/admin hanya boleh dibuat atau diatur ulang pada lingkungan non-production.");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync("admin", 12);
const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();

if (existingAdmin) {
  db.prepare("UPDATE users SET name = 'admin', password_hash = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(passwordHash, existingAdmin.id);
  console.log("Akun administrator yang sudah ada berhasil diatur menjadi username admin.");
} else {
  const userCount = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (userCount > 0) {
    console.error("Database memiliki pengguna tetapi belum memiliki admin. Tidak ada akun yang diubah.");
    process.exit(1);
  }
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run("admin", "admin@ffbilling.local", passwordHash);
  console.log("Akun administrator awal berhasil dibuat.");
}

console.log("Username: admin");
console.log("Password: admin");
console.warn("PERINGATAN: hanya untuk pengembangan lokal. Segera ganti password sebelum aplikasi dipakai bersama atau diakses dari jaringan lain.");

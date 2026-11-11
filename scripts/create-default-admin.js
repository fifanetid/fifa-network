require("dotenv").config();
const bcrypt = require("bcryptjs");
const { db } = require("../database/db");

if (process.env.NODE_ENV === "production") {
  console.error("Akun admin/admin hanya boleh dibuat pada lingkungan non-production.");
  process.exit(1);
}

const userCount = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
if (userCount > 0) {
  console.error("Akun default tidak dibuat karena database sudah memiliki pengguna. Tidak ada akun yang diubah.");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync("admin", 12);
db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
  .run("admin", "admin@ffbilling.local", passwordHash);

console.log("Akun administrator awal berhasil dibuat.");
console.log("Username: admin");
console.log("Password: admin");
console.warn("PERINGATAN: hanya untuk pengembangan lokal. Ganti password sebelum aplikasi dipakai bersama atau diakses dari jaringan lain.");

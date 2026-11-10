# Arsitektur FIFA NETWORK

## Prinsip

FIFA NETWORK dibangun sebagai aplikasi modular dengan service terpisah untuk Billing, ACS, dan integrasi router. Dashboard menyatukan pengalaman pengguna, tetapi tidak mengambil alih fungsi inti GenieACS.

## Komponen

- `apps/web`: aplikasi Express/EJS untuk admin, teknisi, dan portal pelanggan.
- `apps/worker`: pekerjaan terjadwal seperti pembuatan invoice, notifikasi, dan sinkronisasi.
- `modules`: aturan bisnis per domain.
- `integrations/genieacs`: adapter HTTP terautentikasi ke GenieACS NBI.
- `integrations/mikrotik`: adapter RouterOS API.
- `database`: migrasi dan seed database Billing.
- `deploy`: konfigurasi service, reverse proxy, backup, dan deployment.

## Pemisahan data

**Billing SQLite**
- users dan roles
- customers
- service packages
- subscriptions
- invoices dan payments
- routers
- customer_devices
- audit_logs

**GenieACS MongoDB**
- Data perangkat dan parameter TR-069
- Tasks
- Presets dan konfigurasi internal GenieACS

FIFA NETWORK hanya menyimpan pengenal perangkat dan relasi pelanggan. Jangan mengubah struktur internal MongoDB GenieACS secara langsung kecuali melalui prosedur resmi yang memang diperlukan.

## Alur integrasi ONT

1. Pelanggan dibuat di FIFA NETWORK.
2. Perangkat diidentifikasi melalui serial number atau device ID.
3. Admin menghubungkan perangkat ke pelanggan.
4. Backend FIFA NETWORK meminta data perangkat ke GenieACS NBI.
5. Perintah konfigurasi dikirim sebagai task melalui NBI.
6. Hasil dan status task ditampilkan di dashboard.
7. Perubahan penting dicatat di audit log.

## Keamanan

- NBI GenieACS dan MongoDB hanya boleh diakses dari jaringan privat.
- Semua endpoint perubahan perangkat wajib memerlukan autentikasi dan otorisasi.
- Validasi parameter sebelum membuat task.
- Simpan secret di environment/secret manager.
- Gunakan HTTPS, secure session cookies, CSRF protection, rate limiting, dan audit log sebelum production.

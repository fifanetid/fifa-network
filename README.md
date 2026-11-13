# FF BILLING

**ISP Billing Management Platform** — aplikasi manajemen ISP untuk operasional pelanggan, paket internet, langganan, invoice, pembayaran, dan integrasi jaringan.

> Status: early development. Versi 0.5.0 menyediakan login/manajemen pengguna dan fondasi billing awal. Belum dinyatakan siap production.

## Fitur tersedia

### Akun dan keamanan dasar
- Login/logout dengan username atau email, session SQLite, dan password bcrypt
- Role admin, teknisi, finance
- Manajemen pengguna khusus admin
- Proteksi CSRF, pembatasan percobaan login, dan secure cookie di production
- Pembuatan akun awal admin/admin khusus lingkungan pengembangan yang belum memiliki pengguna

### Billing (fondasi awal)
- Data pelanggan: tambah, ubah, aktif/nonaktif
- Paket internet: tambah, ubah, aktif/nonaktif (admin)
- Langganan: buat dan ubah status active/suspended/terminated
- Referensi perangkat eksternal opsional (mis. GenieACS device ID/serial), tanpa menyimpan dokumen perangkat
- Pembuatan invoice bulanan per langganan dan periode dengan snapshot harga
- Penerbitan invoice bulanan massal untuk langganan aktif; aman dijalankan ulang karena invoice duplikat otomatis dilewati
- Skrip penjadwalan invoice bulanan yang dapat dijalankan melalui cron
- Daftar pengingat tagihan jatuh tempo/terlambat 7 hari di halaman Billing, dengan sisa bersih setelah reversal
- Pencatatan pembayaran tunai, transfer bank, QRIS manual, dan metode lain
- Pembayaran parsial, pembalikan pembayaran sebagian/penuh khusus admin dengan alasan wajib, serta riwayat reversal append-only
- Status invoice unpaid/partial/paid/void dihitung dari pembayaran bersih setelah reversal
- Constraint/trigger SQLite untuk kecocokan pelanggan-invoice, mencegah pembayaran melebihi tagihan, sinkronisasi status invoice, serta menjaga catatan pembayaran dan reversal tetap append-only
- Langganan terminated tidak dapat diaktifkan kembali; invoice paket gratis bernilai nol langsung berstatus paid
- Seluruh nilai uang disimpan sebagai integer Rupiah (IDR)

### Belum tersedia
- Payment gateway/otomatisasi pembayaran
- Pengiriman pengingat keluar melalui WhatsApp/SMS/email (daftar pengingat internal sudah tersedia), prorata, denda, dan pajak
- Penghapusan data dengan workflow retensi/audit
- Integrasi MikroTik RouterOS API
- Integrasi GenieACS NBI, provisioning TR-069, dan monitoring ONT
- Portal pelanggan, laporan lanjutan, audit log, backup terkelola

## Teknologi dan pemisahan database

- Node.js 20+, Express.js, EJS
- SQLite untuk akun dan data aplikasi/billing
- GenieACS tetap menggunakan MongoDB internalnya sendiri
- FF BILLING hanya menyimpan referensi perangkat eksternal; tidak membaca/menulis koleksi MongoDB GenieACS secara langsung
- Nginx/HTTPS disarankan untuk akses jarak jauh

## Instalasi Linux

Persyaratan: Node.js 20 atau lebih baru, npm, Git, dan toolchain build untuk modul SQLite native jika prebuilt binary tidak tersedia.

~~~bash
sudo apt update
sudo apt install -y git build-essential python3
git clone https://github.com/fifanetid/fifa-network.git
cd fifa-network
cp .env.example .env
npm install
~~~

Buat secret acak dan simpan di .env:

~~~bash
openssl rand -hex 32
nano .env
~~~

Ganti nilai SESSION_SECRET dengan hasil acak tersebut. Jangan commit .env.

### Membuat administrator pertama

Untuk lingkungan pengembangan lokal yang database-nya masih kosong:

~~~bash
npm run create-default-admin
~~~

Kredensial awal: username **admin**, password **admin**. Perintah ini hanya membuat akun jika belum ada pengguna dan menolak berjalan saat NODE_ENV=production. Segera ganti password sebelum aplikasi dipakai bersama atau diakses dari jaringan lain. Jangan gunakan kredensial ini di server production.

Untuk akun production, buat administrator dengan password kuat:

~~~bash
ADMIN_NAME="Administrator" ADMIN_EMAIL="admin@domain-kamu.id" ADMIN_PASSWORD="Password-kuat-minimal-12" npm run create-admin
~~~

Perintah production hanya membuat admin pertama ketika tabel pengguna masih kosong.

### Menjadwalkan invoice bulanan

Skrip ini memakai zona waktu Asia/Jakarta. Jalankan otomatis setiap tanggal 1 pukul 00.10 WIB dengan cron berikut (sesuaikan path instalasi dan user service):

~~~cron
10 0 1 * * cd /var/www/fifa-network && /usr/bin/npm run billing:monthly >> /var/log/ffbilling-monthly.log 2>&1
~~~

Skrip menerbitkan invoice periode bulan berjalan dengan tanggal jatuh tempo tanggal 10. Invoice yang sudah ada akan dilewati, sehingga aman dijalankan ulang. Uji manual:

~~~bash
npm run billing:monthly
npm run billing:monthly -- 2026-11 2026-11-10
~~~

### Pemeriksaan dan menjalankan

~~~bash
npm run check
npm test
npm start
~~~

Aplikasi mendengarkan di 127.0.0.1:3000. Untuk akses internet, pasang reverse proxy HTTPS seperti Nginx; jangan langsung mengekspos Node.js. Mode production memerlukan NODE_ENV=production dan SESSION_SECRET unik minimal 32 karakter.

## Role

| Role | Akses |
|---|---|
| admin | Dashboard, pengguna, seluruh modul billing, kelola paket, batalkan invoice |
| finance | Dashboard, pelanggan, langganan, invoice, pembayaran |
| teknisi | Login dan dashboard; akses modul jaringan akan ditambahkan pada tahap integrasi |

## Struktur proyek

~~~text
fifa-network/
├── apps/web/                 # Express web app, routes, views, public assets
├── modules/billing/          # Validasi domain dan aturan invoice/pembayaran
├── database/migrations/      # Migrasi SQLite
├── scripts/                  # Setup administrator
├── docs/                     # Dokumentasi teknis
└── tests/                    # Automated tests
~~~

## Data dan keamanan

- SQLite menyimpan users, customers, internet_plans, subscriptions, invoices, dan payments.
- Foreign key, CHECK constraint, dan trigger SQLite menjaga konsistensi relasi, nominal, pembayaran, dan status invoice.
- Data invoice menyimpan snapshot subtotal/diskon/total agar perubahan harga paket berikutnya tidak mengubah invoice lama.
- MongoDB GenieACS tetap terpisah dan dikelola GenieACS. NBI dan MongoDB harus dibatasi ke localhost/jaringan privat.
- Jangan commit .env, secret, database produksi, backup, atau data pribadi pelanggan.
- Sebelum production perlu audit keamanan menyeluruh, logging/audit trail, kebijakan backup/restore, pemantauan, serta pengujian beban.

Lihat docs/ARCHITECTURE.md dan SECURITY.md.

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

### Portal pelanggan dan dukungan
- Portal pelanggan dengan autentikasi terpisah, ringkasan langganan, invoice, cetak invoice, dan ubah password
- Konfirmasi pembayaran dari portal; saldo invoice hanya berubah setelah admin memeriksa dan menyetujui
- Pelanggan dapat membuat tiket gangguan internet, tagihan, akun, atau kategori lain
- Percakapan tiket dua arah antara pelanggan dan petugas dengan riwayat append-only
- Inbox keluhan untuk admin, finance, dan teknisi; dukungan filter, penugasan petugas, prioritas, status, balasan, serta jejak audit perubahan
- Data tiket hanya dapat dilihat oleh pemilik pelanggan atau petugas yang berwenang

### Jaringan dan monitoring
- Koneksi RouterOS API v6/v7 untuk membaca identitas router, resource CPU/memori, dan sesi PPP aktif
- Password router dan CA sertifikat API-SSL disimpan terenkripsi AES-256-GCM
- Akses RouterOS menggunakan akun terpisah yang disarankan hanya memiliki kebijakan read dan api
- Tahap ini bersifat baca-saja; belum membuat/mengubah/menghapus akun PPP, memutus sesi, atau mengubah konfigurasi router
- GenieACS tetap terpisah dari database internal MongoDB-nya; FF BILLING berkomunikasi melalui NBI


### GenieACS / ONT

Halaman **GenieACS / ONT** tersedia untuk admin dan teknisi:
- Pencarian perangkat via GenieACS Northbound Interface (NBI) berdasarkan ID perangkat, serial number, atau OUI (exact match)
- Menampilkan serial number, vendor, product class, waktu inform terakhir, dan status online indikatif
- Admin dapat menautkan satu perangkat ke pelanggan dan langganan; tautan dapat dilepas dari halaman
- Perubahan tautan dicatat pada audit log
- Konektor NBI read-only dengan timeout, batas ukuran respons, dan Basic Authentication opsional
- Metadata minimum saja yang disimpan. Password Wi-Fi, password PPPoE, dan dokumen parameter perangkat tidak disalin
- NBI harus tetap berada di localhost/jaringan privat; jangan mengekspos port NBI ke internet

Konfigurasi tambahan di `.env`:
~~~dotenv
GENIEACS_NBI_URL=http://127.0.0.1:7557
GENIEACS_USERNAME=
GENIEACS_PASSWORD=
GENIEACS_NBI_TIMEOUT_MS=8000
~~~

Lihat [docs/GENIEACS_INTEGRATION.md](docs/GENIEACS_INTEGRATION.md). FF BILLING memakai SQLite terpisah untuk seluruh data billing dan referensi perangkat. GenieACS tetap mengelola perangkat di MongoDB miliknya sendiri.

### Laporan, audit, dan notifikasi
- Audit log aktivitas penting yang append-only
- Laporan keuangan dengan perhitungan pembayaran bersih setelah reversal
- WhatsApp Web melalui Baileys, persetujuan pelanggan, QR perangkat, riwayat pesan, dan pengingat otomatis (H-3, hari jatuh tempo, H+3, lalu setiap 7 hari)

### Belum tersedia
- Payment gateway/otomatisasi pembayaran
- SMS/email, prorata, denda, dan pajak
- Provisioning PPP otomatis (membuat, mengubah, menonaktifkan/menghapus akun PPP, atau memutus sesi); monitoring RouterOS baca-saja sudah tersedia
- Operasi provisioning TR-069 (reboot, ubah SSID/password/WAN) belum diaktifkan; integrasi NBI read-only dan pemetaan perangkat sudah tersedia
- Backup/restore terkelola dan pemantauan production

## Teknologi dan pemisahan database

- Node.js 20+, Express.js, EJS
- @fibercom/routeros-api untuk komunikasi RouterOS API v6/v7
- SQLite untuk akun dan data aplikasi/billing
- Integrasi GenieACS NBI read-only untuk mencari perangkat, membaca identitas dasar ONT, dan menautkannya ke pelanggan/langganan
- FF BILLING hanya menyimpan referensi perangkat pada SQLite; tidak membaca/menulis koleksi MongoDB GenieACS secara langsung
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

Kunci `APP_ENCRYPTION_KEY` dibuat otomatis pada startup pertama jika nilainya kosong di `.env`. FF BILLING menyimpan kunci acak 32-byte (64 karakter hex) dengan izin file privat. Kunci ini digunakan untuk mengenkripsi password dan sertifikat CA router menggunakan AES-256-GCM.

Simpan backup kunci bersama backup database, tetapi di lokasi rahasia yang terpisah. Jangan menghapus, mengganti, atau membagikan kunci setelah kredensial router tersimpan.

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

### WhatsApp Gateway (Baileys)

WhatsApp Gateway hanya dapat dikelola admin melalui menu **WhatsApp Gateway**. Gunakan nomor operasional khusus, hubungkan dengan QR, dan aktifkan persetujuan WhatsApp pada data pelanggan hanya setelah pelanggan menyetujuinya. Nomor pelanggan harus memakai format internasional Indonesia (`62812...`). Sesi tersimpan di `data/whatsapp-auth/` dan tidak boleh dibagikan atau di-commit. Jangan hapus folder ini saat memperbarui aplikasi.

Pengingat otomatis berjalan setiap hari pukul 09.00 WIB ketika proses web aktif. Sistem mengirim maksimal 20 pesan per proses dan mencatat hasil untuk mencegah pengiriman ganda. Admin juga dapat menjalankan proses manual dari halaman WhatsApp Gateway. Koneksi Baileys menggunakan WhatsApp Web tidak resmi, dapat terputus atau berubah sewaktu-waktu, dan bukan WhatsApp Business Platform resmi. Gunakan secara wajar, dengan persetujuan penerima, serta pahami risiko pembatasan akun oleh WhatsApp.

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
| teknisi | Dashboard dan inbox keluhan; dapat menanggapi serta memperbarui tiket, tanpa akses manajemen billing |

## Struktur proyek

~~~text
fifa-network/
├── apps/web/                 # Express web app, routes, views, public assets
├── modules/billing/          # Validasi domain dan aturan invoice/pembayaran
├── modules/genieacs/         # Konektor GenieACS NBI read-only
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

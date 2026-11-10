# FIFA NETWORK

**Custom ISP Management Platform** — aplikasi manajemen ISP modular yang dikembangkan dari nol dengan mengambil referensi kebutuhan fitur dari `billing-rtrw` dan `genieacs-multitab-mod`.

> Status: early development. Modul login dan manajemen pengguna tersedia pada versi 0.2.0. Billing, provisioning GenieACS, MikroTik, dan deployment production masih dalam tahap pengembangan.

## Fitur yang sudah tersedia

- Dashboard awal setelah login
- Login/logout dengan session
- Password disimpan menggunakan bcrypt
- Proteksi halaman dan role pengguna: admin, teknisi, finance
- Admin dapat membuat akun, mengaktifkan/menonaktifkan akun, dan mengatur ulang password pengguna
- Session disimpan di SQLite, bukan MemoryStore
- Proteksi CSRF pada formulir
- Pembatasan percobaan login
- Migrasi database otomatis saat aplikasi dijalankan

## Rencana fitur

- Manajemen pelanggan dan layanan
- Paket internet, invoice, dan pembayaran
- Integrasi MikroTik RouterOS API
- Integrasi GenieACS melalui NBI
- Monitoring dan konfigurasi ONT/ONU
- Provisioning TR-069
- Portal pelanggan dan panel teknisi
- Audit log, backup, dan laporan

## Teknologi

- Node.js 20+
- Express.js dan EJS
- SQLite untuk data aplikasi/billing dan session
- GenieACS sebagai engine TR-069 (integrasi berikutnya)
- MongoDB yang dikelola GenieACS, terpisah dari database billing
- MikroTik RouterOS API (integrasi berikutnya)

## Instalasi Linux

Persyaratan: Node.js 20 atau lebih baru, npm, Git, dan toolchain build untuk modul SQLite native jika prebuilt binary tidak tersedia.

```bash
sudo apt update
sudo apt install -y git build-essential python3
git clone https://github.com/fifanetid/fifa-network.git
cd fifa-network
cp .env.example .env
npm install
```

Buat secret session acak dan simpan ke `.env`:

```bash
openssl rand -hex 32
nano .env
```

Ganti nilai `SESSION_SECRET` di file `.env` dengan hasil acak tersebut. Jangan commit file `.env`.

### Membuat akun administrator pertama

Akun pertama dibuat dari terminal, bukan dari halaman publik:

```bash
ADMIN_NAME="Administrator" ADMIN_EMAIL="admin@domain-kamu.id" ADMIN_PASSWORD="Password-kuat-minimal-12" npm run create-admin
```

Ganti email dan password contoh dengan milik sendiri. Jangan menggunakan password contoh di server publik. Setelah berhasil, hapus variabel password dari environment/terminal history bila tersimpan.

### Menjalankan aplikasi

```bash
npm run check
npm test
npm start
```

Aplikasi mendengarkan di `127.0.0.1:3000`. Buka `http://127.0.0.1:3000/login` dari mesin yang sama. Untuk akses internet, konfigurasi reverse proxy HTTPS seperti Nginx terlebih dahulu; jangan langsung mengekspos Node.js.

Untuk mode production, set `NODE_ENV=production` dan gunakan `SESSION_SECRET` unik minimal 32 karakter. Cookie session akan menggunakan flag Secure, sehingga aplikasi harus berada di belakang HTTPS.

## Role pengguna

| Role | Keterangan saat ini |
|---|---|
| admin | Dashboard dan manajemen pengguna |
| teknisi | Login dan dashboard; pembatasan modul teknisi akan ditambahkan bersama modul jaringan |
| finance | Login dan dashboard; hak billing akan ditambahkan bersama modul billing |

## Struktur proyek

```text
fifa-network/
├── apps/web/                 # Express web app, routes, views, public assets
├── database/                 # SQLite connection and migrations
├── scripts/                  # Setup administrator
├── docs/                     # Dokumentasi teknis
└── tests/                    # Automated tests
```

## Pemisahan data dan keamanan

- SQLite menyimpan data aplikasi FIFA NETWORK seperti akun pengguna dan nantinya pelanggan, paket, invoice, pembayaran, serta relasi perangkat.
- GenieACS tetap menjadi pemilik data perangkat TR-069 dan menggunakan MongoDB-nya sendiri.
- FIFA NETWORK akan menyimpan referensi `deviceId`/serial number GenieACS, bukan menyalin seluruh dokumen perangkat.
- NBI GenieACS dan MongoDB harus dibatasi ke localhost atau jaringan privat.
- Jangan commit file `.env`, token, password, backup database, atau data pribadi pelanggan.
- Sebelum production, perlu ditambahkan audit log, kebijakan backup, pengujian keamanan, CSRF review, HTTPS, dan hardening server.

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) dan [SECURITY.md](SECURITY.md).

## Kontribusi

Baca [CONTRIBUTING.md](CONTRIBUTING.md) sebelum mengirim perubahan.

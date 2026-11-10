# FIFA NETWORK

**Custom ISP Management Platform** — aplikasi manajemen ISP modular untuk operasional pelanggan, billing, dan integrasi jaringan.

> Status: early development. Versi 0.3.0 menyediakan login/manajemen pengguna dan fondasi billing awal. Belum dinyatakan siap production.

## Fitur tersedia

### Akun dan keamanan dasar
- Login/logout dengan session SQLite dan password bcrypt
- Role admin, teknisi, finance
- Manajemen pengguna khusus admin
- Proteksi CSRF, pembatasan percobaan login, dan secure cookie di production

### Billing (fondasi awal)
- Data pelanggan: tambah, ubah, aktif/nonaktif
- Paket internet: tambah, ubah, aktif/nonaktif (admin)
- Langganan: buat dan ubah status active/suspended/terminated
- Referensi perangkat eksternal opsional (mis. GenieACS device ID/serial), tanpa menyimpan dokumen perangkat
- Pembuatan invoice bulanan per langganan dan periode dengan snapshot harga
- Pencatatan pembayaran tunai, transfer bank, QRIS manual, dan metode lain
- Pembayaran parsial, status unpaid/partial/paid/void, dan perhitungan sisa tagihan
- Seluruh nilai uang disimpan sebagai integer Rupiah (IDR)

### Belum tersedia
- Payment gateway/otomatisasi pembayaran
- Penagihan otomatis terjadwal, prorata, denda, pajak, dan notifikasi
- Penghapusan data dengan workflow retensi/audit
- Integrasi MikroTik RouterOS API
- Integrasi GenieACS NBI, provisioning TR-069, dan monitoring ONT
- Portal pelanggan, laporan lanjutan, audit log, backup terkelola

## Teknologi dan pemisahan database

- Node.js 20+, Express.js, EJS
- SQLite untuk akun dan data aplikasi/billing
- GenieACS tetap menggunakan MongoDB internalnya sendiri
- FIFA NETWORK hanya menyimpan referensi perangkat eksternal; tidak membaca/menulis koleksi MongoDB GenieACS secara langsung
- Nginx/HTTPS disarankan untuk akses jarak jauh

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

Buat secret acak dan simpan di `.env`:

```bash
openssl rand -hex 32
nano .env
```

Ganti nilai `SESSION_SECRET` dengan hasil acak tersebut. Jangan commit `.env`.

### Membuat administrator pertama

```bash
ADMIN_NAME="Administrator" ADMIN_EMAIL="admin@domain-kamu.id" ADMIN_PASSWORD="Password-kuat-minimal-12" npm run create-admin
```

Gunakan email dan password milik sendiri; contoh di atas bukan kredensial untuk dipakai. Perintah hanya membuat admin pertama ketika tabel pengguna masih kosong.

### Pemeriksaan dan menjalankan

```bash
npm run check
npm test
npm start
```

Aplikasi mendengarkan di `127.0.0.1:3000`. Untuk akses internet, pasang reverse proxy HTTPS seperti Nginx; jangan langsung mengekspos Node.js. Mode production memerlukan `NODE_ENV=production` dan `SESSION_SECRET` unik minimal 32 karakter.

## Role

| Role | Akses |
|---|---|
| admin | Dashboard, pengguna, seluruh modul billing, kelola paket, batalkan invoice |
| finance | Dashboard, pelanggan, langganan, invoice, pembayaran |
| teknisi | Login dan dashboard; akses modul jaringan akan ditambahkan pada tahap integrasi |

## Struktur proyek

```text
fifa-network/
├── apps/web/                 # Express web app, routes, views, public assets
├── modules/billing/          # Validasi domain dan aturan invoice/pembayaran
├── database/migrations/      # Migrasi SQLite
├── scripts/                  # Setup administrator
├── docs/                     # Dokumentasi teknis
└── tests/                    # Automated tests
```

## Data dan keamanan

- SQLite menyimpan users, customers, internet_plans, subscriptions, invoices, dan payments.
- Foreign key dan constraint SQLite menjaga konsistensi relasi serta nilai nominal.
- Data invoice menyimpan snapshot subtotal/diskon/total agar perubahan harga paket berikutnya tidak mengubah invoice lama.
- MongoDB GenieACS tetap terpisah dan dikelola GenieACS. NBI dan MongoDB harus dibatasi ke localhost/jaringan privat.
- Jangan commit `.env`, secret, database produksi, backup, atau data pribadi pelanggan.
- Sebelum production perlu audit keamanan menyeluruh, logging/audit trail, kebijakan backup/restore, pemantauan, serta pengujian beban.

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) dan [SECURITY.md](SECURITY.md).

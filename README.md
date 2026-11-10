# FIFA NETWORK

**Custom ISP Management Platform** — sistem manajemen ISP yang dikembangkan dari nol dengan mengambil referensi kebutuhan fitur dari `billing-rtrw` dan `genieacs-multitab-mod`.

> Status: early development / starter scaffold. Belum siap digunakan untuk operasional ISP atau production.

## Rencana fitur

- Dashboard administrasi ISP
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
- Express.js
- EJS
- Bootstrap/CSS
- SQLite untuk data billing
- MongoDB yang dikelola GenieACS untuk data ACS
- GenieACS sebagai engine TR-069
- MikroTik RouterOS API

## Menjalankan di komputer lokal

### Persyaratan
- Node.js versi 20 atau lebih baru
- npm

### Install
```bash
git clone https://github.com/fifanetid/fifa-network.git
cd fifa-network
cp .env.example .env
npm install
```
Edit `.env` dan ganti `SESSION_SECRET` dengan nilai acak yang panjang.

### Jalankan
```bash
npm run dev
```
Buka `http://127.0.0.1:3000`.

## Struktur proyek

```text
fifa-network/
├── apps/web/                 # Express web app dan dashboard
├── database/migrations/      # Migrasi database billing
├── integrations/             # Adapter GenieACS dan MikroTik (rencana)
├── modules/                  # Domain billing, ACS, pelanggan, jaringan
├── deploy/                   # Konfigurasi deployment
├── docs/                     # Dokumentasi teknis
└── tests/                    # Automated tests
```

## Arsitektur dan kepemilikan data

- SQLite menyimpan data aplikasi FIFA NETWORK seperti pelanggan, paket, invoice, pembayaran, dan relasi perangkat.
- GenieACS tetap menjadi pemilik data perangkat TR-069 dan menggunakan MongoDB-nya sendiri.
- FIFA NETWORK menyimpan referensi `deviceId`/serial number GenieACS, bukan menyalin seluruh dokumen perangkat.
- NBI GenieACS dan MongoDB harus dibatasi ke localhost atau jaringan privat.
- Kredensial perangkat tidak boleh dikirim ke browser atau dimasukkan ke Git.

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pemeriksaan proyek
```bash
npm run check
npm test
```

## Keamanan
- Jangan commit file `.env`, token, password, backup database, atau kredensial router.
- Gunakan akun dan password khusus dengan hak minimum.
- Jangan membuka port GenieACS NBI/MongoDB ke internet publik.
- Aktifkan HTTPS, CSRF protection, rate limiting, autentikasi, dan audit log sebelum deployment produksi.
- Laporkan kerentanan secara privat sesuai [SECURITY.md](SECURITY.md).

## Lisensi

Belum ada lisensi open-source yang ditetapkan. Sampai pemilik proyek memilih dan menambahkan file `LICENSE`, hak cipta tetap berlaku dan penggunaan ulang oleh pihak lain tidak otomatis diizinkan.

## Kontribusi

Baca [CONTRIBUTING.md](CONTRIBUTING.md) sebelum mengirim perubahan.

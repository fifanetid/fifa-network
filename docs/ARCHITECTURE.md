# Arsitektur FF BILLING

## Komponen

- apps/web: Express/EJS UI dan autentikasi.
- modules/billing: validasi domain, perhitungan invoice, pencatatan pembayaran.
- database: SQLite billing/app data dan migrasi.
- integrations/genieacs: adapter NBI yang direncanakan.
- integrations/mikrotik: adapter RouterOS API yang direncanakan.
- apps/worker: pekerjaan terjadwal yang direncanakan.

## Model billing SQLite

- customers: identitas pelanggan dan status.
- internet_plans: kecepatan dan harga bulanan IDR.
- subscriptions: relasi pelanggan-paket, tanggal layanan, status, billing day, serta external_device_ref opsional.
- invoices: snapshot nominal dan periode tagihan, unik per langganan/periode.
- payments: catatan pembayaran append-only.
- payment_reversals: pembalikan sebagian/penuh yang append-only dan terhubung ke pembayaran asal.

Migrasi 004_billing_integrity.sql memastikan pelanggan invoice sama dengan pelanggan langganan, menolak pembayaran pada invoice void atau yang melampaui total, dan menyinkronkan status invoice. Migrasi 005_payment_reversals.sql menambahkan reversal yang tidak mengubah/menghapus pembayaran asal, membatasi total reversal agar tidak melebihi nominal pembayaran, dan menghitung ulang status invoice dari saldo bersih. Hanya admin yang dapat mencatat reversal melalui UI; alasan koreksi wajib disimpan. Invoice dengan riwayat pembayaran tidak dapat di-void, sekalipun seluruh pembayaran sudah dibalikkan.

Nominal uang disimpan sebagai integer rupiah. Status invoice: unpaid, partial, paid, atau void. Status jatuh tempo (overdue) dapat diturunkan dari due date dan saldo, bukan status pembayaran baru yang disimpan.

## Integrasi MikroTik tahap awal

Migrasi 013 menambahkan `mikrotik_routers` untuk menyimpan konfigurasi koneksi dan snapshot pemeriksaan. Password API dan CA sertifikat API-SSL dienkripsi AES-256-GCM dengan `APP_ENCRYPTION_KEY` (32 byte hex). Kunci harus tetap sama selama data router tersimpan; kehilangan atau penggantian kunci tanpa re-enkripsi akan membuat kredensial tidak dapat dibuka.

Modul `modules/mikrotik/client.js` hanya menjalankan:
- `/system/identity/print`
- `/system/resource/print`
- `/ppp/active/print`

Pengaturan dan pengujian hanya dapat dilakukan admin. Host dibatasi ke alamat IPv4 privat (loopback hanya di development). Gunakan VPN/LAN untuk mencapai router; jangan buka port API ke internet. API-SSL pada port 8729 memerlukan sertifikat yang dipercaya. Jika memakai CA internal, tempel CA PEM pada pengaturan koneksi agar validasi TLS tetap aktif.

Buat akun khusus RouterOS dengan kebijakan minimal `read,api`. Hindari grup bawaan `read` karena beberapa versi memiliki hak tambahan yang tidak diperlukan. Jangan memakai akun `admin` router.

Belum ada provisioning PPP, perubahan konfigurasi, atau pemutusan sesi. Snapshot PPP pada FF BILLING adalah hasil pemeriksaan terakhir, bukan stream real-time.

## Dukungan pelanggan

Migrasi 012 menambahkan:
- `support_tickets`: nomor tiket, pemilik pelanggan, kategori, subject, prioritas, status, petugas, dan waktu aktivitas.
- `support_ticket_messages`: percakapan pelanggan, petugas, dan catatan sistem yang append-only.

Portal pelanggan hanya dapat membaca dan membalas tiket milik akun yang sedang login. Inbox petugas tersedia untuk role admin, finance, dan teknisi. Petugas dapat mengubah status/prioritas, menugaskan tiket ke pengguna aktif, dan membalas pelanggan. Perubahan penting dicatat ke audit log. Tiket yang ditutup tidak menerima balasan baru dari pelanggan; pelanggan perlu membuat laporan baru. Riwayat tiket/pesan melindungi data pelanggan dan akun petugas dari penghapusan permanen.

Status tiket: `open`, `in_progress`, `waiting_customer`, `resolved`, `closed`. Prioritas: `low`, `normal`, `high`, `urgent`.

## Autentikasi

Login menerima username (nama pengguna) atau email. Akun awal admin/admin hanya dapat dibuat secara eksplisit melalui perintah npm run create-default-admin di lingkungan non-production dan hanya ketika tabel pengguna kosong. Akun default tidak dibuat otomatis saat server mulai; untuk production gunakan password acak yang kuat.

## Pemisahan GenieACS

GenieACS tetap mengelola perangkat TR-069 dan MongoDB internalnya sendiri. Database FF BILLING tidak menyimpan salinan dokumen perangkat. Kolom subscriptions.external_device_ref hanya menjadi pengenal eksternal untuk adapter NBI pada tahap berikutnya. Jangan menghubungkan aplikasi langsung ke koleksi MongoDB GenieACS.

## Tahapan berikutnya

1. Invoice PDF, audit log aktivitas lintas modul, dan pengujian HTTP end-to-end.
2. Siklus invoice otomatis, denda/prorata, notifikasi, dan laporan.
3. Adapter GenieACS NBI dan relasi perangkat pelanggan.
4. Adapter MikroTik dan sinkronisasi status layanan.
5. Backup/restore, deployment service, HTTPS, monitoring, dan hardening production.

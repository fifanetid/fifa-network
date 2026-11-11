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

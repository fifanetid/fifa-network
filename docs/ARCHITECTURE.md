# Arsitektur FIFA NETWORK

## Komponen

- `apps/web`: Express/EJS UI dan autentikasi.
- `modules/billing`: validasi domain, perhitungan invoice, pencatatan pembayaran.
- `database`: SQLite billing/app data dan migrasi.
- `integrations/genieacs`: adapter NBI yang direncanakan.
- `integrations/mikrotik`: adapter RouterOS API yang direncanakan.
- `apps/worker`: pekerjaan terjadwal yang direncanakan.

## Model billing SQLite

- `customers`: identitas pelanggan dan status.
- `internet_plans`: kecepatan dan harga bulanan IDR.
- `subscriptions`: relasi pelanggan-paket, tanggal layanan, status, billing day, serta `external_device_ref` opsional.
- `invoices`: snapshot nominal dan periode tagihan, unik per langganan/periode.
- `payments`: catatan pembayaran append-only yang mengurangi saldo invoice.

Nominal uang disimpan sebagai integer rupiah. Status invoice: `unpaid`, `partial`, `paid`, atau `void`. Status jatuh tempo (overdue) dapat diturunkan dari due date dan saldo, bukan status pembayaran baru yang disimpan.

## Pemisahan GenieACS

GenieACS tetap mengelola perangkat TR-069 dan MongoDB internalnya sendiri. Database FIFA NETWORK tidak menyimpan salinan dokumen perangkat. Kolom `subscriptions.external_device_ref` hanya menjadi pengenal eksternal untuk adapter NBI pada tahap berikutnya. Jangan menghubungkan aplikasi langsung ke koleksi MongoDB GenieACS.

## Tahapan berikutnya

1. Audit trail, koreksi/void payment dengan jejak audit, invoice PDF, dan pengujian HTTP end-to-end.
2. Siklus invoice otomatis, denda/prorata, notifikasi, dan laporan.
3. Adapter GenieACS NBI dan relasi perangkat pelanggan.
4. Adapter MikroTik dan sinkronisasi status layanan.
5. Backup/restore, deployment service, HTTPS, monitoring, dan hardening production.

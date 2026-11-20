# Integrasi FF BILLING dengan GenieACS

FF BILLING berkomunikasi melalui GenieACS Northbound Interface (NBI). Aplikasi tidak mengakses MongoDB GenieACS secara langsung dan tidak mengubah database internal GenieACS. Database FF BILLING tetap SQLite melalui BILLING_DB_PATH.

Fondasi ini menyediakan konektor NBI read-only untuk memeriksa NBI, mencari perangkat, membaca identitas minimum (ID, serial, vendor, product class, last inform), serta menyimpan relasi perangkat ke pelanggan/langganan di SQLite.

Kredensial Wi-Fi, password PPPoE, parameter TR-069, dan dokumen perangkat tidak disalin ke database billing.

## Konfigurasi
Tambahkan ke .env:
~~~dotenv
GENIEACS_NBI_URL=http://127.0.0.1:7557
GENIEACS_USERNAME=
GENIEACS_PASSWORD=
GENIEACS_NBI_TIMEOUT_MS=8000
~~~

NBI harus tetap bind ke localhost atau jaringan privat dan tidak diekspos langsung ke internet. Gunakan firewall, autentikasi, HTTPS bila lintas host, dan akun layanan dengan hak minimum.

Konektor memakai GET /devices dengan query, projection, limit, dan skip serta Basic Authentication bila dikonfigurasi.
Dokumentasi GenieACS: https://docs.genieacs.com/en/latest/api-reference.html

Tabel genieacs_device_links menyimpan customer_id, subscription_id opsional, genieacs_device_id unik, serial number, manufacturer, product class, waktu tautan dan pengguna pembuat. Tidak ada koleksi MongoDB yang disalin.

UI perangkat, pemetaan pelanggan, riwayat status, dan aksi CPE terkontrol dapat dibangun berikutnya. Reboot dan perubahan SSID/password/WAN belum diaktifkan. Operasi tulis kelak harus memakai role khusus, audit, validasi, CSRF, dan konfirmasi eksplisit.

FF BILLING tetap proyek terpisah. Periksa lisensi referensi sebelum mengadopsi kode, template, aset, atau skrip. Implementasi ini memakai NBI dan tidak menggabungkan arsip modifikasi GenieACS.

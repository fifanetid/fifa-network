# Integrasi MikroTik (monitoring baca-saja)

## Dukungan

FF BILLING terhubung melalui RouterOS API native, bukan hanya REST API RouterOS v7, sehingga jalur API ini dapat digunakan pada RouterOS v6.49.x maupun v7 selama service API tersedia. Tahap awal ini hanya melakukan tiga pembacaan:

- `/system/identity/print`
- `/system/resource/print`
- `/ppp/active/print`

Tidak ada perintah tambah, ubah, hapus, disable, enable, reboot, atau remove sesi yang dijalankan oleh modul ini.

## Kunci enkripsi aplikasi

Buat kunci 32-byte:

~~~bash
openssl rand -hex 32
~~~

Masukkan hasilnya ke `APP_ENCRYPTION_KEY` di `.env`. Kunci harus 64 karakter heksadesimal. Password router dan CA sertifikat TLS dienkripsi AES-256-GCM sebelum masuk SQLite.

Simpan kunci di tempat rahasia dan backup terpisah dari database. Jangan mengubah atau kehilangan kunci selama masih ada data router terenkripsi.

## Membuat pengguna API khusus di RouterOS

Jangan gunakan akun `admin` router. Buat grup khusus dan pengguna dengan kebijakan minimal `read,api` dari WinBox/Terminal RouterOS:

~~~routeros
/user/group/add name=ffbilling-readonly policy=read,api
/user/add name=ffbilling group=ffbilling-readonly password="GANTI_DENGAN_PASSWORD_KUAT"
~~~

Batasi service API agar hanya menerima koneksi dari alamat IP server FF BILLING atau interface VPN yang diperlukan. Contoh berikut perlu disesuaikan dengan IP asal koneksi dari server:

~~~routeros
/ip/service/set api disabled=no address=192.168.88.10/32
~~~

Jangan membuka TCP 8728/8729 untuk seluruh internet. Untuk router yang berada di jaringan lain, gunakan WireGuard atau VPN site-to-site dan masukkan IP privat router yang dapat dijangkau dari server.

### Pilihan API-SSL

API-SSL menggunakan TCP 8729. Router harus memiliki sertifikat TLS yang valid dan dipercaya klien. Tanpa sertifikat yang tepat, handshake TLS dapat gagal. Aktifkan service API-SSL dan batasi alamat sumber pada router, lalu aktifkan opsi API-SSL di FF BILLING.

Untuk sertifikat internal/self-signed, tempel CA PEM yang menandatangani sertifikat server pada kolom Sertifikat CA di FF BILLING. Validasi sertifikat TLS tidak dinonaktifkan.

Port TCP 8728 tidak mengenkripsi username, password, atau data API. Gunakan hanya di LAN/VPN privat yang dipercaya.

## Menghubungkan di FF BILLING

1. Login sebagai admin FF BILLING.
2. Buka menu **MikroTik**.
3. Masukkan nama router, IP privat, username API, dan password khusus.
4. Pilih API-SSL bila service dan sertifikat TLS telah disiapkan.
5. Simpan router, lalu tekan **Uji koneksi / Perbarui status**.
6. Jika berhasil, halaman menampilkan versi RouterOS, uptime, CPU, memori, serta snapshot sesi PPP aktif.

Jika gagal, pastikan alamat router dapat dijangkau dari mesin/server yang menjalankan FF BILLING, service API aktif, firewall/router mengizinkan IP sumber server, username/password tepat, dan sertifikat TLS dipercaya bila memakai API-SSL.

## Batas fitur saat ini

- Hanya role admin yang dapat mengatur router.
- Host dibatasi ke IPv4 privat. Loopback hanya diizinkan di development.
- Data PPP aktif adalah snapshot dari pemeriksaan terakhir, bukan pemantauan real-time.
- Belum ada sinkronisasi username PPP ke pelanggan FF BILLING.
- Belum ada provisioning akun PPP, perubahan secret/profile, suspend otomatis, disconnect sesi, atau perubahan konfigurasi router.

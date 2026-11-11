# Kebijakan Keamanan

FF BILLING masih dalam tahap pengembangan awal dan belum dinyatakan aman untuk production.

## Melaporkan kerentanan

Jangan mempublikasikan detail eksploitasi, kredensial, atau data pelanggan melalui issue publik. Hubungi pemilik repository secara privat melalui kanal yang dicantumkan pada profil GitHub repository.

## Hal yang dilarang di commit

- File .env dan secret
- Password/token MikroTik atau GenieACS
- Database produksi dan backup
- Data pribadi pelanggan
- Private key dan sertifikat privat

## Kredensial awal

Perintah npm run create-default-admin membuat akun admin/admin hanya untuk lingkungan pengembangan non-production dengan database kosong. Kredensial tersebut lemah dan tidak boleh digunakan pada server production atau sistem yang dapat diakses publik. Segera ganti dengan password unik yang kuat sebelum penggunaan bersama.

# Panduan Kontribusi

Terima kasih telah membantu pengembangan FIFA NETWORK.

## Alur perubahan

1. Buat branch dari `main`.
2. Gunakan nama branch deskriptif, misalnya `feature/customer-management` atau `fix/login-validation`.
3. Buat perubahan kecil dan terfokus.
4. Jalankan `npm run check` dan `npm test`.
5. Jelaskan perubahan, alasan, dan cara pengujian pada pull request.

## Pedoman kode

- Gunakan JavaScript CommonJS sesuai struktur saat ini.
- Pisahkan route, controller, service, dan integrasi eksternal.
- Jangan menaruh kredensial atau data pelanggan sungguhan di source code.
- Perubahan yang mengubah database harus disertai migration.
- Tindakan yang mengubah konfigurasi ONT/router harus divalidasi dan dicatat.

## Pull request

Jangan sertakan `.env`, database produksi, backup, token, password, atau informasi pribadi pelanggan.

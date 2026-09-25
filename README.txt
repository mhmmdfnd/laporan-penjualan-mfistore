LAPORAN PENJUALAN AKUN V3.9.1 - VERCEL + DATABASE + DASHBOARD KONEKSI

Fitur V3.8 dipertahankan: input akun, penjualan, 10 kode cadangan, prefix otomatis, Rupiah, laporan & keuntungan, pengaturan master, hackback HB, biaya lain-lain, laporan bulanan, export CSV.

V3.9 menghapus penyimpanan data.json dan menggantinya dengan PostgreSQL persistent database. Session login memakai signed cookie sehingga tidak bergantung pada filesystem/server memory.

DEPLOY VERCEL
1. Buat database PostgreSQL (contoh: Neon atau Supabase).
2. Ambil connection string PostgreSQL dan simpan sebagai DATABASE_URL.
3. Upload project ini ke GitHub.
4. Import repository tersebut di Vercel.
5. Tambahkan Environment Variables:
   DATABASE_URL = connection string PostgreSQL
   SESSION_SECRET = string rahasia panjang/random
6. Deploy.
7. Buka domain Vercel. Database/tabel akan dibuat otomatis saat API pertama kali dipanggil.

LOGIN DEFAULT
username: admin
password: admin123
Segera ganti password bila fitur manajemen user ditambahkan.

LOCAL TEST
npm install
vercel dev

MIGRASI DATA LAMA
Jika project V3.8 lama memiliki data.json, script scripts/migrate-json.js dapat dipakai setelah DATABASE_URL diisi:
npm install
node scripts/migrate-json.js data.json

Catatan: Vercel filesystem tidak digunakan untuk menyimpan data aplikasi. Semua sales, expenses, dan settings disimpan di PostgreSQL.


V3.9.1 - KONEKSI DATABASE DARI DASHBOARD
- Menu baru: Koneksi Database.
- Cek database aktif.
- Test PostgreSQL DATABASE_URL sebelum dipakai.
- Simpan & Aktifkan database dari dashboard.
- DATABASE_URL bootstrap Vercel tetap wajib tersedia sebagai jalur pemulihan setelah redeploy.
- URL database yang disimpan dienkripsi AES-256-GCM menggunakan DB_CONFIG_SECRET (jika tidak diisi, memakai SESSION_SECRET).

ENVIRONMENT VARIABLES VERCEL
DATABASE_URL = PostgreSQL bootstrap
SESSION_SECRET = secret panjang/random
DB_CONFIG_SECRET = secret panjang/random (disarankan, khusus enkripsi konfigurasi database)

CARA PAKAI MENU KONEKSI DATABASE
1. Deploy project dan isi DATABASE_URL bootstrap di Vercel.
2. Login admin.
3. Buka Koneksi Database.
4. Masukkan connection string PostgreSQL baru.
5. Klik Test Koneksi.
6. Jika berhasil klik Simpan & Aktifkan.
7. Aplikasi akan membuat tabel otomatis di database baru.

CATATAN
Jangan menghapus database bootstrap jika konfigurasi dashboard masih menggunakannya sebagai tempat penyimpanan konfigurasi terenkripsi. DATABASE_URL Vercel tetap menjadi bootstrap untuk memulihkan database pilihan setelah cold start/redeploy.

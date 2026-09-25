LAPORAN PENJUALAN AKUN V3.9 - VERCEL + DATABASE

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

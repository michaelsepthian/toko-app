-- Metode boleh disembunyikan dari penjualan dan pembelian sekaligus.
-- Transaksi tetap memvalidasi aktif dan flag menu, termasuk melalui trigger SQL.
-- Kompatibel dengan PostgreSQL mandiri dan Supabase; aman dijalankan ulang.
begin;
alter table public.metode_pembayaran
    drop constraint if exists metode_minimal_satu_penggunaan;
comment on column public.metode_pembayaran.untuk_penjualan is
    'Tersedia pada penjualan jika aktif=true. Kedua flag penggunaan boleh false.';
comment on column public.metode_pembayaran.untuk_pembelian is
    'Tersedia pada pembelian jika aktif=true. Kedua flag penggunaan boleh false.';
commit;

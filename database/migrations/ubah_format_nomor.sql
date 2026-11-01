-- Gunakan jika schema.sql versi lama sudah dijalankan.
-- Mengubah default untuk transaksi baru; nomor lama tetap dipertahankan.
-- Tidak mereset atau memajukan sequence secara manual.
-- Nomor dibuat saat INSERT, dalam zona Asia/Jakarta (WIB).
-- Abaikan kolom nomor saat INSERT agar default digunakan.

begin;

alter table public.penjualan
    alter column nomor set default (
        'BILL-'
        || to_char(statement_timestamp() at time zone 'Asia/Jakarta', 'YYYYMMDD-HH24MISS')
        || '-' || nextval('public.penjualan_nomor_seq'::regclass)::text
    );

alter table public.pembelian
    alter column nomor set default (
        'BELI-'
        || to_char(statement_timestamp() at time zone 'Asia/Jakarta', 'YYYYMMDD-HH24MISS')
        || '-' || nextval('public.pembelian_nomor_seq'::regclass)::text
    );

commit;

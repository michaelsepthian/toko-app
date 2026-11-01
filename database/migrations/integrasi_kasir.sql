-- Jalankan sekali pada database yang sudah memakai schema.sql versi sebelumnya.
-- Database baru dengan schema.sql terbaru tidak perlu menjalankan file ini.
begin;

alter table public.metode_pembayaran
    add column jenis text not null default 'LAINNYA'
    check (jenis in ('CASH', 'QRIS', 'DEBIT', 'TRANSFER', 'LAINNYA'));
update public.metode_pembayaran set jenis = case
    when lower(nama) in ('cash', 'tunai') then 'CASH'
    when lower(nama) = 'qris' then 'QRIS'
    when lower(nama) in ('debit', 'kartu debit') then 'DEBIT'
    when lower(nama) in ('transfer', 'transfer supplier') then 'TRANSFER'
    else 'LAINNYA' end;

alter table public.penjualan add column idempotency_key uuid unique;
alter table public.penjualan add column request_hash text;
alter table public.pembelian add column idempotency_key uuid unique;
alter table public.pembelian add column request_hash text;

alter table public.detail_penjualan add column nama_produk text;
update public.detail_penjualan d set nama_produk = p.nama from public.produk p where p.id = d.produk_id;
alter table public.detail_penjualan alter column nama_produk set not null;
alter table public.detail_pembelian add column nama_produk text;
update public.detail_pembelian d set nama_produk = p.nama from public.produk p where p.id = d.produk_id;
alter table public.detail_pembelian alter column nama_produk set not null;

commit;

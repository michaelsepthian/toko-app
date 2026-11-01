-- Jalankan sekali pada database toko yang sudah ada, sebelum menjalankan backend baru.
begin;
alter table public.produk
    add column if not exists is_favorit boolean not null default false;
comment on column public.produk.is_favorit is
    'Favorit toko bersama untuk seluruh pengguna; diatur oleh pemilik.';
commit;

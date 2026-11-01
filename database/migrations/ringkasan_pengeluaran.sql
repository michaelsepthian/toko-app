-- Ringkasan versi 2: seluruh metode pembelian, catatan otomatis, sisa boleh minus.
begin;
alter table public.ringkasan_harian drop constraint if exists ringkasan_harian_belanja_besok_check;
alter table public.ringkasan_harian drop constraint if exists ringkasan_harian_sisa_kas_check;
alter table public.ringkasan_harian add constraint ringkasan_harian_belanja_besok_check check (belanja_besok >= 0);
alter table public.catatan_belanja drop constraint if exists catatan_belanja_total_check;
alter table public.catatan_belanja add constraint catatan_belanja_total_check check (total >= 0);
-- Transaksi lama tetap utuh; hanya tambahkan catatan untuk pembelian yang belum tertaut.
insert into public.catatan_belanja(idempotency_key,request_hash,tanggal,total,catatan,pengguna_id,status,pembelian_id,created_at,updated_at)
select md5('auto-purchase:'||p.id::text)::uuid,md5('auto-purchase:'||p.id::text),
 (p.tanggal at time zone 'Asia/Jakarta')::date,p.total_pembayaran,'Pembelian '||p.nomor,
 p.pengguna_id,'SELESAI',p.id,p.created_at,p.updated_at
from public.pembelian p
where p.status='SELESAI'
and not exists(select 1 from public.catatan_belanja c where c.pembelian_id=p.id)
on conflict (pembelian_id) do nothing;
commit;

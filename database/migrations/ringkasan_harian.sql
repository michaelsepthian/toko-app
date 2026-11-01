-- Snapshot ringkasan harian. Dapat dijalankan ulang pada PostgreSQL lokal/Supabase.
-- Tidak mengubah transaksi penjualan atau pembelian yang sudah ada.
begin;
create table if not exists public.ringkasan_harian (
    id bigint generated always as identity primary key,
    idempotency_key uuid not null unique,
    request_hash text not null,
    tanggal date not null,
    pengguna_id bigint not null references public.pengguna(id) on delete restrict,
    nama_pencatat text not null,
    nama_toko text not null check (btrim(nama_toko) <> ''),
    email_tujuan text,
    kas_aktual numeric(18,2) not null check (kas_aktual >= 0),
    belanja_besok numeric(18,2) not null check (belanja_besok >= 0),
    total_dana_seharusnya numeric(20,2) not null,
    total_dana_aktual numeric(20,2) not null,
    kas_seharusnya numeric(20,2) not null,
    selisih_kas numeric(20,2) not null,
    sisa_kas numeric(18,2) not null,
    catatan text not null default '',
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    created_at timestamptz not null default now()
);
create index if not exists ringkasan_harian_tanggal_idx on public.ringkasan_harian(tanggal, id desc);
alter table public.ringkasan_harian enable row level security;
revoke all on public.ringkasan_harian from public;
do $$ declare v_role text; begin
    foreach v_role in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = v_role) then
            execute format('revoke all on public.ringkasan_harian from %I', v_role);
        end if;
    end loop;
end $$;
comment on table public.ringkasan_harian is 'Snapshot immutable per penyimpanan; koreksi disimpan sebagai versi baru tanpa menimpa histori.';
commit;

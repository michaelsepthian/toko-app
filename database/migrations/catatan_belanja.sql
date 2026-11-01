-- Pengeluaran dicatat totalnya dahulu; rincian/stok dapat dilengkapi kemudian.
begin;
create table if not exists public.catatan_belanja (
 id bigint generated always as identity primary key,
 idempotency_key uuid not null unique,
 request_hash text not null,
 tanggal date not null,
 total numeric(18,2) not null check (total >= 0),
 catatan text not null default '',
 pengguna_id bigint not null references public.pengguna(id) on delete restrict,
 status text not null default 'TERBUKA' check (status in ('TERBUKA','SELESAI','BATAL')),
 pembelian_id bigint unique references public.pembelian(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (status <> 'SELESAI' or pembelian_id is not null)
);
create index if not exists catatan_belanja_tanggal_idx on public.catatan_belanja(tanggal,id desc);
alter table public.catatan_belanja enable row level security;
revoke all on public.catatan_belanja from public;
do $$ declare v_role text; begin
 foreach v_role in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=v_role) then execute format('revoke all on public.catatan_belanja from %I',v_role);end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.catatan_belanja'::regclass and tgname='set_updated_at') then
  create trigger set_updated_at before update on public.catatan_belanja for each row execute function public.set_updated_at();
 end if;
end $$;
commit;

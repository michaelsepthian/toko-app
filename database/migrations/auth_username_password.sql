-- Jalankan untuk database yang sudah memakai schema sebelumnya.
-- Tidak menghapus akun atau transaksi lama. Database baru cukup schema.sql terbaru.
begin;
alter table public.pengguna add column if not exists password_hash text;
create table if not exists public.sesi_pengguna (
    token_hash text primary key,
    pengguna_id bigint not null references public.pengguna(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index if not exists sesi_pengguna_user_idx on public.sesi_pengguna(pengguna_id);
create index if not exists sesi_pengguna_expiry_idx on public.sesi_pengguna(expires_at);
alter table public.sesi_pengguna enable row level security;
commit;

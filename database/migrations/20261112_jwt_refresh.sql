BEGIN;
-- Preserve users and transaction history; obsolete sessions require one new login.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.pengguna WHERE aktif AND (password_hash IS NULL OR btrim(password_hash) = '')) THEN
  RAISE EXCEPTION 'Akun aktif belum memiliki password lokal; siapkan password sebelum migrasi JWT';
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sesi_pengguna' AND column_name='token_hash') THEN
  DROP TABLE public.sesi_pengguna;
 END IF;
END $$;
ALTER TABLE public.pengguna DROP COLUMN IF EXISTS auth_user_id;
create table if not exists public.sesi_pengguna (
    id text primary key,
    pengguna_id bigint not null references public.pengguna(id) on delete cascade,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists sesi_pengguna_user_idx on public.sesi_pengguna(pengguna_id);
create index if not exists sesi_pengguna_expiry_idx on public.sesi_pengguna(expires_at);
alter table public.sesi_pengguna enable row level security;
create table if not exists public.refresh_token_pengguna (
    token_hash text primary key,
    sesi_id text not null references public.sesi_pengguna(id) on delete cascade,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists refresh_token_pengguna_session_idx on public.refresh_token_pengguna(sesi_id);
alter table public.refresh_token_pengguna enable row level security;

REVOKE ALL ON public.sesi_pengguna, public.refresh_token_pengguna FROM PUBLIC;
COMMIT;

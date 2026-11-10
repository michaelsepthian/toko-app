-- Rencana belanja terpisah dari transaksi, pengeluaran, dan mutasi stok.
begin;
create table if not exists public.rencana_belanja_item (
    id bigint generated always as identity primary key,
    idempotency_key uuid not null,
    urutan_input smallint not null check (urutan_input between 0 and 99),
    request_hash text not null,
    tanggal date not null,
    sumber_pembelian_id bigint references public.sumber_pembelian(id) on delete restrict,
    produk_id bigint references public.produk(id) on delete restrict,
    nama_barang text not null check (btrim(nama_barang) <> ''),
    jumlah numeric(18,3) check (jumlah is null or jumlah > 0),
    satuan text not null default '',
    catatan text not null default '',
    dibeli_at timestamptz,
    dibeli_by bigint references public.pengguna(id) on delete restrict,
    created_by bigint not null references public.pengguna(id) on delete restrict,
    updated_by bigint not null references public.pengguna(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by bigint references public.pengguna(id) on delete restrict,
    constraint rencana_belanja_batch_unique unique (idempotency_key, urutan_input),
    constraint rencana_belanja_checklist_valid check (
        (dibeli_at is null and dibeli_by is null) or
        (dibeli_at is not null and dibeli_by is not null)
    ),
    constraint rencana_belanja_delete_valid check (
        (deleted_at is null and deleted_by is null) or
        (deleted_at is not null and deleted_by is not null)
    )
);
create index if not exists rencana_belanja_tanggal_toko_idx
    on public.rencana_belanja_item(tanggal, sumber_pembelian_id, id)
    where deleted_at is null;
create index if not exists rencana_belanja_produk_idx
    on public.rencana_belanja_item(produk_id) where produk_id is not null;
create index if not exists rencana_belanja_sumber_idx
    on public.rencana_belanja_item(sumber_pembelian_id) where sumber_pembelian_id is not null;
alter table public.rencana_belanja_item enable row level security;
revoke all on public.rencana_belanja_item from public;
do $$ declare v_role text; begin
    foreach v_role in array array['anon', 'authenticated'] loop
        if exists(select 1 from pg_roles where rolname = v_role) then
            execute format('revoke all on public.rencana_belanja_item from %I', v_role);
        end if;
    end loop;
    if not exists(select 1 from pg_trigger where tgrelid = 'public.rencana_belanja_item'::regclass and tgname = 'set_updated_at') then
        create trigger set_updated_at before update on public.rencana_belanja_item
            for each row execute function public.set_updated_at();
    end if;
end $$;
commit;

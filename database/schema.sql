-- Toko kelontong — PostgreSQL mandiri
-- Jalankan sekali pada database baru melalui psql.
-- Tidak menghapus atau menimpa tabel yang sudah ada.
-- Semua nominal memakai rupiah; biaya pembayaran dibulatkan ke rupiah penuh.
-- Identity membuat sequence terpisah untuk setiap primary key.
-- Nomor struk: BILL-YYYYMMDD-HH24MISS-URUT / BELI-YYYYMMDD-HH24MISS-URUT.
-- Waktu nomor mengikuti saat INSERT dalam zona Asia/Jakarta, bukan tanggal input.
-- Sequence berlanjut tanpa reset harian; transaksi gagal bisa meninggalkan celah.
-- RLS aktif tanpa policy: akses API client belum dibuka.
-- Subtotal header, penyelesaian transaksi, serta mutasi stok harus dikelola
-- dalam satu transaksi database oleh backend/RPC (belum disediakan di DDL ini).

begin;

create sequence public.penjualan_nomor_seq as bigint start with 1 increment by 1 no cycle;
create sequence public.pembelian_nomor_seq as bigint start with 1 increment by 1 no cycle;

create table public.pengguna (
    id bigint generated always as identity primary key,
    nama text not null check (btrim(nama) <> ''),
    username text not null unique check (btrim(username) <> ''),
    password_hash text,
    peran text not null default 'KASIR' check (peran in ('PEMILIK', 'KASIR')),
    aktif boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.sesi_pengguna (
    id text primary key,
    pengguna_id bigint not null references public.pengguna(id) on delete cascade,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);
create index sesi_pengguna_user_idx on public.sesi_pengguna(pengguna_id);
create index sesi_pengguna_expiry_idx on public.sesi_pengguna(expires_at);
alter table public.sesi_pengguna enable row level security;
create table public.refresh_token_pengguna (
    token_hash text primary key,
    sesi_id text not null references public.sesi_pengguna(id) on delete cascade,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index refresh_token_pengguna_session_idx on public.refresh_token_pengguna(sesi_id);
alter table public.refresh_token_pengguna enable row level security;

create table public.kategori (
    id bigint generated always as identity primary key,
    nama text not null unique check (btrim(nama) <> ''),
    deskripsi text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.satuan (
    id bigint generated always as identity primary key,
    nama text not null unique check (btrim(nama) <> ''),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.produk (
    id bigint generated always as identity primary key,
    kategori_id bigint not null references public.kategori(id) on delete restrict,
    satuan_id bigint not null references public.satuan(id) on delete restrict,
    sku text not null unique check (btrim(sku) <> ''),
    barcode text unique check (barcode is null or btrim(barcode) <> ''),
    nama text not null check (btrim(nama) <> ''),
    harga_jual numeric(18,2) not null default 0 check (harga_jual >= 0),
    stok_minimum numeric(18,3) not null default 0 check (stok_minimum >= 0),
    is_favorit boolean not null default false,
    aktif boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.sumber_pembelian (
    id bigint generated always as identity primary key,
    nama text not null check (btrim(nama) <> ''),
    jenis text not null check (jenis in ('TOKO', 'SALES')),
    nama_toko_perusahaan text,
    nama_kontak text,
    nomor_telepon text,
    alamat text,
    catatan text,
    aktif boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.metode_pembayaran (
    id bigint generated always as identity primary key,
    nama text not null unique check (btrim(nama) <> ''),
    jenis text not null default 'LAINNYA' check (jenis in ('CASH', 'QRIS', 'DEBIT', 'TRANSFER', 'LAINNYA')),
    tarif_persen numeric(7,4) not null default 0 check (tarif_persen between 0 and 100),
    tarif_tetap numeric(18,2) not null default 0 check (tarif_tetap >= 0),
    penanggung_biaya text not null default 'TOKO'
        check (penanggung_biaya in ('TOKO', 'PELANGGAN')),
    untuk_penjualan boolean not null default false,
    untuk_pembelian boolean not null default false,
    aktif boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.penjualan (
    id bigint generated always as identity primary key,
    idempotency_key uuid unique,
    request_hash text,
    nomor text not null unique default (
        'BILL-' || to_char(statement_timestamp() at time zone 'Asia/Jakarta', 'YYYYMMDD-HH24MISS')
        || '-' || nextval('public.penjualan_nomor_seq'::regclass)::text
    ),
    pengguna_id bigint not null references public.pengguna(id) on delete restrict,
    metode_pembayaran_id bigint not null references public.metode_pembayaran(id) on delete restrict,
    tanggal timestamptz not null default now(),
    status text not null default 'DRAFT' check (status in ('DRAFT', 'SELESAI', 'BATAL')),
    subtotal_barang numeric(18,2) not null default 0 check (subtotal_barang >= 0),
    diskon_transaksi numeric(18,2) not null default 0 check (diskon_transaksi >= 0),
    total_belanja numeric(18,2) not null default 0 check (total_belanja >= 0),
    tarif_persen numeric(7,4) not null default 0 check (tarif_persen between 0 and 100),
    tarif_tetap numeric(18,2) not null default 0 check (tarif_tetap >= 0),
    penanggung_biaya text not null default 'TOKO'
        check (penanggung_biaya in ('TOKO', 'PELANGGAN')),
    biaya_pembayaran numeric(18,2) not null default 0 check (biaya_pembayaran >= 0),
    total_tagihan numeric(18,2) not null default 0 check (total_tagihan >= 0),
    jumlah_dibayar numeric(18,2) not null default 0 check (jumlah_dibayar >= 0),
    kembalian numeric(18,2) not null default 0 check (kembalian >= 0),
    nomor_referensi text,
    catatan text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint penjualan_diskon_valid check (diskon_transaksi <= subtotal_barang),
    constraint penjualan_selesai_lunas check (status <> 'SELESAI' or jumlah_dibayar >= total_tagihan)
);

create table public.detail_penjualan (
    id bigint generated always as identity primary key,
    penjualan_id bigint not null references public.penjualan(id) on delete restrict,
    produk_id bigint not null references public.produk(id) on delete restrict,
    nama_produk text not null,
    jumlah numeric(18,3) not null check (jumlah > 0),
    harga_jual numeric(18,2) not null check (harga_jual >= 0),
    diskon numeric(18,2) not null default 0 check (diskon >= 0),
    subtotal numeric(18,2) generated always as (round(jumlah * harga_jual - diskon, 2)) stored,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint detail_penjualan_diskon_valid check (diskon <= jumlah * harga_jual),
    constraint detail_penjualan_id_produk_unique unique (id, produk_id)
);

create table public.pembelian (
    id bigint generated always as identity primary key,
    idempotency_key uuid unique,
    request_hash text,
    nomor text not null unique default (
        'BELI-' || to_char(statement_timestamp() at time zone 'Asia/Jakarta', 'YYYYMMDD-HH24MISS')
        || '-' || nextval('public.pembelian_nomor_seq'::regclass)::text
    ),
    pengguna_id bigint not null references public.pengguna(id) on delete restrict,
    sumber_pembelian_id bigint references public.sumber_pembelian(id) on delete restrict,
    metode_pembayaran_id bigint not null references public.metode_pembayaran(id) on delete restrict,
    tanggal timestamptz not null default now(),
    nomor_nota text,
    status text not null default 'DRAFT' check (status in ('DRAFT', 'SELESAI', 'BATAL')),
    subtotal_barang numeric(18,2) not null default 0 check (subtotal_barang >= 0),
    diskon_transaksi numeric(18,2) not null default 0 check (diskon_transaksi >= 0),
    total_belanja numeric(18,2) not null default 0 check (total_belanja >= 0),
    tarif_persen numeric(7,4) not null default 0 check (tarif_persen between 0 and 100),
    tarif_tetap numeric(18,2) not null default 0 check (tarif_tetap >= 0),
    biaya_pembayaran numeric(18,2) not null default 0 check (biaya_pembayaran >= 0),
    total_pembayaran numeric(18,2) not null default 0 check (total_pembayaran >= 0),
    nomor_referensi text,
    catatan text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pembelian_diskon_valid check (diskon_transaksi <= subtotal_barang)
);

create table public.detail_pembelian (
    id bigint generated always as identity primary key,
    pembelian_id bigint not null references public.pembelian(id) on delete restrict,
    produk_id bigint not null references public.produk(id) on delete restrict,
    nama_produk text not null,
    jumlah numeric(18,3) not null check (jumlah > 0),
    harga_beli numeric(18,2) not null check (harga_beli >= 0),
    diskon numeric(18,2) not null default 0 check (diskon >= 0),
    subtotal numeric(18,2) generated always as (round(jumlah * harga_beli - diskon, 2)) stored,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint detail_pembelian_diskon_valid check (diskon <= jumlah * harga_beli),
    constraint detail_pembelian_id_produk_unique unique (id, produk_id)
);

alter sequence public.penjualan_nomor_seq owned by public.penjualan.nomor;
alter sequence public.pembelian_nomor_seq owned by public.pembelian.nomor;

create table public.mutasi_stok (
    id bigint generated always as identity primary key,
    produk_id bigint not null references public.produk(id) on delete restrict,
    pengguna_id bigint not null references public.pengguna(id) on delete restrict,
    detail_penjualan_id bigint,
    detail_pembelian_id bigint,
    tanggal timestamptz not null default now(),
    jenis text not null check (jenis in ('AWAL', 'PEMBELIAN', 'PENJUALAN', 'PENYESUAIAN', 'PEMBALIKAN')),
    perubahan numeric(18,3) not null check (perubahan <> 0),
    catatan text,
    created_at timestamptz not null default now(),
    constraint mutasi_detail_penjualan_fk foreign key (detail_penjualan_id, produk_id)
        references public.detail_penjualan(id, produk_id) on delete restrict,
    constraint mutasi_detail_pembelian_fk foreign key (detail_pembelian_id, produk_id)
        references public.detail_pembelian(id, produk_id) on delete restrict,
    constraint mutasi_sumber_valid check (
        (jenis in ('AWAL', 'PENYESUAIAN')
            and detail_penjualan_id is null and detail_pembelian_id is null
            and nullif(btrim(catatan), '') is not null)
        or (jenis = 'PEMBELIAN' and detail_pembelian_id is not null
            and detail_penjualan_id is null and perubahan > 0)
        or (jenis = 'PENJUALAN' and detail_penjualan_id is not null
            and detail_pembelian_id is null and perubahan < 0)
        or (jenis = 'PEMBALIKAN' and (
            (detail_penjualan_id is not null and detail_pembelian_id is null and perubahan > 0)
            or (detail_pembelian_id is not null and detail_penjualan_id is null and perubahan < 0)
        ))
    ),
    constraint mutasi_awal_positif check (jenis <> 'AWAL' or perubahan > 0)
);

-- Cegah pencatatan mutasi transaksi yang sama lebih dari sekali.
create unique index mutasi_penjualan_jenis_unique
    on public.mutasi_stok(detail_penjualan_id, jenis) where detail_penjualan_id is not null;
create unique index mutasi_pembelian_jenis_unique
    on public.mutasi_stok(detail_pembelian_id, jenis) where detail_pembelian_id is not null;
create unique index mutasi_awal_produk_unique
    on public.mutasi_stok(produk_id) where jenis = 'AWAL';

create index produk_kategori_idx on public.produk(kategori_id);
create index produk_satuan_idx on public.produk(satuan_id);
create index penjualan_pengguna_idx on public.penjualan(pengguna_id);
create index penjualan_metode_idx on public.penjualan(metode_pembayaran_id);
create index penjualan_tanggal_idx on public.penjualan(tanggal);
create index pembelian_pengguna_idx on public.pembelian(pengguna_id);
create index pembelian_sumber_idx on public.pembelian(sumber_pembelian_id);
create index pembelian_metode_idx on public.pembelian(metode_pembayaran_id);
create index pembelian_tanggal_idx on public.pembelian(tanggal);
create index detail_penjualan_transaksi_idx on public.detail_penjualan(penjualan_id);
create index detail_penjualan_produk_idx on public.detail_penjualan(produk_id);
create index detail_pembelian_transaksi_idx on public.detail_pembelian(pembelian_id);
create index detail_pembelian_produk_idx on public.detail_pembelian(produk_id);
create index mutasi_produk_tanggal_idx on public.mutasi_stok(produk_id, tanggal);
create index mutasi_pengguna_idx on public.mutasi_stok(pengguna_id);

-- Tarif disalin saat transaksi dibuat atau metode pembayaran diganti.
-- Mengubah tarif master tidak mengubah tarif pada transaksi yang sudah ada.
create function public.hitung_pembayaran_transaksi()
returns trigger language plpgsql set search_path = '' as $$
declare
    v_metode public.metode_pembayaran%rowtype;
    v_salin_tarif boolean;
    v_validasi_metode boolean;
begin
    if TG_OP = 'INSERT' then
        v_salin_tarif := true;
        v_validasi_metode := true;
    else
        v_salin_tarif := new.metode_pembayaran_id is distinct from old.metode_pembayaran_id;
        v_validasi_metode := v_salin_tarif
            or (new.status = 'SELESAI' and old.status is distinct from 'SELESAI');
    end if;

    if v_validasi_metode then
        select * into v_metode from public.metode_pembayaran
        where id = new.metode_pembayaran_id;

        if not found then
            raise exception 'Metode pembayaran tidak ditemukan';
        end if;
        if not v_metode.aktif then
            raise exception 'Metode pembayaran tidak aktif';
        end if;
        if TG_TABLE_NAME = 'penjualan' and not v_metode.untuk_penjualan then
            raise exception 'Metode pembayaran tidak tersedia untuk penjualan';
        end if;
        if TG_TABLE_NAME = 'pembelian' and not v_metode.untuk_pembelian then
            raise exception 'Metode pembayaran tidak tersedia untuk pembelian';
        end if;
    end if;

    if v_salin_tarif then
        new.tarif_persen := v_metode.tarif_persen;
        new.tarif_tetap := v_metode.tarif_tetap;
        if TG_TABLE_NAME = 'penjualan' then
            new.penanggung_biaya := v_metode.penanggung_biaya;
        end if;
    elsif TG_OP = 'UPDATE' then
        -- Snapshot tidak boleh diedit langsung jika metode tetap sama.
        new.tarif_persen := old.tarif_persen;
        new.tarif_tetap := old.tarif_tetap;
        if TG_TABLE_NAME = 'penjualan' then
            new.penanggung_biaya := old.penanggung_biaya;
        end if;
    end if;

    new.total_belanja := new.subtotal_barang - new.diskon_transaksi;
    new.biaya_pembayaran := round(new.total_belanja * new.tarif_persen / 100 + new.tarif_tetap, 0);

    if TG_TABLE_NAME = 'penjualan' then
        new.total_tagihan := new.total_belanja
            + case when new.penanggung_biaya = 'PELANGGAN' then new.biaya_pembayaran else 0 end;
        new.kembalian := greatest(new.jumlah_dibayar - new.total_tagihan, 0);
    else
        new.total_pembayaran := new.total_belanja + new.biaya_pembayaran;
    end if;
    return new;
end;
$$;

create trigger hitung_pembayaran_penjualan
    before insert or update on public.penjualan
    for each row execute function public.hitung_pembayaran_transaksi();
create trigger hitung_pembayaran_pembelian
    before insert or update on public.pembelian
    for each row execute function public.hitung_pembayaran_transaksi();

create function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- Pasang timestamp otomatis serta aktifkan RLS pada seluruh tabel aplikasi.
do $$
declare
    v_tabel text;
begin
    foreach v_tabel in array array[
        'pengguna', 'kategori', 'satuan', 'produk', 'sumber_pembelian',
        'metode_pembayaran', 'penjualan', 'detail_penjualan',
        'pembelian', 'detail_pembelian'
    ] loop
        execute format(
            'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
            v_tabel
        );
        execute format('alter table public.%I enable row level security', v_tabel);
    end loop;
    alter table public.mutasi_stok enable row level security;
end;
$$;

-- Fungsi ini hanya digunakan melalui trigger, bukan endpoint RPC client.
revoke execute on function public.hitung_pembayaran_transaksi() from public;
revoke execute on function public.set_updated_at() from public;
-- Batasi akses role client bila tersedia.
do $$
declare v_role text;
begin
    foreach v_role in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = v_role) then
            execute format('revoke execute on function public.hitung_pembayaran_transaksi() from %I', v_role);
            execute format('revoke execute on function public.set_updated_at() from %I', v_role);
        end if;
    end loop;
end;
$$;

-- Data awal: tarif nol agar tidak mengasumsikan tarif penyedia pembayaran.
insert into public.satuan (nama) values ('pcs'), ('bungkus'), ('kg'), ('liter'), ('gr');
insert into public.metode_pembayaran
    (nama, jenis, untuk_penjualan, untuk_pembelian)
values
    ('Cash', 'CASH', true, true),
    ('QRIS', 'QRIS', true, false),
    ('Debit', 'DEBIT', true, true),
    ('Transfer Supplier', 'TRANSFER', false, true);

comment on column public.metode_pembayaran.penanggung_biaya is
    'Berlaku untuk penjualan; biaya pembayaran pembelian selalu menjadi pengeluaran toko.';
comment on column public.penjualan.subtotal_barang is
    'Diisi backend/RPC dari SUM(detail_penjualan.subtotal), bukan langsung dari input client.';
comment on column public.pembelian.subtotal_barang is
    'Diisi backend/RPC dari SUM(detail_pembelian.subtotal), bukan langsung dari input client.';

commit;

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

-- Snapshot ringkasan harian. Dapat dijalankan ulang pada PostgreSQL.
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

-- Audit dari pengguna login. Data lama tanpa pelaku yang pasti tetap NULL.
BEGIN;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['kategori','satuan','produk','sumber_pembelian','metode_pembayaran','penjualan','pembelian','catatan_belanja'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES public.pengguna(id) ON DELETE RESTRICT, ADD COLUMN IF NOT EXISTS updated_by bigint REFERENCES public.pengguna(id) ON DELETE RESTRICT', t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['penjualan','pembelian','catatan_belanja'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS cancel_transaction_at timestamptz, ADD COLUMN IF NOT EXISTS cancel_transaction_by bigint REFERENCES public.pengguna(id) ON DELETE RESTRICT', t);
  -- Pembuat transaksi diketahui dari pengguna_id; waktu perubahan historis dipertahankan.
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER set_updated_at', t);
  EXECUTE format('UPDATE public.%I SET created_by = pengguna_id WHERE created_by IS NULL', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER set_updated_at', t);
 END LOOP;
END $$;
COMMIT;

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

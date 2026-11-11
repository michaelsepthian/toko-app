-- Index untuk keyset pagination dan pencarian substring katalog produk.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Supabase dapat memasang pg_trgm di schema extensions, PostgreSQL lokal di public.
SET LOCAL search_path = public, extensions;
CREATE INDEX IF NOT EXISTS produk_nama_katalog_idx ON public.produk (lower(nama), id);
CREATE INDEX IF NOT EXISTS produk_sku_exact_idx ON public.produk (lower(sku));
CREATE INDEX IF NOT EXISTS produk_harga_katalog_idx ON public.produk (harga_jual, lower(nama), id);
CREATE INDEX IF NOT EXISTS produk_favorit_katalog_idx ON public.produk (is_favorit DESC, lower(nama), id);
CREATE INDEX IF NOT EXISTS produk_nama_trgm_idx ON public.produk USING gin (nama gin_trgm_ops);
CREATE INDEX IF NOT EXISTS produk_sku_trgm_idx ON public.produk USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS produk_barcode_trgm_idx ON public.produk USING gin (barcode gin_trgm_ops);
COMMIT;

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

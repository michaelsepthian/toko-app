-- Jalankan setelah schema.sql. Aman dijalankan ulang; tidak mengubah waktu riwayat.
BEGIN;

ALTER TABLE public.penjualan ADD COLUMN IF NOT EXISTS tanggal_pendapatan date;

-- Data lama mengikuti hari transaksi dalam WIB, bukan zona waktu koneksi SQL.
UPDATE public.penjualan
SET tanggal_pendapatan = (tanggal AT TIME ZONE 'Asia/Jakarta')::date
WHERE tanggal_pendapatan IS NULL;

CREATE OR REPLACE FUNCTION public.isi_tanggal_pendapatan()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.tanggal_pendapatan IS NULL THEN
        NEW.tanggal_pendapatan := (NEW.tanggal AT TIME ZONE 'Asia/Jakarta')::date;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS isi_tanggal_pendapatan ON public.penjualan;
CREATE TRIGGER isi_tanggal_pendapatan
    BEFORE INSERT ON public.penjualan
    FOR EACH ROW EXECUTE FUNCTION public.isi_tanggal_pendapatan();

ALTER TABLE public.penjualan ALTER COLUMN tanggal_pendapatan SET NOT NULL;
CREATE INDEX IF NOT EXISTS penjualan_tanggal_pendapatan_idx
    ON public.penjualan(tanggal_pendapatan, status);
REVOKE EXECUTE ON FUNCTION public.isi_tanggal_pendapatan() FROM PUBLIC;

COMMENT ON COLUMN public.penjualan.tanggal_pendapatan IS
    'Hari pendapatan dalam WIB untuk ringkasan harian; tanggal tetap waktu transaksi sebenarnya.';

COMMIT;

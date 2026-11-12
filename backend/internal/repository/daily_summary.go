package repository

import (
	"encoding/json"
	"time"

	"github.com/shopspring/decimal"
	"toko/backend/internal/model"
)

type DailyRow struct {
	RincianPembelian    json.RawMessage
	AlokasiSebelumnya   decimal.Decimal
	AlokasiSebelumnyaID *int64
	BelumDirinci        decimal.Decimal
	model.DailyPayment
	Sumber       string
	Terbaru      *time.Time
	DihitungPada time.Time
}

// Satu statement menjamin semua komponen memakai snapshot baca yang sama.
func (s *Store) DailyRows(start, end time.Time) ([]DailyRow, error) {
	var rows []DailyRow
	err := s.DB.Raw(`WITH belanja AS (
 SELECT p.total_pembayaran AS total,false AS belum_dirinci,p.updated_at,
 NULL::bigint AS catatan_id,p.id AS pembelian_id,p.nomor,m.nama AS metode,''::text AS catatan
 FROM public.pembelian p JOIN public.metode_pembayaran m ON m.id=p.metode_pembayaran_id
 WHERE p.tanggal>=? AND p.tanggal<? AND p.status='SELESAI'
 AND NOT EXISTS(SELECT 1 FROM public.catatan_belanja c WHERE c.pembelian_id=p.id)
 UNION ALL
 SELECT c.total,c.status='TERBUKA',c.updated_at,c.id,c.pembelian_id,
 coalesce(p.nomor,''),coalesce(m.nama,'Belum dirinci'),c.catatan
 FROM public.catatan_belanja c LEFT JOIN public.pembelian p ON p.id=c.pembelian_id
 LEFT JOIN public.metode_pembayaran m ON m.id=p.metode_pembayaran_id
 WHERE c.tanggal=? AND c.status IN('TERBUKA','SELESAI')
 ), alokasi AS (
 SELECT id,belanja_besok FROM public.ringkasan_harian WHERE tanggal=? ORDER BY id DESC LIMIT 1
 ), harian AS (
 SELECT 'PENJUALAN' AS sumber,m.id AS metode_pembayaran_id,m.nama,m.jenis,
 count(*) FILTER(WHERE p.status='SELESAI') AS jumlah_selesai,
 count(*) FILTER(WHERE p.status='BATAL') AS jumlah_batal,
 coalesce(sum(p.total_tagihan) FILTER(WHERE p.status='SELESAI'),0) AS total_selesai,
 coalesce(sum(p.total_tagihan) FILTER(WHERE p.status='BATAL'),0) AS total_batal,
 coalesce(sum(p.biaya_pembayaran) FILTER(WHERE p.status='SELESAI' AND p.penanggung_biaya='TOKO'),0) AS biaya_toko,
 max(p.updated_at) AS terbaru,0::numeric AS belum_dirinci
 FROM public.penjualan p JOIN public.metode_pembayaran m ON m.id=p.metode_pembayaran_id
 WHERE p.tanggal_pendapatan=? AND p.status IN ('SELESAI','BATAL')
 GROUP BY m.id,m.nama,m.jenis
 UNION ALL
 SELECT 'PEMBELIAN',0,'Semua pembelian','LAINNYA',count(*),0,coalesce(sum(total),0),0,0,max(updated_at),
 coalesce(sum(total) FILTER(WHERE belum_dirinci),0) FROM belanja
 ) SELECT harian.*,statement_timestamp() AS dihitung_pada,
 (SELECT id FROM alokasi) AS alokasi_sebelumnya_id,
 coalesce((SELECT belanja_besok FROM alokasi),0) AS alokasi_sebelumnya,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
 'catatan_id',b.catatan_id,'pembelian_id',b.pembelian_id,'nomor',b.nomor,'metode',b.metode,
 'total',b.total::text,'belum_dirinci',b.belum_dirinci,'catatan',b.catatan,
 'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('nama',d.nama_produk,'jumlah',d.jumlah::text,'subtotal',d.subtotal::text) ORDER BY d.id),'[]'::jsonb)
 FROM public.detail_pembelian d WHERE d.pembelian_id=b.pembelian_id)
 ) ORDER BY b.pembelian_id NULLS LAST,b.catatan_id),'[]'::jsonb) FROM belanja b) AS rincian_pembelian
 FROM harian ORDER BY sumber,metode_pembayaran_id`, start, end, start.Format("2006-01-02"), start.AddDate(0, 0, -1).Format("2006-01-02"), start.Format("2006-01-02")).Scan(&rows).Error
	return rows, err
}

func (s *Store) DailySummaryByKey(key string) (model.RingkasanHarian, error) {
	var row model.RingkasanHarian
	err := s.DB.Where("idempotency_key = ?", key).Take(&row).Error
	return row, err
}

func (s *Store) CreateDailySummary(row *model.RingkasanHarian) error { return s.DB.Create(row).Error }

func (s *Store) DailySummary(id int64) (model.RingkasanHarian, error) {
	var row model.RingkasanHarian
	err := s.DB.First(&row, id).Error
	return row, err
}

func (s *Store) ListDailySummaries(date string, limit, offset int) ([]model.RingkasanHarian, error) {
	query := s.DB.Order("id DESC").Limit(limit).Offset(offset)
	if date != "" {
		query = query.Where("tanggal = ?", date)
	}
	rows := make([]model.RingkasanHarian, 0)
	err := query.Find(&rows).Error
	return rows, err
}

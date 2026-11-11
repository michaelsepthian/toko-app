import { test, expect, type Page } from '@playwright/test'
import { jakartaDay } from '../../lib/history-date'

async function incomeSummary(page: Page) {
  let canceled = false
  const snapshot = (isCanceled: boolean) => ({
    versi: 2, tanggal: jakartaDay(), dihitung_pada: '2026-11-01T03:00:00Z', hash_sumber: (isCanceled ? 'b' : 'a').repeat(64),
    jumlah_selesai: isCanceled ? 4 : 5, jumlah_batal: isCanceled ? 1 : 0,
    total_selesai: isCanceled ? '400000' : '500000', total_batal: isCanceled ? '100000' : '0', total_sebelum_pembatalan: '500000',
    total_cash: isCanceled ? '400000' : '500000', total_non_cash: '0', biaya_toko: '0', total_bersih: isCanceled ? '400000' : '500000',
    total_pembelian: '0', pembelian_cash: '0', pembelian_belum_dirinci: '0', alokasi_sebelumnya: '0', selisih_belanja: '0', pembelian: [], metode: [],
  })
  const saved = { id: 1, tanggal: jakartaDay(), pengguna_id: 1, nama_pencatat: 'Pemilik', nama_toko: 'Toko', email_tujuan: null, kas_aktual: '500000', belanja_besok: '0', total_dana_seharusnya: '500000', total_dana_aktual: '500000', kas_seharusnya: '500000', selisih_kas: '0', sisa_kas: '500000', catatan: '', snapshot: snapshot(false), created_at: '2026-11-01T03:00:00Z' }
  const user = { id: 1, nama: 'Pemilik', username: 'pemilik', peran: 'PEMILIK' }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
  await page.route('http://api.test/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    let data: unknown = []
    if (path === '/setup') data = { initialized: true, registration_open: false }
    if (path === '/auth/login') data = { user, access_token: 'toko_' + 'a'.repeat(64), expires_at: new Date(Date.now() + 3600000).toISOString() }
    if (path === '/me') data = user
    if (path === '/master-data') data = { version: '1', categories: [], units: [], payments: [], sources: [] }
    if (path === '/katalog/produk') data = { items: [], has_next: false, next_cursor: null, version: '1' }
    if (path === '/master-data/version') data = { version: '1' }
    if (path === '/ringkasan-harian/preview') data = snapshot(canceled)
    if (path === '/ringkasan-harian') data = request.method() === 'POST' ? { ...saved, ...request.postDataJSON() } : [saved]
    await route.fulfill({ headers: cors, json: { data } })
  })
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('pemilik')
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Riwayat', exact: true }).click()
  await page.getByRole('button', { name: 'Ringkasan Harian', exact: true }).click()
  const income = page.locator('div.rounded-2xl').filter({ has: page.getByText('Pendapatan setelah pembatalan', { exact: true }) }).filter({ has: page.getByText(/transaksi berhasil · sudah dikurangi pembatalan/) })
  return { cancel: () => { canceled = true }, income }
}

test('pembatalan mengurangi pendapatan sekali dan memperbarui ringkasan saat kembali ke halaman', async ({ page }) => {
  const summary = await incomeSummary(page)
  await expect(summary.income).toContainText('500.000')
  summary.cancel()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary.income).toContainText('400.000')
  await expect(summary.income).not.toContainText('300.000')
  const funds = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ringkasan dana harian', exact: true }) })
  await expect(funds.getByText('Penjualan sebelum pembatalan').locator('..')).toContainText('500.000')
  await expect(funds.getByText('− Transaksi dibatalkan').locator('..')).toContainText('100.000')
  await expect(funds.getByText('Total dana seharusnya').locator('..')).toContainText('400.000')
})

test('laporan lama tetap tersimpan tetapi Muat ulang menampilkan pendapatan terbaru', async ({ page }) => {
  const summary = await incomeSummary(page)
  await expect(summary.income).toContainText('500.000')
  summary.cancel()
  await page.getByRole('button', { name: 'Muat ulang', exact: true }).click()
  await expect(summary.income).toContainText('400.000')
  await page.getByRole('button', { name: 'Lihat laporan', exact: true }).click()
  await expect(summary.income).toContainText('500.000')
  await expect(page.getByText('Transaksi telah berubah sejak laporan ini disimpan.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Muat ulang', exact: true }).click()
  await expect(summary.income).toContainText('400.000')
  await expect(page.getByText('Data terbaru berdasarkan tanggal pendapatan (WIB)', { exact: true })).toBeVisible()
})


test('alokasi belanja besok mulai kosong dan boleh tidak diisi ketika menyimpan laporan', async ({ page }) => {
  await incomeSummary(page)
  await page.getByRole('button', { name: 'Isi Ringkasan', exact: true }).click()
  const actual = page.getByLabel('Total uang aktual yang dihitung pemilik', { exact: true })
  const budget = page.getByLabel('Uang belanja toko untuk besok (opsional)', { exact: true })
  await expect(actual).toHaveValue('')
  await expect(budget).toHaveValue('')
  await actual.fill('500000')
  const request = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/ringkasan-harian')
  await page.getByRole('button', { name: 'Simpan Ringkasan', exact: true }).click()
  expect((await request).postDataJSON().belanja_besok).toBe('0')
  await expect(page.getByRole('button', { name: 'Pratinjau email', exact: true })).toBeVisible()
})

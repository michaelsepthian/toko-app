import { test, expect, type Page } from '@playwright/test'
import { jakartaDay } from '../../lib/history-date'

async function mockAPI(page: Page, role = 'PEMILIK', timeoutOnce = false, stock = '10', productCount = 1) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const product = { id: 1, nama: 'Beras Ramos', sku: 'BR-001', barcode: '0012345678901', harga_jual: '10000', stok_minimum: '2', kategori_id: 1, satuan_id: 1, aktif: true }
  const methods = [
    { id: 1, nama: 'Cash', jenis: 'CASH', tarif_persen: '0', tarif_tetap: '0', penanggung_biaya: 'TOKO', aktif: true, untuk_penjualan: true, untuk_pembelian: true },
    { id: 2, nama: 'QRIS', jenis: 'QRIS', tarif_persen: '0.7', tarif_tetap: '0', penanggung_biaya: 'PELANGGAN', aktif: true, untuk_penjualan: true, untuk_pembelian: false },
    { id: 3, nama: 'Transfer Supplier', jenis: 'TRANSFER', tarif_persen: '0', tarif_tetap: '2500', penanggung_biaya: 'TOKO', aktif: true, untuk_penjualan: false, untuk_pembelian: true },
  ]
  const products = Array.from({ length: productCount }, (_, index) => ({ ...product, id: index + 1, ...(index ? { nama: `Produk Uji ${index + 1}`, sku: `TEST-${index + 1}`, barcode: String(1000000000000 + index) } : {}) }))
  let version = 1
  let dropped = false
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' }
  const user = { id: 1, nama: 'Kasir Test', username: 'kasir', peran: role }
  const jwt = 'toko_' + 'a'.repeat(64)
  await page.route('http://api.test/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/api/v1', '')
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    if (path === '/setup') { await route.fulfill({ json: { data: { initialized: true, registration_open: false } }, headers: cors }); return }
    if (path === '/auth/login') { await route.fulfill({ json: { data: { user, access_token: jwt, expires_at: new Date(Date.now()+3600000).toISOString() } }, headers: cors }); return }
    if (request.headers().authorization !== `Bearer ${jwt}`) { await route.fulfill({ status: 401, json: { error: { message: 'Missing token' } }, headers: cors }); return }
    let result: unknown = []
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); calls.push({ path, body })
      if (path === '/penjualan' || path === '/pembelian') {
        if (timeoutOnce && !dropped) { dropped = true; await route.abort('failed'); return }
        const purchase = path === '/pembelian'
        result = { id: 1, nomor: purchase ? 'BELI-20261028-230000-1' : 'BILL-20261028-230000-1', tanggal: '2026-10-28T16:00:00Z', status: 'SELESAI', metode_pembayaran_id: body.metode_pembayaran_id, subtotal_barang: purchase ? '7000' : '10000', diskon_transaksi: '0', total_belanja: purchase ? '7000' : '10000', biaya_pembayaran: '0', total_tagihan: '10000', total_pembayaran: '7000', jumlah_dibayar: body.jumlah_dibayar || '0', kembalian: '10000', detail: [{ id: 1, produk_id: 1, nama_produk: product.nama, jumlah: '1', harga_jual: '10000', harga_beli: '7000', diskon: '0', subtotal: purchase ? '7000' : '10000' }] }
      } else { result = { id: 9, ...body }; if (path === '/produk') { products.push(result as typeof product); version++ } }
    } else {
      if (path === '/master-data') result = { version: String(version), products, categories: [{ id: 1, nama: 'Sembako' }], units: [{ id: 1, nama: 'pcs' }], payments: methods, sources: role === 'PEMILIK' ? [{ id: 1, nama: 'Grosir Makmur', jenis: 'TOKO', aktif: true }] : [] }
      if (path === '/master-data/version') result = { version: String(version) }
      if (path === '/stok/ringkasan') result = products.map(product => ({ id: product.id, stok: stock, stok_minimum: '2' }))
      if (path === '/me') result = { id: 1, nama: 'Kasir Test', peran: role }
      if (path === '/produk') result = url.searchParams.has('barcode') && url.searchParams.get('barcode') !== product.barcode ? [] : [product]
      if (path === '/kategori') result = [{ id: 1, nama: 'Sembako' }]
      if (path === '/satuan') result = [{ id: 1, nama: 'pcs' }]
      if (path === '/stok') result = [{ id: 1, stok: stock, stok_minimum: '2' }]
      if (path === '/metode-pembayaran') result = methods
      if (path === '/sumber-pembelian') result = [{ id: 1, nama: 'Grosir Makmur', jenis: 'TOKO', aktif: true }]
    }
    await route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { data: result }, headers: cors })
  })
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('kasir')
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true })).toBeVisible()
  return calls
}

test('scan exact, cash checkout, dan payload API', async ({ page }) => {
  const calls = await mockAPI(page)
  const scan = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  await scan.fill('9999999999999'); await scan.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Barcode' })).toContainText('tidak ditemukan')
  await scan.fill('0012345678901'); await scan.press('Enter')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
  await expect(page.getByRole('group', { name: 'Metode pembayaran' }).getByRole('button', { name: 'Transfer Supplier' })).toHaveCount(0)
  await expect(page.getByLabel('Print struk setelah pembayaran')).toHaveCount(0)
  await page.getByRole('button', { name: /Bayar.*F8/ }).click()
  await page.getByRole('dialog').getByLabel('Print struk setelah pembayaran').uncheck()
  await page.getByLabel('Uang diterima').fill('20000')
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('dialog')).toContainText('BILL-20261028-230000-1')
  const sale = calls.find(call => call.path === '/penjualan')!
  expect(sale.body.items).toEqual([{ produk_id: 1, jumlah: '1', diskon: '0' }])
  expect(sale.body.jumlah_dibayar).toBe('20000'); expect(sale.body).not.toHaveProperty('subtotal_barang')
  expect(sale.body.idempotency_key).toMatch(/^[a-f0-9-]{36}$/)
  await page.screenshot({ path: 'test-results/kasir-payment.png', fullPage: true })
})

test('pembelian mencatat sumber, harga beli dan metode yang sesuai', async ({ page }) => {
  const calls = await mockAPI(page)
  await page.locator('.pos-more > summary').click()
  await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Pembelian', exact: true }).click()
  const scan = page.getByRole('textbox', { name: 'Cari atau scan produk pembelian' })
  await scan.fill('0012345678901'); await scan.press('Enter')
  await page.getByLabel('Harga beli Beras Ramos').fill('7000')
  await page.getByRole('button', { name: 'Tempat beli / sales', exact: true }).click()
  await page.getByRole('combobox', { name: 'Cari tempat beli / sales' }).fill('makmur')
  await page.keyboard.press('Enter')
  await page.getByLabel('Nomor nota (opsional)').fill('NOTA-01')
  await page.getByRole('button', { name: 'Metode pembayaran', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Metode pembayaran' })).not.toContainText('QRIS')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Simpan Pembelian · F8/ }).click()
  await page.getByRole('button', { name: 'Konfirmasi & Simpan' }).click()
  await expect(page.getByRole('dialog')).toContainText('BELI-20261028-230000-1')
  const buy = calls.find(call => call.path === '/pembelian')!
  expect(buy.body.items).toEqual([{ produk_id: 1, jumlah: '1', diskon: '0', harga_beli: '7000' }])
  expect(buy.body.sumber_pembelian_id).toBe(1); expect(buy.body.nomor_nota).toBe('NOTA-01')
})

test('kasir tidak memiliki menu pemilik', async ({ page }) => {
  await mockAPI(page, 'KASIR')
  const nav = page.getByRole('navigation', { name: 'Menu utama' })
  await expect(nav.getByRole('button', { name: 'Pembelian', exact: true })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Data Master' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Buka Laci/ })).toBeVisible()
})

test('retry setelah koneksi putus memakai body dan key yang sama', async ({ page }) => {
  const calls = await mockAPI(page, 'PEMILIK', true)
  await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
  await expect(page.getByLabel('Print struk setelah pembayaran')).toHaveCount(0)
  await page.getByRole('button', { name: /Bayar.*F8/ }).click()
  await page.getByRole('dialog').getByLabel('Print struk setelah pembayaran').uncheck()
  await page.getByLabel('Uang diterima').fill('20000')
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Tanggal operasional (WIB)', { exact: true })).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: /Coba lagi/ }).click()
  await expect(page.getByRole('dialog')).toContainText('BILL-20261028-230000-1')
  const sales = calls.filter(call => call.path === '/penjualan')
  expect(sales).toHaveLength(2); expect(sales[0].body).toEqual(sales[1].body)
})


test('pencarian dan pembayaran dapat diselesaikan dengan keyboard', async ({ page }) => {
  const calls = await mockAPI(page)
  await page.locator('#cart-heading').click()
  await page.keyboard.type('beras')
  const search = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  await expect(search).toHaveValue('beras')
  await expect(search).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
  await page.keyboard.press('F3')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toBeFocused()
  await page.getByLabel('Jumlah Beras Ramos').fill('2')
  await page.keyboard.press('Enter')
  await expect(search).toBeFocused()
  await page.keyboard.press('F8')
  await expect(page.getByLabel('Uang diterima')).toBeFocused()
  await page.keyboard.type('100000')
  await expect(page.getByLabel('Uang diterima')).toHaveValue('100.000')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('PEMBAYARAN BERHASIL')
  await expect(page.getByRole('button', { name: /Selesai.*Enter/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(search).toBeFocused()
  expect(calls.find(call => call.path === '/penjualan')?.body.items).toEqual([{ produk_id: 1, jumlah: '2', diskon: '0' }])
})


test('penjualan menyembunyikan stok dan tetap dapat dibayar; F9 kosongkan keranjang', async ({ page }) => {
  const calls = await mockAPI(page, 'PEMILIK', false, '0')
  const card = page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true })
  await expect(card).toBeEnabled()
  await expect(card).toHaveAttribute('data-highlighted', 'true')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
  await expect(page.locator('.sale-cart')).not.toContainText('Stok')
  await expect(card).not.toContainText('Stok')
  page.once('dialog', dialog => dialog.accept())
  await page.keyboard.press('F9')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveCount(0)
  await expect(page.getByLabel('Cari atau scan produk penjualan')).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('F8')
  await expect(page.getByRole('dialog')).not.toContainText('Stok')
  await page.keyboard.type('20000')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('PEMBAYARAN BERHASIL')
  expect(calls.filter(call => call.path === '/penjualan')).toHaveLength(1)
})

test('dropdown produk mencari pilihan dengan keyboard', async ({ page }) => {
  await mockAPI(page)
  await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Produk', exact: true }).click()
  await page.getByRole('button', { name: 'Kategori', exact: true }).click()
  const search = page.getByRole('combobox', { name: 'Cari kategori' })
  await expect(search).toBeFocused()
  await search.fill('semb')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Kategori', exact: true })).toContainText('Sembako')
  await page.getByRole('button', { name: 'Satuan', exact: true }).click()
  await page.getByRole('combobox', { name: 'Cari satuan' }).fill('tidak ada')
  await expect(page.getByText('Tidak ada pilihan yang cocok.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Satuan', exact: true })).toBeFocused()
})

test('F10 memakai jalur buka laci dan menampilkan hasilnya', async ({ page }) => {
  await mockAPI(page, 'KASIR')
  // Mode browser default belum mengaktifkan QZ Tray. Pesannya membuktikan handler shortcut dipanggil tanpa akses perangkat.
  await page.keyboard.press('F10')
  await expect(page.getByRole('alert').filter({ hasText: 'QZ Tray' })).toBeVisible()
})


test('lebar panel dapat diubah horizontal dan tombol bayar tetap selebar panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAPI(page)
  const divider = page.getByRole('separator', { name: 'Atur lebar daftar belanja' })
  const cart = page.locator('.sale-cart')
  const before = (await cart.boundingBox())!
  const handle = (await divider.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 110, handle.y + handle.height / 2)
  await page.mouse.up()
  const after = (await cart.boundingBox())!
  expect(after.width).toBeGreaterThan(before.width + 60)
  expect(after.height).toBeCloseTo(before.height, 0)
  await divider.focus()
  const value = Number(await divider.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowLeft')
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(value)
  const pay = (await page.locator('.sale-pay').boundingBox())!
  const methods = (await page.locator('.sale-methods').boundingBox())!
  expect(pay.width).toBeCloseTo(methods.width, 0)
  expect(pay.y).toBeGreaterThan(methods.y)
  await divider.dblclick()
  await expect(divider).toHaveAttribute('aria-valuenow', '45')
})

test('transaksi berikutnya kembali menggunakan metode tunai', async ({ page }) => {
  await mockAPI(page)
  const methods = page.getByRole('group', { name: 'Metode pembayaran' })
  await expect(methods.getByRole('button', { name: 'Tunai' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
  await page.keyboard.press('F5')
  await page.getByRole('button', { name: 'Selesaikan Pembayaran', exact: true }).click()
  await page.getByRole('button', { name: /Selesai.*Enter/ }).click()
  await expect(methods.getByRole('button', { name: 'Tunai' })).toHaveAttribute('aria-pressed', 'true')
})


test('Enter menutup popup berhasil walau fokus terlepas dan tidak menambah barang saat ditahan', async ({ page }) => {
  await mockAPI(page)
  await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
  await page.keyboard.press('F8')
  await page.getByLabel('Uang diterima').fill('20000')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('PEMBAYARAN BERHASIL')
  await page.getByRole('button', { name: /Selesai.*Enter/ }).evaluate(button => (button as HTMLElement).blur())
  await page.keyboard.down('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Cari atau scan produk penjualan')).toBeFocused()
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveCount(0)
})


test('master sekali tanpa paging, tidak dimuat ulang setelah penjualan; stok hanya di pembelian', async ({ page }) => {
  const reads: string[] = []
  page.on('request', request => { if (request.method() === 'GET' && request.url().startsWith('http://api.test')) reads.push(new URL(request.url()).pathname) })
  await mockAPI(page)
  await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
  await page.keyboard.press('F8')
  await page.getByLabel('Uang diterima').fill('20000')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('PEMBAYARAN BERHASIL')
  await page.keyboard.press('Enter')
  expect(reads.filter(path => path === '/api/v1/master-data')).toHaveLength(1)
  expect(reads.filter(path => /\/(produk|kategori|satuan|metode-pembayaran|sumber-pembelian|stok)$/.test(path))).toHaveLength(0)
  expect(reads.filter(path => path === '/api/v1/stok/ringkasan')).toHaveLength(0)
  await page.locator('.pos-more > summary').click()
  await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Pembelian', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Stok Produk', exact: true })).toBeVisible()
  await expect.poll(() => reads.filter(path => path === '/api/v1/stok/ringkasan').length).toBe(1)
})


test('riwayat penjualan dimulai hari ini dan dapat difilter tanggal tertentu', async ({ page }) => {
  const queries: URL[] = []
  page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && url.pathname === '/api/v1/penjualan') queries.push(url) })
  await mockAPI(page)
  await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Riwayat', exact: true }).click()
  const date = page.getByLabel('Tanggal penjualan (WIB)', { exact: true })
  await expect(date).toHaveValue(jakartaDay())
  await expect(date).toBeEnabled()
  await expect.poll(() => queries.at(-1)?.searchParams.get('tanggal')).toBe(jakartaDay())
  await date.fill('2026-10-01')
  await expect.poll(() => queries.at(-1)?.searchParams.get('tanggal')).toBe('2026-10-01')
  expect(queries.at(-1)?.searchParams.get('offset')).toBe('0')
  await expect(page.getByText('Tidak ada penjualan pada tanggal ini.')).toBeVisible()
  await page.getByRole('button', { name: 'Hari ini', exact: true }).click()
  await expect(date).toHaveValue(jakartaDay())
  await expect.poll(() => queries.at(-1)?.searchParams.get('tanggal')).toBe(jakartaDay())
})

test('tanggal pendapatan tersimpan per tab dan dikirim tanpa mengubah tanggal riwayat', async ({ page }) => {
  const calls = await mockAPI(page)
  const date = page.getByRole('navigation', { name: 'Menu utama' }).getByLabel('Tanggal operasional (WIB)', { exact: true })
  await expect(date).toHaveValue(jakartaDay())
  await date.fill('2026-10-01')
  await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
  await page.getByRole('button', { name: 'Tambah transaksi', exact: true }).click()
  await expect(date).toHaveValue(jakartaDay())
  await date.fill('2026-10-02')
  await page.getByRole('tab', { name: /Transaksi 1/ }).click()
  await expect(date).toHaveValue('2026-10-01')
  await page.reload()
  await expect(date).toHaveValue('2026-10-01')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
  await page.getByRole('button', { name: /Bayar.*F8/ }).click()
  await expect(date).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('1 Oktober 2026')
  await page.getByLabel('Uang diterima').fill('20000')
  await page.getByRole('button', { name: 'Selesaikan Pembayaran', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('PEMBAYARAN BERHASIL')
  expect(calls.find(call => call.path === '/penjualan')?.body.tanggal_pendapatan).toBe('2026-10-01')
  await page.getByRole('button', { name: /Selesai.*Enter/ }).click()
  await expect(date).toHaveValue(jakartaDay())
  await page.getByRole('tab', { name: /Transaksi 2/ }).click()
  await expect(date).toHaveValue('2026-10-02')
})

test('nominal form baru kosong dan diskon serta tarif kosong dikirim sebagai nol', async ({ page }) => {
  const calls = await mockAPI(page)
  const nav = page.getByRole('navigation', { name: 'Menu utama' })
  await nav.getByRole('button', { name: 'Produk', exact: true }).click()
  await page.getByRole('button', { name: 'Tambah Produk', exact: true }).click()
  const price = page.getByLabel('Harga jual', { exact: true })
  await expect(price).toHaveValue('')
  await price.pressSequentially('0015000')
  await expect(price).toHaveValue('15.000')
  await price.fill('0,50')
  await expect(price).toHaveValue('0,50')
  await page.getByRole('button', { name: 'Tutup form produk', exact: true }).click()
  await page.locator('.pos-more > summary').click()
  await nav.getByRole('button', { name: 'Pembelian', exact: true }).click()
  await page.getByRole('button', { name: /Sembako.*BR-001.*Beras Ramos/ }).click()
  await expect(page.getByLabel('Harga beli Beras Ramos', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Diskon Beras Ramos', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Diskon transaksi', { exact: true })).toHaveValue('')
  await page.getByLabel('Harga beli Beras Ramos', { exact: true }).fill('7000')
  await page.getByRole('button', { name: /Simpan Pembelian · F8/ }).click()
  await page.getByRole('button', { name: 'Konfirmasi & Simpan', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Transaksi tersimpan')
  expect(calls.find(call => call.path === '/pembelian')?.body.diskon_transaksi).toBe('0')
  expect(calls.find(call => call.path === '/pembelian')?.body.items).toEqual([{ produk_id: 1, jumlah: '1', diskon: '0', harga_beli: '7000' }])
  await page.getByRole('dialog').getByRole('button', { name: 'Selesai', exact: true }).click()
  await expect(page.getByLabel('Diskon transaksi', { exact: true })).toHaveValue('')
  await page.locator('.pos-more > summary').click()
  await nav.getByRole('button', { name: 'Data Master', exact: true }).click()
  await page.getByRole('button', { name: 'Metode Pembayaran', exact: true }).click()
  await expect(page.getByLabel('Tarif persen', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Tarif tetap (Rp)', { exact: true })).toHaveValue('')
  await page.getByLabel('Nama metode', { exact: true }).fill('Metode tanpa biaya')
  await page.getByRole('button', { name: 'Simpan Metode', exact: true }).click()
  await expect.poll(() => calls.filter(call => call.path === '/metode-pembayaran').length).toBe(1)
  const method = calls.find(call => call.path === '/metode-pembayaran')!
  expect(method.body.tarif_tetap).toBe('0')
  expect(method.body.tarif_persen).toBe('0')
})

for (const width of [320, 390, 768, 1440]) {
  test(`penjualan, produk dan detail riwayat responsif ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await mockAPI(page)
    const drawer = page.getByRole('button', { name: 'Buka Laci', exact: true })
    const menu = page.getByLabel('Menu lainnya', { exact: true })
    const drawerBounds = await drawer.boundingBox()
    const menuBounds = await menu.boundingBox()
    expect(Math.abs(drawerBounds!.y - menuBounds!.y)).toBeLessThanOrEqual(1)
    expect(menuBounds!.x).toBeGreaterThan(drawerBounds!.x)
    await menu.click()
    await expect(page.getByRole('button', { name: 'Perangkat', exact: true })).toBeVisible()
    expect(await page.locator('.pos-more-menu').evaluate(el => { const bounds = el.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth })).toBe(true)
    await menu.click()
    const noOverflow = async () => { const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth }).map(el => ({ class: el.className, right: el.getBoundingClientRect().right })).slice(0, 10)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBe(true) }
    await noOverflow()
    await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
    await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
    if (width < 1024) {
      const tabs = page.getByRole('tablist', { name: 'Bagian penjualan' })
      await expect(page.locator('.sale-cart')).toBeHidden()
      await tabs.getByRole('tab', { name: /Keranjang 1/ }).click()
      await expect(page.locator('.sale-catalog')).toBeHidden()
      await expect(page.locator('.sale-cart')).toBeVisible()
      await tabs.getByRole('tab', { name: 'Produk', exact: true }).click()
      await expect(page.locator('.sale-catalog')).toBeVisible()
      await tabs.getByRole('tab', { name: /Keranjang/ }).click()
      await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
    } else {
      await expect(page.locator('.sale-cart')).toBeVisible()
      await expect(page.locator('.sale-catalog')).toBeVisible()
      await expect(page.getByRole('tablist', { name: 'Bagian penjualan' })).toBeHidden()
    }
    await noOverflow()
    await page.screenshot({ path: `test-results/mobile-sales-${width}.png`, fullPage: true })
    await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Produk', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Daftar Produk', exact: true })).toBeVisible()
    await expect(page.getByLabel('Nama produk', { exact: true })).not.toBeVisible()
    await page.getByRole('button', { name: 'Tambah Produk', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Tambah Produk', exact: true })).toBeVisible()
    await expect(page.getByLabel('Nama produk', { exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Tutup form produk', exact: true }).click()
    const productRow = page.getByRole('button', { name: 'Edit Beras Ramos', exact: true })
    await productRow.getByText('Beras Ramos', { exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Edit Produk', exact: true })).toBeVisible()
    await expect(page.getByLabel('Nama produk', { exact: true })).toHaveValue('Beras Ramos')
    await expect(productRow.locator('svg')).toHaveCount(0)
    await noOverflow()
    await page.screenshot({ path: `test-results/product-editor-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(productRow).toBeFocused()
    await noOverflow()
    await page.screenshot({ path: `test-results/mobile-products-${width}.png`, fullPage: true })
    const transaction = { nama_kasir: 'Siti Kasir', id: 44, nomor: 'BILL-20261102-000044', tanggal: '2026-11-02T03:00:00Z', tanggal_pendapatan: '2026-11-01', status: 'SELESAI', metode_pembayaran_id: 1, total_tagihan: '10000', diskon_transaksi: '0', biaya_pembayaran: '0', jumlah_dibayar: '20000', kembalian: '10000', detail: [{ id: 1, nama_produk: 'Beras Ramos', jumlah: '1', harga_jual: '10000', diskon: '0', subtotal: '10000' }] }
    await page.route('http://api.test/api/v1/penjualan**', route => route.fulfill({ json: { data: new URL(route.request().url()).pathname.endsWith('/44') ? transaction : [transaction] }, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }))
    await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Riwayat', exact: true }).click()
    const row = page.getByRole('button', { name: `Detail ${transaction.nomor}`, exact: true })
    await expect(row).toBeVisible()
    await noOverflow()
    await page.screenshot({ path: `test-results/mobile-history-${width}.png`, fullPage: true })
    await row.focus()
    await page.keyboard.press('Enter')
    const detail = page.getByRole('dialog')
    await expect(detail).toContainText('Beras Ramos')
    await expect(detail).toContainText('Kasir: Siti Kasir')
    await expect(detail).not.toContainText('Tanggal pendapatan')
    await expect(detail).not.toContainText('Waktu pencatatan')
    await page.screenshot({ path: `test-results/mobile-detail-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(detail).not.toBeVisible()
    await expect(row).toBeFocused()
  })
}

for (const width of [320, 1440]) {
  test(`seluruh area tanggal operasional membuka kalender ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(() => {
      Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value() {
        this.dataset.pickerOpens = String(Number(this.dataset.pickerOpens ?? 0) + 1)
      } })
    })
    await mockAPI(page)
    const date = page.getByLabel('Tanggal operasional (WIB)', { exact: true })
    const control = page.locator('.pos-operating-date')
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    const positions = [{ x: 5, y: 5 }, { x: bounds!.width / 2, y: bounds!.height / 2 }, { x: bounds!.width - 5, y: bounds!.height - 5 }]
    for (const [index, position] of positions.entries()) {
      await control.click({ position })
      await expect(date).toHaveAttribute('data-picker-opens', String(index + 1))
      await page.keyboard.press('Escape')
    }
    await date.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await expect(date).toHaveAttribute('data-picker-opens', '5')
    await date.fill('2026-10-01')
    await expect(control).toContainText('1 Oktober 2026')
    expect(await date.getAttribute('max')).toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/operational-date-${width}.png` })
  })
}

for (const width of [320, 390, 768, 1440]) {
  test(`pembelian dan data master nyaman digunakan ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const calls = await mockAPI(page)
    const noOverflow = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await expect(page.locator('.sale-product-top .lucide-plus')).toHaveCount(0)
    const nav = page.getByRole('navigation', { name: 'Menu utama' })
    await page.getByLabel('Menu lainnya', { exact: true }).click()
    await nav.getByRole('button', { name: 'Pembelian', exact: true }).click()
    const catalog = page.locator('#purchase-panel-products')
    const cart = page.locator('#purchase-panel-cart')
    if (width < 1024) {
      await expect(cart).toBeHidden()
      await expect(catalog).toBeVisible()
      await expect(page.getByRole('tablist', { name: 'Bagian pembelian' })).toBeVisible()
      await expect(page.locator('.purchase-inventory')).toBeHidden()
    } else {
      await expect(cart).toBeVisible()
      await expect(catalog).toBeVisible()
      await expect(page.getByRole('tablist', { name: 'Bagian pembelian' })).toBeHidden()
    }
    await noOverflow()
    await page.screenshot({ path: `test-results/purchase-catalog-${width}.png`, fullPage: true })
    await catalog.getByRole('button', { name: /Beras Ramos/ }).click()
    if (width < 1024) {
      const tabs = page.getByRole('tablist', { name: 'Bagian pembelian' })
      await tabs.getByRole('tab', { name: /Keranjang 1/ }).click()
      await expect(catalog).toBeHidden()
      await expect(cart).toBeVisible()
      await expect(page.locator('.purchase-inventory')).toBeVisible()
    }
    const quantity = page.getByLabel('Jumlah Beras Ramos', { exact: true })
    await expect(quantity).toHaveValue('1')
    expect((await quantity.boundingBox())!.width).toBeGreaterThan(40)
    await cart.getByRole('button', { name: 'Tambah Beras Ramos', exact: true }).click()
    await expect(quantity).toHaveValue('2')
    await cart.getByRole('button', { name: 'Kurangi Beras Ramos', exact: true }).click()
    await page.getByLabel('Harga beli Beras Ramos', { exact: true }).fill('7000')
    if (width < 1024) {
      const tabs = page.getByRole('tablist', { name: 'Bagian pembelian' })
      await tabs.getByRole('tab', { name: 'Produk', exact: true }).click()
      await expect(cart).toBeHidden()
      await tabs.getByRole('tab', { name: /Keranjang/ }).click()
      await expect(page.getByLabel('Harga beli Beras Ramos', { exact: true })).toHaveValue('7.000')
      await expect(quantity).toHaveValue('1')
    }
    await page.getByRole('button', { name: 'Tempat beli / sales', exact: true }).click()
    await page.getByRole('option', { name: 'Grosir Makmur (TOKO)' }).click()
    await noOverflow()
    await page.screenshot({ path: `test-results/purchase-cart-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: /Simpan Pembelian · F8/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Konfirmasi Pembelian')
    await noOverflow()
    await dialog.getByRole('button', { name: 'Konfirmasi & Simpan' }).click()
    await expect(dialog).toContainText('Transaksi tersimpan')
    expect(calls.find(call => call.path === '/pembelian')?.body.sumber_pembelian_id).toBe(1)
    await dialog.getByRole('button', { name: 'Selesai', exact: true }).click()
    await page.getByLabel('Menu lainnya', { exact: true }).click()
    await nav.getByRole('button', { name: 'Data Master', exact: true }).click()
    await expect(page.getByLabel('Nama kategori', { exact: true })).toBeVisible()
    await noOverflow()
    await page.getByRole('button', { name: 'Tempat Beli / Sales', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Daftar Tempat Beli / Sales' })).toBeVisible()
    if (width < 768) {
      expect((await page.locator('.master-list').boundingBox())!.y).toBeLessThan((await page.locator('.master-editor').boundingBox())!.y)
    }
    await page.locator('.master-row').getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByLabel('Nama tempat beli / sales', { exact: true })).toHaveValue('Grosir Makmur')
    await expect(page.getByLabel('Nama tempat beli / sales', { exact: true })).toBeFocused()
    await noOverflow()
    await page.getByRole('button', { name: 'Batal edit', exact: true }).click()
    if (width < 768) {
      await page.getByRole('link', { name: 'Tambah Tempat Beli / Sales', exact: true }).click()
      await expect(page.getByLabel('Nama tempat beli / sales', { exact: true })).toBeFocused()
    }
    await page.getByRole('button', { name: 'Metode Pembayaran', exact: true }).click()
    await page.locator('.master-row').filter({ hasText: 'Transfer Supplier' }).getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByLabel('Nama metode', { exact: true })).toHaveValue('Transfer Supplier')
    await expect(page.getByLabel('Nama metode', { exact: true })).toBeFocused()
    await noOverflow()
    await page.screenshot({ path: `test-results/master-payments-${width}.png`, fullPage: true })
    const updateRequest = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/metode-pembayaran/3'))
    await page.getByRole('button', { name: 'Simpan Metode', exact: true }).click()
    expect((await updateRequest).postDataJSON().nama).toBe('Transfer Supplier')
    await expect(page.getByLabel('Nama metode', { exact: true })).toHaveValue('')
  })
}

test('tab mobile mendukung keyboard, pembayaran, dan pergantian ukuran layar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockAPI(page)
  const tabs = page.getByRole('tablist', { name: 'Bagian penjualan' })
  const products = tabs.getByRole('tab', { name: 'Produk', exact: true })
  const cart = tabs.getByRole('tab', { name: /Keranjang/ })
  const search = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  await page.screenshot({ path: 'test-results/mobile-product-tab.png', fullPage: true })
  await search.fill('99999999999')
  await search.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Barcode' })).toBeVisible()
  await search.fill('Beras')
  await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
  await expect(products).toHaveAttribute('aria-selected', 'true')
  await expect(cart).toContainText('1')
  await products.focus()
  await page.keyboard.press('ArrowRight')
  await expect(cart).toBeFocused()
  await expect(page.locator('.sale-catalog')).toBeHidden()
  await page.keyboard.press('F2')
  await expect(search).toBeFocused()
  await expect(products).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('F3')
  await expect(page.getByLabel('Jumlah Beras Ramos')).toBeFocused()
  await expect(cart).toHaveAttribute('aria-selected', 'true')
  await page.setViewportSize({ width: 1024, height: 844 })
  await expect(tabs).toBeHidden()
  await expect(page.locator('.sale-catalog')).toBeVisible()
  await expect(page.locator('.sale-cart')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.sale-catalog')).toBeHidden()
  await expect(page.getByLabel('Jumlah Beras Ramos')).toHaveValue('1')
  await page.screenshot({ path: 'test-results/mobile-cart-tab.png', fullPage: true })
  await page.getByRole('button', { name: /^Bayar/ }).click()
  await page.getByRole('dialog').getByLabel('Print struk setelah pembayaran').uncheck()
  await page.getByLabel('Uang diterima').fill('20000')
  await page.getByRole('button', { name: 'Selesaikan Pembayaran', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('PEMBAYARAN BERHASIL')
})


for (const width of [390, 1440]) {
  test(`tanggal operasional masa depan bisa disimpan ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const calls = await mockAPI(page)
    const date = page.getByLabel('Tanggal operasional (WIB)', { exact: true })
    expect(await date.getAttribute('max')).toBeNull()
    await date.fill('2099-12-31')
    await expect(date).toHaveAttribute('aria-invalid', 'false')
    await page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true }).click()
    if (width < 1024) await page.getByRole('tablist', { name: 'Bagian penjualan' }).getByRole('tab', { name: /Keranjang/ }).click()
    await page.getByRole('button', { name: /^Bayar/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('31 Desember 2099')
    await dialog.getByLabel('Print struk setelah pembayaran').uncheck()
    await page.getByLabel('Uang diterima').fill('20000')
    await page.getByRole('button', { name: 'Selesaikan Pembayaran', exact: true }).click()
    await expect(dialog).toContainText('PEMBAYARAN BERHASIL')
    expect(calls.find(call => call.path === '/penjualan')?.body.tanggal_pendapatan).toBe('2099-12-31')
  })
}


for (const width of [390, 1440]) {
  test(`edit produk melalui baris dan simpan modal ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await mockAPI(page)
    await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Produk', exact: true }).click()
    const row = page.getByRole('button', { name: 'Edit Beras Ramos', exact: true })
    await row.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Edit Produk', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Nama produk', { exact: true })).toBeFocused()
    await dialog.getByLabel('Harga jual', { exact: true }).fill('12000')
    await dialog.getByRole('button', { name: 'Kategori', exact: true }).click()
    await page.getByRole('option', { name: 'Sembako', exact: true }).click()
    let attempts = 0
    const payloads: Record<string, unknown>[] = []
    await page.route('http://api.test/api/v1/produk/1', async route => {
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'PUT,OPTIONS' } }); return }
      payloads.push(route.request().postDataJSON())
      attempts++
      await route.fulfill({ status: attempts === 1 ? 400 : 200, json: attempts === 1 ? { error: { message: 'Produk belum dapat disimpan' } } : { data: { id: 1, ...payloads.at(-1) } }, headers: { 'access-control-allow-origin': '*' } })
    })
    await dialog.getByRole('button', { name: 'Simpan Produk', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Produk belum dapat disimpan')
    await expect(dialog.getByLabel('Harga jual', { exact: true })).toHaveValue('12.000')
    await dialog.getByRole('button', { name: 'Simpan Produk', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Produk tersimpan')
    expect(payloads.at(-1)).toMatchObject({ nama: 'Beras Ramos', harga_jual: '12000', kategori_id: 1, satuan_id: 1 })
  })
}

test('kasir melihat daftar produk tanpa akses modal edit', async ({ page }) => {
  await mockAPI(page, 'KASIR')
  await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Produk', exact: true }).click()
  await expect(page.locator('.product-list-row')).toContainText('Beras Ramos')
  await expect(page.getByRole('button', { name: 'Edit Beras Ramos', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tambah Produk', exact: true })).toHaveCount(0)
  await page.locator('.product-list-row').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

for (const width of [320, 1440]) {
  test(`pemilih tanggal riwayat seragam dengan tanggal operasional ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(() => {
      Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value() {
        this.dataset.pickerOpens = String(Number(this.dataset.pickerOpens ?? 0) + 1)
      } })
    })
    await mockAPI(page)
    await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Riwayat', exact: true }).click()
    const date = page.getByLabel('Tanggal penjualan (WIB)', { exact: true })
    await expect(date).toBeEnabled()
    const control = page.locator('.history-date-control')
    const bounds = (await control.boundingBox())!
    for (const [index, position] of [{ x: 5, y: 5 }, { x: bounds.width / 2, y: bounds.height / 2 }, { x: bounds.width - 5, y: bounds.height - 5 }].entries()) {
      await control.click({ position })
      await expect(date).toHaveAttribute('data-picker-opens', String(index + 1))
      await page.keyboard.press('Escape')
    }
    await date.press('Enter')
    await expect(date).toHaveAttribute('data-picker-opens', '4')
    await date.press('Space')
    await expect(date).toHaveAttribute('data-picker-opens', '5')
    const request = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).searchParams.get('tanggal') === '2099-12-31')
    await date.fill('2099-12-31')
    await request
    await expect(control).toContainText('31 Desember 2099')
    await expect(date).toBeEnabled()
    expect(await date.getAttribute('max')).toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/history-date-control-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Hari ini', exact: true }).click()
    await expect(date).toHaveValue(jakartaDay())
  })
}

for (const width of [320, 390]) {
  test(`search produk tetap terlihat saat scroll mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 620 })
    await mockAPI(page, 'PEMILIK', false, '10', 100)
    const saleSearch = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const visibleSearch = async (selector: string, minimumTop: number) => {
      await expect.poll(async () => {
        const bounds = (await page.locator(selector).boundingBox())!
        return bounds.y >= minimumTop - 1 && bounds.y + bounds.height <= 620
      }).toBe(true)
    }
    await visibleSearch('.sale-search', 65)
    await page.locator('.sale-virtual-catalog').evaluate(element => { element.scrollTop = 1800 })
    await visibleSearch('.sale-search', 65)
    await saleSearch.fill('Beras')
    await expect(page.getByRole('button', { name: 'Tambah Beras Ramos ke keranjang', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/sticky-sales-search-${width}.png` })
    await page.evaluate(() => scrollTo(0, 0))
    await page.getByLabel('Menu lainnya', { exact: true }).click()
    await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Pembelian', exact: true }).click()
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await visibleSearch('.purchase-search-area form', 65)
    await page.locator('.purchase-products').evaluate(element => { element.scrollTop = 1800 })
    await visibleSearch('.purchase-search-area form', 65)
    await page.getByLabel('Cari atau scan produk pembelian', { exact: true }).fill('Beras')
    await expect(page.locator('.purchase-products').getByRole('button', { name: /Beras Ramos/ })).toBeVisible()
    await page.screenshot({ path: `test-results/sticky-purchase-search-${width}.png` })
    await page.evaluate(() => scrollTo(0, 0))
    await page.getByRole('navigation', { name: 'Menu utama' }).getByRole('button', { name: 'Produk', exact: true }).click()
    await page.evaluate(() => scrollTo(0, 1800))
    await visibleSearch('.product-search-bar', 0)
    expect((await page.locator('.product-search-bar').boundingBox())!.y).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/sticky-product-search-${width}.png` })
    await page.getByLabel('Cari daftar produk', { exact: true }).fill('Beras')
    await expect(page.locator('.product-list-row')).toHaveCount(1)
    await expect(page.locator('.product-list-row')).toContainText('Beras Ramos')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [390, 1440]) {
  test(`loading daftar produk dan favorit terlihat ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/master-data')
    await mockAPI(page)
    const initial = await (await initialResponse).json()
    await expect(page.getByRole('button', { name: 'Urutan produk penjualan', exact: true })).toBeHidden()
    await expect(page.getByLabel('Utamakan favorit', { exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Perbarui terlaris', exact: true })).toBeHidden()
    await expect(page.locator('.sale-result-count')).toBeHidden()
    const options = page.locator('.sale-product-options')
    await options.locator('summary').click()
    const sort = page.getByRole('button', { name: 'Urutan produk penjualan', exact: true })
    await expect(sort).toBeVisible()
    await sort.click()
    await page.getByRole('option', { name: 'Nama A–Z', exact: true }).click()
    await expect(sort).toContainText('Nama A–Z')
    await page.getByLabel('Utamakan favorit', { exact: true }).check()
    await expect(page.getByRole('button', { name: 'Perbarui terlaris', exact: true })).toBeVisible()
    await expect(options.locator('.sale-result-count')).toContainText('1 produk')
    await options.locator('summary').click()
    await expect(sort).toBeHidden()
    await options.locator('summary').click()
    await expect(sort).toContainText('Nama A–Z')
    await expect(page.getByLabel('Utamakan favorit', { exact: true })).toBeChecked()
    await options.locator('summary').click()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS' }
    let releaseMaster!: () => void
    const masterGate = new Promise<void>(resolve => { releaseMaster = resolve })
    await page.route(/\/api\/v1\/master-data(?:\?refresh=true)?$/, async route => {
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
      await masterGate
      await route.fulfill({ json: initial, headers: cors })
    })
    await page.getByLabel('Menu lainnya', { exact: true }).click()
    await page.getByRole('button', { name: 'Muat ulang data', exact: true }).click()
    await expect(page.locator('.sale-catalog').getByRole('status', { name: 'Memuat daftar produk' })).toBeVisible()
    await expect(page.locator('.sale-no-products')).toHaveCount(0)
    await page.screenshot({ path: `test-results/product-loading-${width}.png` })
    const nav = page.getByRole('navigation', { name: 'Menu utama' })
    await nav.getByRole('button', { name: 'Produk', exact: true }).click()
    await expect(page.locator('.product-list').getByRole('status', { name: 'Memuat daftar produk' })).toBeVisible()
    await expect(page.locator('.product-list-row')).toHaveCount(0)
    await page.getByLabel('Menu lainnya', { exact: true }).click()
    await nav.getByRole('button', { name: 'Pembelian', exact: true }).click()
    await expect(page.locator('.purchase-products').getByRole('status', { name: 'Memuat daftar produk' })).toBeVisible()
    releaseMaster()
    await expect(page.locator('.purchase-products .product-loading')).toHaveCount(0)
    await nav.getByRole('button', { name: 'Penjualan', exact: true }).click()
    let releaseFavorite!: () => void
    let favoriteGate = new Promise<void>(resolve => { releaseFavorite = resolve })
    let fail = false
    await page.route('http://api.test/api/v1/produk/1/favorit', async route => {
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
      await favoriteGate
      if (!fail) initial.data.products[0].is_favorit = true
      await route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: { message: 'Favorit belum tersimpan' } } : { data: { ...initial.data.products[0], is_favorit: true } }, headers: cors })
    })
    await page.getByRole('button', { name: 'Tandai favorit Beras Ramos', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Menyimpan favorit Beras Ramos', exact: true })).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('.product-favorite-progress')).toBeVisible()
    expect(await page.locator('.product-favorite-progress svg').evaluate(element => getComputedStyle(element).animationName)).toBe('product-loading-spin')
    await page.screenshot({ path: `test-results/favorite-loading-${width}.png` })
    releaseFavorite()
    const favorite = page.getByRole('button', { name: 'Hapus favorit Beras Ramos', exact: true })
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.product-favorite-progress')).toHaveCount(0)
    fail = true
    favoriteGate = new Promise<void>(resolve => { releaseFavorite = resolve })
    await favorite.click()
    await expect(page.locator('.product-favorite-progress')).toBeVisible()
    releaseFavorite()
    await expect(page.locator('.sale-page').getByRole('alert')).toContainText('Favorit belum tersimpan')
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    await expect(favorite).toBeEnabled()
    await expect(page.locator('.product-favorite-progress')).toHaveCount(0)
  })
}

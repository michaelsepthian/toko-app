import { test, expect, type Page } from '@playwright/test'
import { catalogFixture } from './catalog-fixture'

async function catalogAPI(page: Page, failInitial = false, failNext = false) {
  const products = Array.from({ length: 125 }, (_, index) => ({
    id: index + 1,
    nama: `Barang ${String(index + 1).padStart(3, '0')}`,
    sku: `SKU-${index + 1}`,
    barcode: `000${String(index + 1).padStart(10, '0')}`,
    harga_jual: '1000',
    stok_minimum: '0',
    kategori_id: 1,
    satuan_id: 1,
    aktif: true,
    is_favorit: false,
  }))
  const reads: URL[] = []
  const user = { id: 1, nama: 'Owner', username: 'owner', peran: 'PEMILIK' }
  const cors = {
    'access-control-allow-origin': 'http://127.0.0.1:3007',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  }
  let version = 1
  await page.route('http://api.test/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', '')
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    let data: unknown = []
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 401,
        headers: cors,
        json: { error: { code: 'SESSION_INVALID', message: 'Sesi berakhir' } },
      })
      return
    }
    if (path === '/setup') data = { initialized: true, registration_open: false }
    else if (path === '/auth/login')
      data = {
        user,
        access_token: 'test.jwt.signature',
        expires_at: new Date(Date.now() + 1800000).toISOString(),
        session_expires_at: new Date(Date.now() + 17 * 3600000).toISOString(),
      }
    else if (path === '/me') data = user
    else if (path === '/master-data')
      data = {
        version: String(version),
        categories: [{ id: 1, nama: 'Sembako' }],
        units: [{ id: 1, nama: 'pcs' }],
        payments: [],
        sources: [],
      }
    else if (path === '/master-data/version') data = { version: String(version) }
    else if (path.endsWith('/favorit')) {
      const product = products.find((product) => product.id === Number(path.split('/')[2]))!
      product.is_favorit = request.postDataJSON().is_favorit
      version++
      data = product
    } else if (path === '/katalog/produk') {
      reads.push(url)
      if (
        (failInitial && !url.searchParams.has('cursor')) ||
        (failNext && url.searchParams.has('cursor'))
      ) {
        failInitial = false
        failNext = false
        await route.fulfill({
          status: 500,
          headers: cors,
          json: { error: { message: 'Gangguan sementara' } },
        })
        return
      }
      data = catalogFixture(products, url.searchParams, String(version))
    }
    await route.fulfill({ headers: cors, json: { data } })
  })
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('owner')
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible()
  return { reads, products, cors }
}

test('katalog hanya mengunduh halaman pertama dan scan menemukan produk di halaman yang belum dimuat', async ({
  page,
}) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  expect(api.reads).toHaveLength(1)
  expect(api.reads[0].searchParams.get('limit')).toBe('50')
  const search = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  await search.fill(api.products[124].barcode)
  await search.press('Enter')
  await expect(page.getByLabel('Jumlah Barang 125', { exact: true })).toHaveValue('1')
  expect(api.reads.some((url) => url.searchParams.has('cursor'))).toBe(false)
  expect(api.reads.some((url) => url.searchParams.get('exact') === api.products[124].barcode)).toBe(
    true,
  )
  // A name-sorted fuzzy match must not beat a case-insensitive exact SKU.
  await search.fill('sku-125')
  await search.press('Enter')
  await expect(page.getByLabel('Jumlah Barang 125', { exact: true })).toHaveValue('2')
})

test('pencarian memakai cache per query dan cache diinvalidasi setelah favorit berubah', async ({
  page,
}) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const search = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  const queryReads = () => api.reads.filter((url) => url.searchParams.get('q') === 'Barang 125')
  await search.fill('Barang 125')
  await expect(page.locator('.sale-product')).toHaveCount(1)
  await search.fill('Barang 124')
  await expect(
    page.getByRole('button', { name: 'Tambah Barang 124 ke keranjang', exact: true }),
  ).toBeVisible()
  await search.fill('Barang 125')
  await expect(
    page.getByRole('button', { name: 'Tambah Barang 125 ke keranjang', exact: true }),
  ).toBeVisible()
  expect(queryReads()).toHaveLength(1)
  await page.getByRole('button', { name: 'Tandai favorit Barang 125', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Hapus favorit Barang 125', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(queryReads()).toHaveLength(2)
})

test('satu klik favorit hanya satu PUT dan satu GET katalog setelah sinkronisasi master', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT') writes.push(new URL(request.url()).pathname)
  })
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const before = api.reads.length
  let started!: () => void, release!: () => void
  const pending = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('http://api.test/api/v1/master-data', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    started()
    await gate
    await route.fallback()
  })
  await page.getByRole('button', { name: 'Tandai favorit Barang 001', exact: true }).click()
  await pending
  try {
    // Flush the invalidation/render effects while master-data is still in flight.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    expect(api.reads).toHaveLength(before)
  } finally {
    release()
  }
  await expect(
    page.getByRole('button', { name: 'Hapus favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const checked = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/master-data/version',
  )
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await checked
  expect(writes).toEqual(['/api/v1/produk/1/favorit'])
  expect(api.reads).toHaveLength(before + 1)
})

test('favorit dari perangkat lain diperbarui lewat versi tanpa menunggu TTL satu jam', async ({
  page,
}) => {
  await page.clock.install()
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const before = api.reads.length
  // Simulate a different client: update the server without our api() event.
  await page.evaluate(async () => {
    const response = await fetch('http://api.test/api/v1/produk/1/favorit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorit: true }),
    })
    if (!response.ok) throw new Error('Fixture mutation failed')
  })
  await expect(
    page.getByRole('button', { name: 'Tandai favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(api.reads).toHaveLength(before)
  await page.clock.runFor(30000)
  await expect(
    page.getByRole('button', { name: 'Hapus favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(api.reads).toHaveLength(before + 1)
})

test('perubahan dari tab lain dan focus bersamaan hanya memuat katalog sekali', async ({
  page,
}) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const before = api.reads.length
  await page.evaluate(async () => {
    await fetch('http://api.test/api/v1/produk/1/favorit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorit: true }),
    })
    window.dispatchEvent(new StorageEvent('storage', { key: 'toko:master-updated' }))
    window.dispatchEvent(new Event('focus'))
  })
  await expect(
    page.getByRole('button', { name: 'Hapus favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(api.reads).toHaveLength(before + 1)
})

test('katalog tetap diperbarui sekali jika master-data gagal setelah favorit tersimpan', async ({
  page,
}) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const before = api.reads.length
  await page.route('http://api.test/api/v1/master-data', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 500,
      headers: api.cors,
      json: { error: { message: 'Master sementara gagal' } },
    })
  })
  await page.getByRole('button', { name: 'Tandai favorit Barang 001', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Hapus favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pos-error-banner')).toContainText('Master sementara gagal')
  expect(api.reads).toHaveLength(before + 1)
})

test('favorit gagal tidak membatalkan cache atau memuat ulang katalog', async ({ page }) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const before = api.reads.length
  await page.route('http://api.test/api/v1/produk/1/favorit', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 500,
      headers: api.cors,
      json: { error: { message: 'Favorit gagal disimpan' } },
    })
  })
  await page.getByRole('button', { name: 'Tandai favorit Barang 001', exact: true }).click()
  await expect(page.locator('.sale-page').getByRole('alert')).toContainText(
    'Favorit gagal disimpan',
  )
  await expect(
    page.getByRole('button', { name: 'Tandai favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(api.reads).toHaveLength(before)
})

test('Muat ulang data tetap melewati cache walau versi tidak berubah', async ({ page }) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  const before = api.reads.length
  api.products[0].is_favorit = true
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/master-data' &&
      new URL(response.url()).searchParams.get('refresh') === 'true',
  )
  await page.getByLabel('Menu lainnya', { exact: true }).click()
  await page.getByRole('button', { name: 'Muat ulang data', exact: true }).click()
  await refreshed
  await expect(
    page.getByRole('button', { name: 'Hapus favorit Barang 001', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(api.reads).toHaveLength(before + 1)
})

test('respons pencarian lama tidak menggantikan hasil pencarian terbaru', async ({ page }) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const pending = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('http://api.test/api/v1/katalog/produk?**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('q') !== 'Barang 124') {
      await route.fallback()
      return
    }
    started()
    await gate
    await route.fulfill({
      headers: api.cors,
      json: { data: catalogFixture(api.products, url.searchParams) },
    })
  })
  const search = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  await search.fill('Barang 124')
  await pending
  await search.fill('Barang 125')
  await expect(
    page.getByRole('button', { name: 'Tambah Barang 125 ke keranjang', exact: true }),
  ).toBeVisible()
  const oldResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).searchParams.get('q') === 'Barang 124',
  )
  release()
  await oldResponse
  await expect(page.locator('.sale-product')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Tambah Barang 125 ke keranjang', exact: true }),
  ).toBeVisible()
})

test('halaman awal gagal dapat dicoba lagi tanpa menyatakan produk tidak ada', async ({ page }) => {
  await catalogAPI(page, true)
  await expect(page.locator('.sale-catalog').getByRole('alert')).toContainText('Gangguan sementara')
  await expect(page.locator('.sale-no-products')).toHaveCount(0)
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
})

test('dropdown stok mencari SKU di server dan dapat memilih dengan keyboard', async ({ page }) => {
  const api = await catalogAPI(page)
  await page.getByLabel('Menu lainnya', { exact: true }).click()
  await page.getByRole('button', { name: 'Pembelian', exact: true }).click()
  await page.getByRole('button', { name: 'Stok Awal / Penyesuaian', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Stok Awal / Penyesuaian', exact: true })
  await dialog.getByRole('button', { name: 'Produk', exact: true }).click()
  const search = dialog.getByRole('combobox', { name: 'Cari produk', exact: true })
  await search.fill('SKU-125')
  await expect(dialog.getByRole('option', { name: 'Barang 125', exact: true })).toBeVisible()
  await search.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Produk', exact: true })).toContainText(
    'Barang 125',
  )
  expect(api.reads.some((url) => url.searchParams.get('q') === 'SKU-125')).toBe(true)
})

test('hasil scan tertunda tidak masuk ke keranjang transaksi lain', async ({ page }) => {
  const api = await catalogAPI(page)
  await expect(page.locator('.sale-virtual-space')).toHaveAttribute('data-loaded-count', '50')
  let release!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const pending = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('http://api.test/api/v1/katalog/produk?**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.searchParams.has('exact')) {
      await route.fallback()
      return
    }
    started()
    await gate
    await route.fulfill({
      headers: api.cors,
      json: { data: catalogFixture(api.products, url.searchParams) },
    })
  })
  const search = page.getByLabel('Cari atau scan produk penjualan', { exact: true })
  await search.fill(api.products[124].barcode)
  await search.press('Enter')
  await pending
  await page.getByRole('button', { name: 'Tambah transaksi', exact: true }).click()
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).searchParams.has('exact'),
  )
  release()
  await response
  await expect(page.getByLabel('Jumlah Barang 125', { exact: true })).toHaveCount(0)
  await search.fill(api.products[124].barcode)
  await search.press('Enter')
  await expect(page.getByLabel('Jumlah Barang 125', { exact: true })).toHaveValue('1')
})

test('halaman lanjutan gagal mempertahankan produk dan posisi scroll, lalu bisa retry', async ({
  page,
}) => {
  await catalogAPI(page, false, true)
  const space = page.locator('.sale-virtual-space'),
    scroller = page.locator('.sale-virtual-catalog')
  await expect(space).toHaveAttribute('data-loaded-count', '50')
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(page.locator('.sale-catalog').getByRole('alert')).toContainText('Gangguan sementara')
  await expect(space).toHaveAttribute('data-loaded-count', '50')
  const top = await scroller.evaluate((node) => node.scrollTop)
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await expect(space).toHaveAttribute('data-loaded-count', '100')
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(top - 2)
})

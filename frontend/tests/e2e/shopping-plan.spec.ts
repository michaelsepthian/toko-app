import { test, expect, type Page } from '@playwright/test'
import { jakartaDay } from '../../lib/history-date'
import { shiftShoppingMonth } from '../../lib/shopping-plan'
import type { ShoppingItem } from '../../lib/types'
import { catalogFixture } from './catalog-fixture'

async function setup(page: Page, role = 'PEMILIK', failSaveOnce = false) {
  const date = jakartaDay()
  const user = { id: 1, nama: 'Pengguna Belanja', username: 'belanja', peran: role }
  const token = 'test.jwt.signature'
  const products = [
    {
      id: 1,
      nama: 'Gula Pasir',
      sku: 'GULA',
      barcode: null,
      harga_jual: '15000',
      stok_minimum: '1',
      kategori_id: 1,
      satuan_id: 1,
      aktif: true,
      is_favorit: false,
    },
  ]
  const sources = [
    { id: 1, nama: 'Toko Makmur', aktif: true },
    { id: 2, nama: 'Toko Sejahtera', aktif: true },
  ]
  let items: ShoppingItem[] = [
    {
      id: 1,
      tanggal: date,
      sumber_pembelian_id: 1,
      produk_id: 1,
      nama_barang: 'Gula Pasir',
      jumlah: '5',
      satuan: 'kg',
      catatan: '',
      dibeli_at: null,
      dibeli_by: null,
    },
    {
      id: 2,
      tanggal: date,
      sumber_pembelian_id: null,
      produk_id: null,
      nama_barang: 'Minyak goreng',
      jumlah: null,
      satuan: 'dus',
      catatan: 'Merek biasa',
      dibeli_at: null,
      dibeli_by: null,
    },
  ]
  let nextID = 3
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let dropped = false
  const cors = {
    'access-control-allow-origin': 'http://127.0.0.1:3007',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  }
  await page.route('http://api.test/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', '')
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    let result: unknown = []
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 401,
        headers: cors,
        json: { error: { code: 'SESSION_INVALID', message: 'Sesi berakhir' } },
      })
      return
    }
    if (path === '/setup') result = { initialized: true, registration_open: false }
    else if (path === '/auth/login')
      result = {
        user,
        access_token: token,
        expires_at: new Date(Date.now() + 1800000).toISOString(),
        session_expires_at: new Date(Date.now() + 17 * 3600000).toISOString(),
      }
    else if (path === '/me') result = user
    else if (path === '/master-data')
      result = {
        version: '1',
        categories: [{ id: 1, nama: 'Sembako' }],
        units: [{ id: 1, nama: 'kg' }],
        payments: [],
        sources: [],
      }
    else if (path === '/katalog/produk') result = catalogFixture(products, url.searchParams)
    else if (/^\/produk\/\d+$/.test(path))
      result = products.find((product) => product.id === Number(path.split('/')[2]))
    else if (path === '/master-data/version') result = { version: '1' }
    else if (request.method() !== 'GET') {
      const body = request.postDataJSON() ?? {}
      calls.push({ path, body })
      if (path === '/rencana-belanja') {
        if (failSaveOnce && !dropped) {
          dropped = true
          await route.abort('failed')
          return
        }
        const created = body.items.map(
          (row: {
            produk_id: number | null
            nama_barang: string
            jumlah: string | null
            satuan: string
            catatan: string
          }) => ({
            id: nextID++,
            ...row,
            nama_barang: row.produk_id ? 'Gula Pasir' : row.nama_barang,
            satuan: row.produk_id ? 'kg' : row.satuan,
            tanggal: body.tanggal,
            sumber_pembelian_id: body.sumber_pembelian_id,
            dibeli_at: null,
            dibeli_by: null,
          }),
        )
        items.push(...created)
        result = created
      } else if (path.endsWith('/checklist')) {
        const item = items.find((item) => item.id === Number(path.split('/')[2]))!
        item.dibeli_at = body.dibeli ? new Date().toISOString() : null
        item.dibeli_by = body.dibeli ? user.id : null
        result = item
      } else if (path === '/rencana-belanja/pindah') {
        for (const item of items.filter((item) => body.ids.includes(item.id))) {
          item.sumber_pembelian_id = body.sumber_pembelian_id
          item.tanggal = body.tanggal
        }
        result = { moved: true }
      } else if (path.endsWith('/hapus')) {
        items = items.filter((item) => item.id !== Number(path.split('/')[2]))
        result = { deleted: true }
      } else if (path.startsWith('/rencana-belanja/')) {
        const item = items.find((item) => item.id === Number(path.split('/')[2]))!
        Object.assign(item, body)
        result = item
      }
    } else if (path === '/rencana-belanja/sumber') result = sources
    else if (path === '/rencana-belanja')
      result = items
        .filter((item) => item.tanggal === url.searchParams.get('tanggal'))
        .slice(
          Number(url.searchParams.get('offset') ?? 0),
          Number(url.searchParams.get('offset') ?? 0) + 100,
        )
    else if (path === '/rencana-belanja/kalender') {
      result = [
        ...new Set(
          items
            .filter((item) => item.tanggal.startsWith(url.searchParams.get('bulan')!))
            .map((item) => item.tanggal),
        ),
      ].map((tanggal) => ({
        tanggal,
        total_item: items.filter((item) => item.tanggal === tanggal).length,
        sudah_dibeli: items.filter((item) => item.tanggal === tanggal && item.dibeli_at).length,
      }))
    }
    await route.fulfill({ json: { data: result }, headers: cors })
  })
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('belanja')
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Rencana Belanja', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).toBeVisible()
  return { calls, date }
}

async function select(page: Page, label: string, value: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}

test('kalender bulanan, bulk produk/lainnya, jumlah opsional dan checklist tanpa transaksi', async ({
  page,
}) => {
  const { calls } = await setup(page)
  await expect(page.locator('.shopping-calendar-day')).toHaveCount(42)
  await expect(
    page
      .locator('.shopping-item')
      .filter({ hasText: 'Minyak goreng' })
      .locator('.shopping-item-quantity'),
  ).toHaveCount(0)
  await expect(page.locator('.shopping-item').filter({ hasText: 'Gula Pasir' })).toContainText(
    '5 kg',
  )
  await page.getByRole('button', { name: 'Tambah belanjaan', exact: true }).click()
  await select(page, 'Tempat beli rencana', 'Toko Makmur')
  await select(page, 'Barang baris 1', 'Gula Pasir')
  await page.getByRole('button', { name: 'Tambah baris', exact: true }).click()
  await select(page, 'Barang baris 2', 'Lainnya — tulis barang baru')
  await page.getByLabel('Nama barang lainnya baris 2').fill('Kantong kemasan')
  await page.getByLabel('Jumlah baris 2', { exact: true }).fill('2,5')
  await page.getByLabel('Satuan baris 2', { exact: true }).fill('pak')
  await page.getByRole('button', { name: 'Simpan 2 barang', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('2 barang ditambahkan')
  const save = calls.find((call) => call.path === '/rencana-belanja')!
  expect(save.body.sumber_pembelian_id).toBe(1)
  expect(save.body.items).toEqual([
    { produk_id: 1, nama_barang: '', jumlah: null, satuan: '', catatan: '' },
    { produk_id: null, nama_barang: 'Kantong kemasan', jumlah: '2.5', satuan: 'pak', catatan: '' },
  ])
  await page.getByRole('checkbox', { name: 'Sudah dibeli: Kantong kemasan' }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Kantong kemasan' })).toBeChecked()
  expect(calls.some((call) => /pembelian|mutasi/.test(call.path))).toBe(false)
  await page.screenshot({ path: 'test-results/shopping-plan-desktop.png', fullPage: true })
})

test('pemilik bisa pindah massal, ubah tanggal dan mempertahankan checklist', async ({ page }) => {
  const { calls, date } = await setup(page)
  await page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).toBeChecked()
  await page.getByRole('button', { name: 'Pilih barang', exact: true }).click()
  await page.getByLabel('Pilih Gula Pasir untuk dipindahkan').check()
  await page.getByLabel('Pilih Minyak goreng untuk dipindahkan').check()
  await page.getByRole('button', { name: 'Pindahkan', exact: true }).click()
  await select(page, 'Tempat beli tujuan', 'Toko Sejahtera')
  await page.getByRole('button', { name: 'Pindahkan barang', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Toko Sejahtera' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).toBeChecked()
  expect(calls.find((call) => call.path === '/rencana-belanja/pindah')!.body).toEqual({
    ids: [1, 2],
    sumber_pembelian_id: 2,
    tanggal: date,
  })
  await page.getByLabel('Aksi Gula Pasir', { exact: true }).click()
  await page.getByRole('button', { name: 'Pindahkan', exact: true }).click()
  await select(page, 'Tempat beli tujuan', 'Belum ditentukan')
  const nextMonth = shiftShoppingMonth(date.slice(0, 7), 1)
  await page.getByLabel('Tanggal belanja tujuan').fill(nextMonth)
  await page.getByRole('button', { name: 'Pindahkan barang', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Bulan berikutnya' }).click()
  await expect(page.getByRole('heading', { name: 'Belum ditentukan', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).toBeChecked()
})

test('kasir bisa menambah dan checklist tetapi tidak memiliki aksi pemindahan', async ({
  page,
}) => {
  await setup(page, 'KASIR')
  await expect(page.getByRole('button', { name: 'Pilih barang', exact: true })).toHaveCount(0)
  await expect(page.locator('.shopping-item-menu')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Sudah dibeli: Minyak goreng' }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Minyak goreng' })).toBeChecked()
  await page.getByRole('button', { name: 'Tambah belanjaan', exact: true }).click()
  await select(page, 'Tempat beli rencana', 'Toko Makmur')
  await select(page, 'Barang baris 1', 'Lainnya — tulis barang baru')
  await page.getByLabel('Nama barang lainnya baris 1').fill('Sabun cuci')
  await page.getByRole('button', { name: 'Simpan 1 barang', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Sabun cuci' })).toBeVisible()
})

test('retry simpan mempertahankan identitas dan isian tidak hilang saat tutup panel dibatalkan', async ({
  page,
}) => {
  const { calls } = await setup(page, 'PEMILIK', true)
  await page.getByRole('button', { name: 'Tambah belanjaan', exact: true }).click()
  await select(page, 'Barang baris 1', 'Lainnya — tulis barang baru')
  await page.getByLabel('Nama barang lainnya baris 1').fill('Barang retry')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Tutup Tambah belanjaan', exact: true }).click()
  await expect(page.getByLabel('Nama barang lainnya baris 1')).toHaveValue('Barang retry')
  await page.getByRole('button', { name: 'Simpan 1 barang', exact: true }).click()
  await expect(page.locator('.shopping-plan-page').getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Simpan 1 barang', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Barang retry' })).toBeVisible()
  const saves = calls.filter((call) => call.path === '/rencana-belanja')
  expect(saves).toHaveLength(2)
  expect(saves[0].body).toEqual(saves[1].body)
})

test('mobile: kalender penuh, form kartu dan panel pemindahan tanpa overflow horizontal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await setup(page)
  await expect(page.locator('.shopping-calendar-day')).toHaveCount(42)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/shopping-plan-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Tambah belanjaan', exact: true }).click()
  await select(page, 'Barang baris 1', 'Lainnya — tulis barang baru')
  await page.getByLabel('Nama barang lainnya baris 1').fill('Barang mobile')
  await expect(page.getByLabel('Jumlah baris 1', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/shopping-plan-mobile-form.png', fullPage: true })
  await page.getByRole('button', { name: 'Simpan 1 barang', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Barang mobile' })).toBeVisible()
  await page.getByLabel('Aksi Barang mobile', { exact: true }).click()
  await page.getByRole('button', { name: 'Pindahkan', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect
    .poll(() =>
      page.getByRole('dialog').evaluate((node) => Math.round(node.getBoundingClientRect().bottom)),
    )
    .toBe(812)
  await page.screenshot({ path: 'test-results/shopping-plan-mobile-move.png', fullPage: true })
})

test('pemilik bisa mengosongkan jumlah, mengedit dan menghapus barang', async ({ page }) => {
  await setup(page)
  await page.getByLabel('Aksi Gula Pasir', { exact: true }).click()
  await page.getByRole('button', { name: 'Edit barang', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Jumlah baris 1', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Barang diperbarui')
  await expect(
    page
      .locator('.shopping-item')
      .filter({ hasText: 'Gula Pasir' })
      .locator('.shopping-item-quantity'),
  ).toHaveCount(0)
  await page.getByLabel('Aksi Minyak goreng', { exact: true }).click()
  await page.getByRole('button', { name: 'Hapus', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Minyak goreng')
  await page.getByRole('button', { name: 'Hapus barang', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Minyak goreng' })).toHaveCount(0)
})

test('jumlah nol ditolak dan kegagalan checklist mengembalikan status sebelumnya', async ({
  page,
}) => {
  const { calls } = await setup(page)
  await page.getByRole('button', { name: 'Tambah belanjaan', exact: true }).click()
  await select(page, 'Barang baris 1', 'Gula Pasir')
  await page.getByLabel('Jumlah baris 1', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Simpan 1 barang', exact: true }).click()
  await expect(page.locator('.shopping-plan-page').getByRole('alert')).toContainText('lebih dari 0')
  expect(calls.filter((call) => call.path === '/rencana-belanja')).toHaveLength(0)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Tutup Tambah belanjaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.route('http://api.test/api/v1/rencana-belanja/1/checklist', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 500,
      headers: {
        'access-control-allow-origin': 'http://127.0.0.1:3007',
        'access-control-allow-credentials': 'true',
      },
      json: { error: { message: 'Gagal menyimpan checklist' } },
    })
  })
  await page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' }).click()
  await expect(page.locator('.shopping-plan-page').getByRole('alert')).toContainText(
    'Gagal menyimpan checklist',
  )
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).not.toBeChecked()
})

test('klik isi baris mengikuti mode checklist atau seleksi tanpa mengeksekusi dua kali', async ({
  page,
}) => {
  const { calls } = await setup(page)
  await page
    .getByRole('button', { name: 'Checklist Gula Pasir', exact: true })
    .getByText('Gula Pasir', { exact: true })
    .click()
  await expect(page.getByRole('checkbox', { name: 'Sudah dibeli: Gula Pasir' })).toBeChecked()
  await expect.poll(() => calls.filter((call) => call.path.endsWith('/checklist')).length).toBe(1)
  await page.getByRole('button', { name: 'Pilih barang', exact: true }).click()
  await page
    .getByRole('button', { name: 'Pilih Minyak goreng', exact: true })
    .getByText('Minyak goreng', { exact: true })
    .click()
  await expect(page.getByLabel('Pilih Minyak goreng untuk dipindahkan')).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'Sudah dibeli: Minyak goreng' }),
  ).not.toBeChecked()
  expect(calls.filter((call) => call.path.endsWith('/checklist'))).toHaveLength(1)
  await page.getByLabel('Aksi Minyak goreng', { exact: true }).click()
  await expect(page.locator('.shopping-item-menu[open]')).toHaveCount(1)
  await page.getByRole('heading', { name: 'Daftar belanja', exact: true }).click()
  await expect(page.locator('.shopping-item-menu[open]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pilih Minyak goreng', exact: true }).click()
  await expect(page.getByLabel('Pilih Minyak goreng untuk dipindahkan')).not.toBeChecked()
})

for (const width of [390, 1440]) {
  test(`checklist loading hanya per item, daftar stabil dan tanpa refetch ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const reads: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.url().includes('/rencana-belanja'))
        reads.push(request.url())
    })
    await setup(page)
    await expect(page.locator('.shopping-calendar')).toHaveAttribute('aria-busy', 'false')
    const initialReads = reads.length
    const first = page.locator('.shopping-item').filter({ hasText: 'Gula Pasir' })
    const second = page.locator('.shopping-item').filter({ hasText: 'Minyak goreng' })
    await first.evaluate((node) => node.setAttribute('data-continuity', 'original'))
    const top = await first.evaluate((node) => node.getBoundingClientRect().top + scrollY)
    let releaseFirst = () => {},
      releaseSecond = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let writes = 0
    await page.route('http://api.test/api/v1/rencana-belanja/*/checklist', async (route) => {
      if (route.request().method() === 'PUT') {
        writes++
        await (route.request().url().includes('/1/checklist') ? firstGate : secondGate)
      }
      await route.fallback()
    })
    try {
      await first.getByRole('button', { name: 'Checklist Gula Pasir', exact: true }).click()
      await expect(first.getByRole('status', { name: 'Menyimpan Gula Pasir' })).toBeVisible()
      await expect(first).toHaveAttribute('aria-busy', 'true')
      await expect(
        second.getByRole('button', { name: 'Checklist Minyak goreng', exact: true }),
      ).toBeEnabled()
      await expect(page.locator('.shopping-list-section')).toHaveAttribute('aria-busy', 'false')
      await expect(page.locator('.shopping-calendar')).toHaveAttribute('aria-busy', 'false')
      await expect(page.getByText('Memperbarui belanjaan…', { exact: true })).toHaveCount(0)
      await first.evaluate((node) => (node as HTMLElement).click())
      expect(writes).toBe(1)
      await second.getByRole('button', { name: 'Checklist Minyak goreng', exact: true }).click()
      await expect(second.getByRole('status', { name: 'Menyimpan Minyak goreng' })).toBeVisible()
      releaseSecond()
      await expect(second.getByRole('checkbox')).toBeChecked()
      await expect(first.getByRole('status', { name: 'Menyimpan Gula Pasir' })).toBeVisible()
      releaseFirst()
      await expect(first.getByRole('checkbox')).toBeChecked()
      await expect(first).toHaveAttribute('aria-busy', 'false')
      await expect(first).toHaveAttribute('data-continuity', 'original')
      await expect
        .poll(() => first.evaluate((node) => node.getBoundingClientRect().top + scrollY))
        .toBe(top)
      await expect(page.locator('.shopping-calendar-day[data-selected="true"]')).toHaveAttribute(
        'aria-label',
        /2 dari 2 barang dibeli/,
      )
      expect(writes).toBe(2)
      expect(reads).toHaveLength(initialReads)
    } finally {
      releaseFirst()
      releaseSecond()
    }
  })
}

test('filter belum dibeli tidak menghilangkan item saat request berjalan atau gagal', async ({
  page,
}) => {
  await setup(page)
  await page.getByRole('button', { name: /^Belum dibeli/ }).click()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('http://api.test/api/v1/rencana-belanja/1/checklist', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fallback()
      return
    }
    await gate
    await route.fulfill({
      status: 500,
      headers: {
        'access-control-allow-origin': 'http://127.0.0.1:3007',
        'access-control-allow-credentials': 'true',
      },
      json: { error: { message: 'Checklist gagal disimpan' } },
    })
  })
  const row = page.locator('.shopping-item').filter({ hasText: 'Gula Pasir' })
  try {
    await row.getByRole('button', { name: 'Checklist Gula Pasir', exact: true }).click()
    await expect(row.getByRole('status', { name: 'Menyimpan Gula Pasir' })).toBeVisible()
    await expect(page.locator('.shopping-item')).toHaveCount(2)
    release()
    await expect(page.locator('.shopping-plan-page').getByRole('alert')).toContainText(
      'Checklist gagal disimpan',
    )
    await expect(row.getByRole('checkbox')).not.toBeChecked()
    await expect(row.getByRole('button')).toBeEnabled()
    await expect(row.getByRole('status')).toHaveCount(0)
    await page.clock.install()
    await page.clock.fastForward(6000)
    await expect(page.locator('.shopping-plan-page').getByRole('alert')).toContainText(
      'Checklist gagal disimpan',
    )
  } finally {
    release()
  }
})

test('notifikasi checklist otomatis hilang setelah 5 detik tanpa menggeser daftar', async ({
  page,
}) => {
  await setup(page)
  await page.clock.install({ time: new Date('2026-11-10T03:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-10T03:00:01Z'))
  const row = page.locator('.shopping-item').filter({ hasText: 'Gula Pasir' })
  const top = await row.evaluate((node) => node.getBoundingClientRect().top + scrollY)
  await row.getByRole('button', { name: 'Checklist Gula Pasir', exact: true }).click()
  const notice = page.locator('.shopping-plan-page .pos-toast')
  await expect(notice).toContainText('ditandai sudah dibeli')
  await page.clock.runFor(4999)
  await expect(notice).toBeVisible()
  await page.clock.runFor(1)
  await expect(notice).toHaveCount(0)
  expect(await row.evaluate((node) => node.getBoundingClientRect().top + scrollY)).toBe(top)
  await expect(row.getByRole('checkbox')).toBeChecked()
})

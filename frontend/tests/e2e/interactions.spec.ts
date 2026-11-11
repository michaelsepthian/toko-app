import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page) {
  const user = { id: 1, nama: 'Pemilik', username: 'pemilik', peran: 'PEMILIK' }
  const sources = [{ id: 1, nama: 'Toko Makmur', jenis: 'TOKO', aktif: true }]
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let release = () => {}
  let gate: Promise<void> | null = null
  let fail = false
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' }
  await page.route('http://api.test/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    let data: unknown = []
    if (path.startsWith('/sumber-pembelian') && request.method() !== 'GET') {
      const body = request.postDataJSON(); calls.push({ path, body })
      await gate
      if (fail) { fail = false; await route.fulfill({ status: 500, headers: cors, json: { error: { message: 'Gagal menyimpan, coba lagi.' } } }); return }
      if (request.method() === 'POST') sources.push({ id: sources.length + 1, ...body })
      else Object.assign(sources[0], body)
      data = sources.at(-1)
    } else if (path === '/setup') data = { initialized: true, registration_open: false }
    else if (path === '/auth/login') data = { user, access_token: 'toko_' + 'a'.repeat(64), expires_at: new Date(Date.now() + 3600000).toISOString() }
    else if (path === '/me') data = user
    else if (path === '/master-data') data = { version: String(calls.length + 1), categories: [], units: [], payments: [], sources }
    else if (path === '/katalog/produk') data = { items: [], has_next: false, next_cursor: null, version: String(calls.length + 1) }
    else if (path === '/master-data/version') data = { version: String(calls.length + 1) }
    await route.fulfill({ headers: cors, json: { data } })
  })
  await page.goto('/?toko=1#source-editor')
  await page.getByLabel('Username', { exact: true }).fill('pemilik')
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByLabel('Menu lainnya', { exact: true }).click()
  await page.getByRole('button', { name: 'Data Master', exact: true }).click()
  await page.getByRole('button', { name: 'Tempat Beli / Sales', exact: true }).click()
  return { calls, hold: () => { gate = new Promise<void>(resolve => { release = resolve }); return () => release() }, failNext: () => { fail = true } }
}

for (const width of [390, 1440]) {
  test(`panel sumber responsif, URL bersih, dropdown dan loading ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const api = await setup(page)
    await expect(page).toHaveURL(/\?toko=1$/)
    await page.getByRole('button', { name: 'Edit Toko Makmur', exact: true }).getByText('Toko Makmur', { exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Edit Tempat Beli / Sales', exact: true })
    await expect(panel).toBeVisible()
    await expect.poll(() => panel.evaluate(node => Math.round(node.getBoundingClientRect().bottom))).toBeLessThanOrEqual(844)
    if (width < 768) {
      await expect.poll(() => panel.evaluate(node => Math.round(node.getBoundingClientRect().bottom))).toBe(844)
      expect((await panel.boundingBox())!.x).toBe(0)
      expect(await panel.evaluate(node => getComputedStyle(node).animationName)).toBe('ui-sheet-in')
    } else {
      expect((await panel.boundingBox())!.width).toBeLessThan(800)
      expect(await panel.evaluate(node => getComputedStyle(node).animationName)).toBe('ui-modal-in')
    }
    const trigger = panel.getByRole('button', { name: 'Jenis', exact: true })
    await trigger.click()
    await expect(panel.getByRole('listbox')).toBeVisible()
    await panel.getByRole('heading').click()
    await expect(panel.getByRole('listbox')).toHaveCount(0)
    await expect(trigger).not.toBeFocused()
    await trigger.click()
    await panel.getByRole('option', { name: 'Sales datang ke toko', exact: true }).click()
    await expect(trigger).not.toBeFocused()
    await panel.getByLabel('Nama tempat beli / sales', { exact: true }).fill('Sales Baru')
    const release = api.hold()
    try {
      await panel.getByRole('button', { name: 'Simpan Sumber Pembelian', exact: true }).click()
      const saving = panel.getByRole('button', { name: 'Menyimpan…', exact: true })
      await expect(saving).toBeDisabled()
      await expect(saving).toHaveAttribute('aria-busy', 'true')
      await expect(saving.locator('.ui-spinner')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(panel).toBeVisible()
      expect(api.calls).toHaveLength(1)
    } finally { release() }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('tersimpan')
    await expect(page.getByRole('button', { name: 'Edit Sales Baru', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Tambah Tempat Beli / Sales', exact: true }).click()
    await expect(page.getByLabel('Nama tempat beli / sales', { exact: true })).toHaveValue('')
    await page.mouse.click(4, 4)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const add = page.getByRole('button', { name: 'Tambah Tempat Beli / Sales', exact: true })
    await expect(add).toBeFocused()
    await page.getByRole('heading', { name: 'Daftar Tempat Beli / Sales', exact: true }).click()
    await expect(add).not.toBeFocused()
    await expect(page).toHaveURL(/\?toko=1$/)
  })
}

test('panel mempertahankan isian saat error dan konfirmasi tutup, mendukung reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const api = await setup(page)
  await page.getByRole('button', { name: 'Tambah Tempat Beli / Sales', exact: true }).click()
  const panel = page.getByRole('dialog')
  expect(await panel.evaluate(node => getComputedStyle(node).animationName)).toBe('none')
  await panel.getByLabel('Nama tempat beli / sales', { exact: true }).fill('Draft Supplier')
  api.failNext()
  await panel.getByRole('button', { name: 'Simpan Sumber Pembelian', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Gagal menyimpan')
  await expect(panel.getByLabel('Nama tempat beli / sales', { exact: true })).toHaveValue('Draft Supplier')
  page.once('dialog', dialog => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

for (const width of [390, 1440]) {
  test(`pengaturan perangkat diedit melalui panel dan tersimpan lokal ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await setup(page)
    await page.getByLabel('Menu lainnya', { exact: true }).click()
    await page.getByRole('button', { name: 'Perangkat', exact: true }).click()
    await page.getByRole('button', { name: 'Edit identitas struk', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Edit identitas struk', exact: true })
    await panel.getByLabel('Nama toko', { exact: true }).fill('Toko Baru')
    await panel.getByRole('button', { name: 'Simpan pengaturan', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Toko Baru', exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('toko:devices')!).storeName)).toBe('Toko Baru')
    await page.getByRole('button', { name: 'Edit perangkat', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Cara cetak', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}

test('notifikasi yang sama memulai ulang durasi 5 detik dari pemberitahuan terbaru', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setup(page)
  await page.getByLabel('Menu lainnya', { exact: true }).click()
  await page.getByRole('button', { name: 'Perangkat', exact: true }).click()
  await page.clock.install({ time: new Date('2026-11-10T03:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-10T03:00:01Z'))
  await page.getByRole('button', { name: 'Edit perangkat', exact: true }).click()
  await page.getByRole('button', { name: 'Simpan pengaturan', exact: true }).click()
  await page.clock.runFor(0)
  const notice = page.getByRole('status').filter({ hasText: 'Pengaturan perangkat tersimpan.' })
  await expect(notice).toBeVisible()
  await page.clock.runFor(4000)
  await page.getByRole('button', { name: 'Edit perangkat', exact: true }).click()
  await page.getByRole('button', { name: 'Simpan pengaturan', exact: true }).click()
  await page.clock.runFor(0)
  await page.clock.runFor(4999)
  await expect(notice).toBeVisible()
  await page.clock.runFor(1)
  await expect(notice).toHaveCount(0)
})

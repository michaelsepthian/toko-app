import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page, role = 'PEMILIK') {
  const calls: Record<string, unknown>[] = []
  const user = { id: 1, nama: 'Pemilik Toko', username: 'pemilik', peran: role, aktif: true }
  const users = [user]
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
  await page.route('http://api.test/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    if (path === '/pengguna' && request.method() === 'POST') {
      const body = request.postDataJSON(); calls.push(body)
      if (users.some(user => user.username === body.username)) { await route.fulfill({ status: 409, headers: cors, json: { error: { message: 'Username sudah digunakan' } } }); return }
      const created = { id: users.length + 1, nama: body.nama, username: body.username, peran: body.peran, aktif: true }
      users.push(created)
      await route.fulfill({ status: 201, headers: cors, json: { data: created } }); return
    }
    const data = path === '/setup' ? { initialized: true, registration_open: false }
      : path === '/auth/login' ? { user, access_token: 'toko_' + 'a'.repeat(64), expires_at: new Date(Date.now() + 3600000).toISOString() }
      : path === '/me' ? user
      : path === '/master-data' ? { version: '1', products: [], categories: [], units: [], payments: [], sources: [] }
      : path === '/master-data/version' ? { version: '1' }
      : path === '/pengguna' ? users : []
    await route.fulfill({ headers: cors, json: { data } })
  })
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('pemilik')
  await page.getByLabel('Password', { exact: true }).fill('password-test')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.locator('.pos-more > summary').click()
  return calls
}

for (const mobile of [false, true]) {
  test(`pengguna: create roles, validation, themes ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const calls = await setup(page)
    await page.getByRole('button', { name: 'Data Master', exact: true }).click()
    await page.getByRole('button', { name: 'Pengguna', exact: true }).click()
    await expect(page.getByText('@pemilik', { exact: true })).toBeVisible()
    if (mobile) await page.getByRole('link', { name: 'Tambah Pengguna', exact: true }).click()
    await expect(page.getByLabel('Role', { exact: true })).toHaveValue('KASIR')
    await page.getByLabel('Nama pengguna', { exact: true }).fill('Rina Kasir')
    await page.getByLabel('Username', { exact: true }).fill('rina.kasir')
    await page.getByLabel('Password', { exact: true }).fill('password-test')
    await page.getByLabel('Konfirmasi password', { exact: true }).fill('different')
    await page.getByRole('button', { name: 'Simpan Pengguna', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Konfirmasi password' })).toBeVisible()
    expect(calls).toHaveLength(0)
    await page.getByLabel('Konfirmasi password', { exact: true }).fill('password-test')
    await page.getByRole('button', { name: 'Simpan Pengguna', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('berhasil ditambahkan')
    expect(calls[0]).toEqual({ nama: 'Rina Kasir', username: 'rina.kasir', password: 'password-test', peran: 'KASIR' })
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
    await page.getByLabel('Nama pengguna', { exact: true }).fill('Dewi Pemilik')
    await page.getByLabel('Username', { exact: true }).fill('pemilik')
    await page.getByLabel('Password', { exact: true }).fill('password-test')
    await page.getByLabel('Konfirmasi password', { exact: true }).fill('password-test')
    await page.getByLabel('Role', { exact: true }).selectOption('PEMILIK')
    await page.getByRole('button', { name: 'Simpan Pengguna', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Username sudah digunakan' })).toBeVisible()
    await expect(page.getByLabel('Nama pengguna', { exact: true })).toHaveValue('Dewi Pemilik')
    await page.getByLabel('Username', { exact: true }).fill('dewi.pemilik')
    await page.getByRole('button', { name: 'Simpan Pengguna', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Dewi Pemilik')
    expect(calls[2].peran).toBe('PEMILIK')
    await page.getByLabel('Cari pengguna', { exact: true }).fill('rina')
    await expect(page.getByText('@rina.kasir', { exact: true })).toBeVisible()
    await expect(page.getByText('@dewi.pemilik', { exact: true })).toHaveCount(0)
    await page.getByLabel('Cari pengguna', { exact: true }).fill('')
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); localStorage.setItem('toko:theme', theme) }, theme)
      await page.getByRole('heading', { name: 'Daftar Pengguna', exact: true }).scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/users-${mobile ? 'mobile' : 'desktop'}-${theme}.png`, fullPage: true })
    }
  })
}

test('kasir tidak melihat menu data master', async ({ page }) => {
  await setup(page, 'KASIR')
  await expect(page.getByRole('button', { name: 'Data Master', exact: true })).toHaveCount(0)
})

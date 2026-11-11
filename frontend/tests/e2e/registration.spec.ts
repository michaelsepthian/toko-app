import { test, expect, type Page } from '@playwright/test'

async function authAPI(page: Page, initialized = false) {
  const calls: { path: string; body: unknown }[] = []
  const token = 'toko_' + 'b'.repeat(64)
  const user = { id: 1, nama: 'pemilik', username: 'pemilik', peran: 'PEMILIK' }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
  await page.route('http://api.test/api/v1/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace('/api/v1','')
    if (req.method() === 'OPTIONS') { await route.fulfill({ status:204, headers:cors }); return }
    if (path === '/setup') { await route.fulfill({ headers:cors, json:{ data:{ initialized, registration_open:!initialized } } }); return }
    if (path === '/auth/register' || path === '/auth/login') {
      const body = req.postDataJSON(); calls.push({ path, body })
      if (body.password !== 'password-test') { await route.fulfill({ status:path === '/auth/register' ? 400 : 401, headers:cors, json:{ error:{ message:path === '/auth/register' ? 'Password minimal 8 karakter' : 'Username atau password salah' } } }); return }
      initialized = true
      await route.fulfill({ headers:cors, json:{ data:{ user, access_token:token, expires_at:new Date(Date.now()+3600000).toISOString() } } }); return
    }
    if (req.headers().authorization !== `Bearer ${token}`) { await route.fulfill({ status:401, headers:cors, json:{ error:{ message:'Token diperlukan' } } }); return }
    await route.fulfill({ headers:cors, json:{ data:path === '/me' ? user : path === '/master-data' ? { version:'1',categories:[],units:[],payments:[],sources:[] } : path === '/master-data/version' ? { version:'1' } : path === '/katalog/produk' ? { items:[],has_next:false,next_cursor:null,version:'1' } : [] } })
  })
  await page.goto('/')
  return calls
}

test('registrasi hanya username password dan langsung masuk',async ({ page }) => {
  const calls = await authAPI(page)
  await expect(page.getByRole('heading',{ name:'Registrasi',exact:true })).toBeVisible()
  await expect(page.getByLabel('Email',{ exact:true })).toHaveCount(0)
  await expect(page.getByLabel('Nama pemilik')).toHaveCount(0)
  await expect(page.getByLabel('Kode setup awal')).toHaveCount(0)
  await page.getByLabel('Username',{ exact:true }).fill('pemilik')
  await page.getByLabel('Password',{ exact:true }).fill('password-test')
  await page.getByRole('button',{ name:'Daftar & Masuk' }).click()
  await expect(page.getByRole('navigation',{ name:'Menu utama' })).toBeVisible()
  expect(calls).toEqual([{ path:'/auth/register',body:{ username:'pemilik',password:'password-test' } }])
  await page.reload()
  await expect(page.getByRole('navigation',{ name:'Menu utama' })).toBeVisible()
})

test('login salah ditolak dan akun yang sudah ada cukup masuk',async ({ page }) => {
  const calls = await authAPI(page,true)
  await expect(page.getByRole('heading',{ name:'Masuk',exact:true })).toBeVisible()
  await expect(page.getByRole('button',{ name:'Registrasi',exact:true })).toHaveCount(0)
  await page.getByLabel('Username',{ exact:true }).fill('pemilik')
  await page.getByLabel('Password',{ exact:true }).fill('wrong-password')
  await page.getByRole('button',{ name:'Masuk',exact:true }).click()
  await expect(page.getByRole('alert').filter({ hasText:'Username atau password salah' })).toBeVisible()
  await page.getByLabel('Password',{ exact:true }).fill('password-test')
  await page.getByRole('button',{ name:'Masuk',exact:true }).click()
  await expect(page.getByRole('navigation',{ name:'Menu utama' })).toBeVisible()
  expect(calls[1].body).toEqual({ username:'pemilik',password:'password-test' })
})

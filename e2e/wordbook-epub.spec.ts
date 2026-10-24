import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!

// 同 full-flow：beforeEach 会硬删除测试账号的整个单词本
if (process.env.E2E_DESTRUCTIVE_OK !== '1') {
  throw new Error(`e2e 会清空账号 ${EMAIL} 的整个单词本。确认是测试账号后设 E2E_DESTRUCTIVE_OK=1。`)
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('邮箱').fill(EMAIL)
  await page.getByPlaceholder('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function clearWordbook(page: Page) {
  const res = await page.request.get('/api/wordbook')
  for (const e of ((await res.json()) as { entries: { id: string }[] }).entries) {
    await page.request.delete(`/api/wordbook/${e.id}`)
  }
}

test('未登录不能导出', async ({ request }) => {
  const res = await request.get('/api/wordbook/epub')
  expect(res.status()).toBe(401)
})

test('单词本页点「导出 EPUB」下载按加入顺序排列的书', async ({ page }) => {
  await login(page)
  await clearWordbook(page)
  for (const [word, sourceContext] of [
    ['apple', 'An apple a day.'],
    ['rabbit', null],
  ] as const) {
    await page.request.post('/api/wordbook', { data: { word, sourceContext } })
  }

  await page.goto('/wordbook')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '导出 EPUB' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^生词本-\d{4}-\d{2}-\d{2}\.epub$/)

  const buf = new Uint8Array(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c)))
  const text = new TextDecoder().decode(buf)
  expect(text.slice(30, 58)).toBe('mimetypeapplication/epub+zip')
  // STORED 不压缩，正文就是明文：apple 先加入，排在 rabbit 前面
  const apple = text.indexOf('<span class="w">apple</span>')
  const rabbit = text.indexOf('<span class="w">rabbit</span>')
  expect(apple).toBeGreaterThan(0)
  expect(rabbit).toBeGreaterThan(apple)
  expect(text).not.toContain('An apple a day.') // 例句不进书
  expect(text).not.toContain('ɹ')
})

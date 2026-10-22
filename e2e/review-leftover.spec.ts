import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!

// 同 full-flow：beforeEach 会硬删除测试账号的整个单词本（名单跟着级联删除）
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

async function entries(page: Page) {
  const res = await page.request.get('/api/wordbook')
  return ((await res.json()) as { entries: { id: string; word: string; reviewCount: number; familiarity: number }[] }).entries
}

async function clearWordbook(page: Page) {
  for (const e of await entries(page)) await page.request.delete(`/api/wordbook/${e.id}`)
}

async function addWords(page: Page, words: string[]) {
  for (const word of words) await page.request.post('/api/wordbook', { data: { word } })
}

/** 开一轮常规复习：顺序、纯英译中（强制规则还是可能出中译英，answer 两种都会答） */
async function startRegular(page: Page) {
  await page.goto('/review')
  await page.getByRole('radio', { name: '顺序' }).click()
  await page.getByLabel('题型比例').fill('0')
  await page.getByRole('button', { name: '开始', exact: true }).click()
}

/** 答当前这张卡，两种题型都能答 */
async function answer(page: Page, known: boolean) {
  const input = page.getByLabel('输入英文单词')
  const flip = page.getByText('点击或按空格翻面')
  await expect(input.or(flip)).toBeVisible()
  if (await input.isVisible()) {
    await page.getByRole('button', { name: /^不认识/ }).click()
    if (known) await page.getByRole('button', { name: /^认识/ }).click()
    await page.getByRole('button', { name: /下一个/ }).click()
  } else {
    await flip.click()
    await page.getByRole('button', { name: known ? /^认识/ : /^不认识/ }).click()
  }
}

function leftoverSaved(page: Page) {
  return page.waitForResponse(
    (r) => r.url().includes('/api/review/leftover') && r.request().method() === 'PUT',
  )
}

test.beforeEach(async ({ page }) => {
  await login(page)
  await clearWordbook(page)
})

test('名单接口：空名单拒绝，只收自己的词', async ({ page }) => {
  await addWords(page, ['alpha', 'beta'])
  const [a, b] = await entries(page)

  expect((await page.request.put('/api/review/leftover', { data: { ids: [] } })).status()).toBe(400)
  expect((await page.request.put('/api/review/leftover', { data: { ids: ['nope'] } })).status()).toBe(400)

  // 不属于自己的 id（这里是随便编的）被数据库函数静默丢掉
  const foreign = '00000000-0000-4000-8000-000000000000'
  const res = await page.request.put('/api/review/leftover', { data: { ids: [a.id, foreign] } })
  expect(await res.json()).toEqual({ saved: 1 })

  await page.request.put('/api/review/leftover', { data: { ids: [a.id, b.id] } })
  const got = (await (await page.request.get('/api/review/leftover')).json()) as { ids: string[] }
  expect(got.ids.sort()).toEqual([a.id, b.id].sort())

  // 从单词本删词，名单跟着变短
  await page.request.delete(`/api/wordbook/${b.id}`)
  const after = (await (await page.request.get('/api/review/leftover')).json()) as { ids: string[] }
  expect(after.ids).toEqual([a.id])
})

test('上一轮生词只由常规复习覆盖，重练记住了也不减', async ({ page }) => {
  await addWords(page, ['alpha', 'beta', 'gamma'])

  // 常规复习：两个不认识
  await startRegular(page)
  await answer(page, false)
  await answer(page, false)
  let saved = leftoverSaved(page)
  await answer(page, true)
  await expect(page.getByText('共 3 个 · 认识 1 · 不认识 2')).toBeVisible()
  await saved

  // 只练生词，两个都记住了
  await page.getByRole('button', { name: '只练生词 2 个' }).click()
  await answer(page, true)
  await answer(page, true)
  await expect(page.getByText('本轮完成')).toBeVisible()

  // 刷新（等同第二天再打开）：名单还是完整的 2 个
  await page.goto('/review')
  await expect(page.getByRole('button', { name: '复习上一轮生词（2 个）' })).toBeVisible()

  // 复习上一轮生词：整批出完，也不覆盖名单
  await page.getByRole('button', { name: '复习上一轮生词（2 个）' }).click()
  await expect(page.getByText('上一轮生词 · 第 1 / 2 张 · 生词 0')).toBeVisible()
  await answer(page, false)
  await answer(page, false)
  await expect(page.getByText('共 2 个 · 认识 0 · 不认识 2')).toBeVisible()
  await page.goto('/review')
  await expect(page.getByRole('button', { name: '复习上一轮生词（2 个）' })).toBeVisible()

  // 零生词的常规复习不覆盖
  await startRegular(page)
  for (let i = 0; i < 3; i++) await answer(page, true)
  await expect(page.getByText('共 3 个 · 认识 3 · 不认识 0')).toBeVisible()
  await page.goto('/review')
  await expect(page.getByRole('button', { name: '复习上一轮生词（2 个）' })).toBeVisible()

  // 有生词的常规复习整批替换
  await startRegular(page)
  await answer(page, true)
  await answer(page, true)
  saved = leftoverSaved(page)
  await answer(page, false)
  await saved
  await page.goto('/review')
  await expect(page.getByRole('button', { name: '复习上一轮生词（1 个）' })).toBeVisible()
})

test('刷新后能接着背，也能结束并结算名单', async ({ page }) => {
  await addWords(page, ['alpha', 'beta', 'gamma'])
  await startRegular(page)
  await answer(page, false)
  await expect(page.getByText('第 2 张 · 生词 1 / 10')).toBeVisible()

  await page.reload()
  await expect(page.getByText(/上次有一轮没背完（第 2 \/ 3 张 · 生词 1 个）/)).toBeVisible()
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByText('第 2 张 · 生词 1 / 10')).toBeVisible()

  await page.reload()
  const saved = leftoverSaved(page)
  await page.getByRole('button', { name: '结束这一轮' }).click()
  await saved
  await expect(page.getByText(/上次有一轮没背完/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '复习上一轮生词（1 个）' })).toBeVisible()
})

test('登录过期时的判定先存本地，重新登录后补写', async ({ page, context }) => {
  await addWords(page, ['alpha', 'beta'])
  await startRegular(page)

  // 模拟会话过期
  await context.clearCookies()
  await answer(page, false)
  await expect(page.getByText(/1 条判定还没保存/)).toBeVisible()
  await expect(page.getByRole('link', { name: '重新登录' })).toBeVisible()

  await login(page)
  await page.goto('/review')
  await expect(page.getByText(/条判定还没保存/)).toHaveCount(0)
  await expect.poll(async () => (await entries(page)).some((e) => e.reviewCount === 1)).toBe(true)
  // 进行中的那一轮也还在
  await expect(page.getByText(/上次有一轮没背完/)).toBeVisible()
})

test('熟练度满 5 的词进入冷却，不进常规复习', async ({ page }) => {
  await addWords(page, ['alpha', 'beta'])
  const alpha = (await entries(page)).find((e) => e.word === 'alpha')!
  for (let i = 0; i < 5; i++) {
    await page.request.post('/api/review/mark', { data: { id: alpha.id, known: true, quizType: 'en2cn' } })
  }

  await page.goto('/review')
  await expect(page.getByText('1 个已掌握的词在冷却中，满 14 天后再出。')).toBeVisible()
  await startRegular(page)
  await expect(page.getByTestId('review-word').first()).toHaveText('beta')
  await answer(page, true)
  await expect(page.getByText('共 1 个 · 认识 1 · 不认识 0')).toBeVisible()
})

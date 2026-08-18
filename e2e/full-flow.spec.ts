import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!

const PARAGRAPH =
  'The committee deferred the decision pending further review of the ' +
  'unprecedented anomalies discovered in the quarterly reconciliation.'

/** 主页那个唯一的多行输入框（方向不同占位符也不同，用它统一定位） */
function mainInput(page: Page) {
  return page.getByPlaceholder(/输入/)
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('邮箱').fill(EMAIL)
  await page.getByPlaceholder('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  // 登录成功是整页跳转到 /，等主页输入框出现
  await expect(mainInput(page)).toBeVisible()
}

/** 清空测试账号的单词本，保证用例之间互不干扰 */
async function clearWordbook(page: Page) {
  const res = await page.request.get('/api/wordbook')
  const { entries } = (await res.json()) as { entries: { id: string }[] }
  for (const e of entries) {
    await page.request.delete(`/api/wordbook/${e.id}`)
  }
}

test.beforeEach(async ({ page }) => {
  await login(page)
  await clearWordbook(page)
})

test('未登录访问被拦截到登录页', async ({ browser }) => {
  const ctx = await browser.newContext()
  const fresh = await ctx.newPage()
  await fresh.goto('/wordbook')
  await expect(fresh).toHaveURL(/\/login/)
  await ctx.close()
})

test('单词查询显示词头与释义', async ({ page }) => {
  await mainInput(page).fill('apple')
  await page.getByRole('button', { name: '翻译' }).click()

  await expect(page.getByRole('heading', { name: 'apple' })).toBeVisible()
  // 释义有多条都含「苹果」，取第一条即可确认词典命中
  await expect(page.getByText('苹果', { exact: false }).first()).toBeVisible()
})

test('段落翻译产出译文与难词', async ({ page }) => {
  await mainInput(page).fill(PARAGRAPH)
  await page.getByRole('button', { name: '翻译' }).click()

  // 难词卡片走数据库，通常先于译文出现。unprecedented 在输入框、原文段、
  // 难词展开按钮、收藏按钮里都出现，用唯一的收藏按钮 aria-label 定位它。
  await expect(page.getByRole('heading', { name: '难词' })).toBeVisible()
  await expect(page.getByRole('button', { name: '收藏 unprecedented' })).toBeVisible()

  // 译文是流式的，等它攒出足够中文
  const translation = page.locator('section', { hasText: '译文' })
  await expect(translation).toContainText(/[一-龥]{8,}/, { timeout: 45_000 })
})

test('收藏后出现在单词本，可移除', async ({ page }) => {
  await mainInput(page).fill('serendipity')
  await page.getByRole('button', { name: '翻译' }).click()
  await expect(page.getByRole('heading', { name: 'serendipity' })).toBeVisible()

  await page.getByRole('button', { name: '收藏 serendipity' }).click()
  await expect(
    page.getByRole('button', { name: '从单词本移除 serendipity' }),
  ).toBeVisible()

  await page.getByRole('link', { name: '单词本' }).click()
  await page.waitForURL('**/wordbook')
  await expect(
    page.getByRole('listitem').filter({ hasText: 'serendipity' }),
  ).toBeVisible()

  await page.getByRole('button', { name: '移除 serendipity' }).click()
  await expect(page.getByText('单词本还是空的')).toBeVisible()
})

test('复习流程走完一轮并更新熟练度', async ({ page }) => {
  // 直接用接口铺数据，避免依赖 UI 收藏路径
  for (const word of ['alpha', 'beta', 'gamma']) {
    await page.request.post('/api/wordbook', {
      data: { word, sourceContext: `A sentence with ${word}.` },
    })
  }

  await page.goto('/review')
  await expect(page.getByText('共 3 个单词')).toBeVisible()

  await page.getByRole('radio', { name: '顺序' }).click()
  // 锁成纯英译中：这些测试词没有中文释义，混合比例下会被跳过
  await page.getByLabel('题型比例').fill('0')
  await page.getByRole('button', { name: '开始' }).click()

  for (let i = 1; i <= 3; i++) {
    await expect(page.getByText(`${i} / 3`)).toBeVisible()
    await page.getByText('点击或按空格翻面').click()
    // 「认识」按钮排在「不认识」之后，last() 取到它
    await page.getByRole('button', { name: /认识/ }).last().click()
  }

  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/认识 3/)).toBeVisible()

  await page.getByRole('link', { name: '回单词本' }).click()
  await expect(page.getByText(/熟练度 1\/5 · 复习 1 次/).first()).toBeVisible()
})

test('随机模式打乱顺序', async ({ page }) => {
  for (const w of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }

  async function firstCardWord(): Promise<string> {
    await page.goto('/review')
    await page.getByRole('radio', { name: '随机' }).click()
    // 锁成纯英译中：这些测试词没有中文释义，混合比例下会被跳过
    await page.getByLabel('题型比例').fill('0')
    await page.getByRole('button', { name: '开始' }).click()
    return (await page.getByTestId('review-word').first().textContent()) ?? ''
  }

  // 8 张卡片，两轮首张相同的概率是 1/8 —— 试三轮，全相同才算失败
  const seen = new Set<string>()
  for (let i = 0; i < 3; i++) seen.add(await firstCardWord())
  expect(seen.size).toBeGreaterThan(1)
})

test('题型比例滑杆实时显示百分比', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await expect(page.getByText('英译中 50% · 中译英 50%')).toBeVisible()
  await page.getByLabel('题型比例').fill('30')
  await expect(page.getByText('英译中 70% · 中译英 30%')).toBeVisible()
})

test('中译英答对', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  // 中译英的题面就是中文释义 —— 词库里没释义的话这个用例本身没意义，先确认
  const res = await page.request.get('/api/wordbook')
  const { entries } = (await res.json()) as { entries: { senses: unknown[] }[] }
  expect(entries[0].senses.length).toBeGreaterThan(0)

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  // 作答前不能泄题：英文单词一次都不该出现在页面上
  await expect(page.getByText('serendipity', { exact: true })).toHaveCount(0)

  // 大小写与尾部标点都该被宽松匹配吃掉
  await page.getByLabel('输入英文单词').fill('Serendipity.')
  await page.getByRole('button', { name: '提交' }).click()

  await expect(page.getByText('答对')).toBeVisible()
  await expect(page.getByTestId('review-answer')).toHaveText('serendipity')

  // 判定后回车进下一张 —— 只有一个词，直接到结算页
  await page.keyboard.press('Enter')
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/认识 1/)).toBeVisible()
})

test('中译英答错时显示正确答案与用户输入', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  await page.getByLabel('输入英文单词').fill('serendipty')
  await page.getByRole('button', { name: '提交' }).click()

  await expect(page.getByText('答错')).toBeVisible()
  await expect(page.getByTestId('review-answer')).toHaveText('serendipity')
  await expect(page.getByTestId('review-wrong-input')).toHaveText('serendipty')

  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/不认识 1/)).toBeVisible()
})

test('中译英卡片上空格进输入框，不触发翻面', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  const input = page.getByLabel('输入英文单词')
  await input.click()
  await page.keyboard.type('a b')
  await expect(input).toHaveValue('a b')
  // 还停在作答态，没有被空格翻出答案
  await expect(page.getByRole('button', { name: '提交' })).toBeVisible()
})

test('无中文释义的词在中译英轮次里被跳过并提示', async ({ page }) => {
  // zzqx 前缀保证词库里查不到，从而没有中文释义
  for (const w of ['zzqxfoo', 'zzqxbar', 'zzqxbaz']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  await expect(page.getByText('本轮 1 个 · 3 个无中文释义已跳过')).toBeVisible()
})

test('全部无中文释义 + 纯中译英时不崩溃，提示调整比例', async ({ page }) => {
  for (const w of ['zzqxfoo', 'zzqxbar']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  await expect(page.getByText(/出不了中译英题/)).toBeVisible()
  // 留在设置页，能改完比例重来
  await expect(page.getByRole('button', { name: '开始' })).toBeVisible()
})

import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!

// 这个套件的 beforeEach 会**清空** E2E_EMAIL 账号的整个单词本，且是硬删除、
// 不可恢复。它曾经指向一个真实使用中的账号，跑一次就把真实单词本删光了。
// 除非确认 E2E_EMAIL 是专用的一次性测试账号，否则直接拒跑。
if (process.env.E2E_DESTRUCTIVE_OK !== '1') {
  throw new Error(
    `e2e 会清空账号 ${EMAIL} 的整个单词本（硬删除，不可恢复）。\n` +
      '确认它是专用测试账号后，在 .env.local 里设 E2E_DESTRUCTIVE_OK=1 再跑。',
  )
}

const PARAGRAPH =
  'The committee deferred the decision pending further review of the ' +
  'unprecedented anomalies discovered in the quarterly reconciliation.'

/** 主页那个唯一的多行输入框（方向不同占位符也不同，用它统一定位） */
function mainInput(page: Page) {
  return page.getByPlaceholder(/输入/)
}

/**
 * 等流式译文真正写完。只断言「译文里出现了中文」是不够的 —— page.tsx 里
 * addHistory 是在流结束后才调用的，那时历史里还没有这条记录。
 * 流式光标（.streaming-caret）消失才是真的写完了。
 */
async function waitForTranslationDone(page: Page) {
  const translation = page.locator('section', { hasText: '译文' })
  await expect(translation).toContainText(/[一-龥]{8,}/, { timeout: 45_000 })
  await expect(page.locator('.streaming-caret')).toHaveCount(0, { timeout: 45_000 })
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
    await expect(page.getByText(`第 ${i} 张`)).toBeVisible()
    await page.getByText('点击或按空格翻面').click()
    // 「认识」按钮排在「不认识」之后，last() 取到它
    await page.getByRole('button', { name: /认识/ }).last().click()
  }

  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/认识 3/)).toBeVisible()

  await page.getByRole('link', { name: '回单词本' }).click()
  await expect(page.getByText(/熟练度 1\/5 · 复习 1 次/).first()).toBeVisible()
})

test('攒够设定的生词数就收工，后面的词不再出', async ({ page }) => {
  for (const w of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }

  await page.goto('/review')
  await page.getByRole('radio', { name: '顺序' }).click()
  // 这些测试词没有中文释义，锁成纯英译中
  await page.getByLabel('题型比例').fill('0')
  await page.getByLabel('今天要复习多少生词').fill('2')
  await page.getByRole('button', { name: '开始' }).click()

  await expect(page.getByText('生词 0 / 2')).toBeVisible()

  // 第一个标不认识：生词记一个，还没到线
  await page.getByText('点击或按空格翻面').click()
  await page.getByRole('button', { name: /^不认识/ }).click()
  await expect(page.getByText('生词 1 / 2')).toBeVisible()

  // 中间夹一个认识的：不算生词，轮次继续
  await page.getByText('点击或按空格翻面').click()
  await page.getByRole('button', { name: /^认识/ }).click()
  await expect(page.getByText('生词 1 / 2')).toBeVisible()
  await expect(page.getByText('第 3 张')).toBeVisible()

  // 第二个不认识的一到，立刻收工 —— 单词本里还剩两个词没出
  await page.getByText('点击或按空格翻面').click()
  await page.getByRole('button', { name: /^不认识/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText('共 3 个 · 认识 1 · 不认识 2')).toBeVisible()
})

test('本轮结束后可以把这批词打乱再练一遍', async ({ page }) => {
  for (const w of ['alpha', 'beta', 'gamma', 'delta']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }

  await page.goto('/review')
  await page.getByRole('radio', { name: '顺序' }).click()
  await page.getByLabel('题型比例').fill('0')
  await page.getByLabel('今天要复习多少生词').fill('1')
  await page.getByRole('button', { name: '开始' }).click()

  await page.getByText('点击或按空格翻面').click()
  await page.getByRole('button', { name: /^不认识/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()

  // 只出本轮判定过的那一个词，收工线沿用同一个数
  await page.getByRole('button', { name: '再练一遍这 1 个' }).click()
  await expect(page.getByText('第 1 张 · 生词 0 / 1')).toBeVisible()
  await expect(page.getByRole('button', { name: '上一个' })).toBeDisabled()

  await page.getByText('点击或按空格翻面').click()
  await page.getByRole('button', { name: /^认识/ }).click()
  await expect(page.getByText('共 1 个 · 认识 1 · 不认识 0')).toBeVisible()
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

test('中译英拼不出来时直接选「不认识」看答案', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  // 一个字都没打，也不该被卡住
  await page.getByRole('button', { name: /^不认识/ }).click()
  await expect(page.getByTestId('review-answer')).toHaveText('serendipity')

  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/不认识 1/)).toBeVisible()
})

test('中译英答错后可以改一下重答', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  await page.getByLabel('输入英文单词').fill('serendipty')
  await page.getByRole('button', { name: '提交' }).click()
  await expect(page.getByText('答错')).toBeVisible()

  // 回到输入框，原文还在，改对了重新提交
  await page.getByRole('button', { name: '改一下' }).click()
  const input = page.getByLabel('输入英文单词')
  await expect(input).toHaveValue('serendipty')
  await input.fill('serendipity')
  await page.getByRole('button', { name: '提交' }).click()
  await expect(page.getByText('答对')).toBeVisible()

  // 只写一次熟练度：改判前的那次答错不该也记一笔
  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/共 1 个 · 认识 1 · 不认识 0/)).toBeVisible()
})

test('中译英判定后可以手动改成「认识」', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  await page.getByLabel('输入英文单词').fill('serendipty')
  await page.getByRole('button', { name: '提交' }).click()
  await expect(page.getByText('答错')).toBeVisible()

  await page.getByRole('button', { name: /^认识/ }).click()
  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/共 1 个 · 认识 1 · 不认识 0/)).toBeVisible()
})

test('上一个 / 下一个在没翻面、没作答时也能用', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  // 还停在作答态、一个字都没打，导航就该在那儿了
  await expect(page.getByRole('button', { name: '上一个' })).toBeVisible()
  await expect(page.getByRole('button', { name: /下一个/ })).toBeEnabled()

  // 第一张没有上一张，按钮在但不可点
  await expect(page.getByRole('button', { name: '上一个' })).toBeDisabled()

  // 什么都没选就翻过去：不算复习过，两边都不计，也不写熟练度
  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('共 0 个 · 认识 0 · 不认识 0')).toBeVisible()

  await page.getByRole('link', { name: '回单词本' }).click()
  await expect(page.getByText(/复习 0 次/).first()).toBeVisible()
})

test('翻回上一张时判定还在，且不会重复记一次复习', async ({ page }) => {
  for (const w of ['alpha', 'beta']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }

  await page.goto('/review')
  await page.getByRole('radio', { name: '顺序' }).click()
  // 这些测试词没有中文释义，锁成纯英译中
  await page.getByLabel('题型比例').fill('0')
  await page.getByRole('button', { name: '开始' }).click()

  // 第一张标「认识」，跟以前一样标记即翻页
  await page.getByText('点击或按空格翻面').click()
  await page.getByRole('button', { name: /^认识/ }).click()
  await expect(page.getByText('第 2 张')).toBeVisible()

  // 翻回去：判定还记着
  await page.getByRole('button', { name: '上一个' }).click()
  await expect(page.getByText('第 1 张')).toBeVisible()
  await page.getByText('点击或按空格翻面').click()
  await expect(page.getByRole('button', { name: /^认识/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // 走完这轮：第一张只该被记一次复习，不因为翻回去看过而变成两次
  // 第二张一个判定都没给，不进本轮名单
  await page.getByRole('button', { name: /下一个/ }).click()
  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('共 1 个 · 认识 1 · 不认识 0')).toBeVisible()

  await page.getByRole('link', { name: '回单词本' }).click()
  await expect(page.getByText(/熟练度 1\/5 · 复习 1 次/)).toHaveCount(1)
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

test('翻译历史记录一条，可删除', async ({ page }) => {
  await mainInput(page).fill('apple')
  await page.getByRole('button', { name: '翻译' }).click()
  await expect(page.getByRole('heading', { name: 'apple' })).toBeVisible()

  await page.goto('/history')
  // 历史读的是 localStorage，走 useSyncExternalStore 在 hydration 后回填
  await expect(page.getByRole('button', { name: '删除记录 apple' })).toBeVisible()

  await page.getByRole('button', { name: '删除记录 apple' }).click()
  await expect(page.getByText('还没有翻译记录', { exact: false })).toBeVisible()
})

test('翻译历史可一键清空', async ({ page }) => {
  await mainInput(page).fill('apple')
  await page.getByRole('button', { name: '翻译' }).click()
  await expect(page.getByRole('heading', { name: 'apple' })).toBeVisible()

  await page.goto('/history')
  await expect(page.getByRole('button', { name: '删除记录 apple' })).toBeVisible()

  await page.getByRole('button', { name: '清空' }).click()
  await expect(page.getByText('还没有翻译记录', { exact: false })).toBeVisible()
})

test('本地模型配置保存后回显，清除后复位', async ({ page }) => {
  const BASE = 'http://localhost:11434/v1'
  const url = page.getByPlaceholder(BASE)
  const model = page.getByPlaceholder('qwen2.5:7b')

  await page.goto('/settings')
  await expect(page.getByText('当前：翻译走默认后端（未配置本地模型）')).toBeVisible()

  await url.fill(BASE)
  await model.fill('qwen2.5:7b')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已保存')).toBeVisible()
  await expect(page.getByText('当前：翻译走本地模型')).toBeVisible()

  // 刷新后回显 —— 正是 hydration 后由外部 store 同步表单的那条路径
  await page.reload()
  await expect(url).toHaveValue(BASE)
  await expect(model).toHaveValue('qwen2.5:7b')
  await expect(page.getByText('当前：翻译走本地模型')).toBeVisible()

  await page.getByRole('button', { name: '清除配置' }).click()
  await expect(url).toHaveValue('')
  await expect(model).toHaveValue('')
  await expect(page.getByText('当前：翻译走默认后端（未配置本地模型）')).toBeVisible()
})

test('历史页可把单词收藏进单词本', async ({ page }) => {
  // 先查一个词，让它进历史
  await mainInput(page).fill('serendipity')
  await page.getByRole('button', { name: '翻译' }).click()
  await expect(page.getByRole('heading', { name: 'serendipity' })).toBeVisible()

  await page.goto('/history')
  await page.getByRole('button', { name: '收藏 serendipity 到单词本' }).click()
  await expect(page.getByTestId('history-saved')).toBeVisible()

  // 真的进了单词本
  await page.goto('/wordbook')
  await expect(page.getByText('serendipity').first()).toBeVisible()
})

test('整段翻译的历史记录不出收藏按钮', async ({ page }) => {
  await mainInput(page).fill(PARAGRAPH)
  await page.getByRole('button', { name: '翻译' }).click()
  await waitForTranslationDone(page)

  await page.goto('/history')
  // 有这条记录
  await expect(page.getByRole('button', { name: /删除记录/ })).toBeVisible()
  // 没有单词的一键收藏按钮 —— 整段原文不是单词
  await expect(page.getByRole('button', { name: /到单词本$/ })).toHaveCount(0)
  // 取而代之的是挑词面板入口
  await expect(page.getByRole('button', { name: '挑词收藏' })).toBeVisible()
})

test('段落挑词：多选后批量收藏，已收藏的词被标记', async ({ page }) => {
  await mainInput(page).fill(PARAGRAPH)
  await page.getByRole('button', { name: '翻译' }).click()
  await waitForTranslationDone(page)

  await page.goto('/history')
  await page.getByRole('button', { name: '挑词收藏' }).click()

  // 停用词被滤掉。exact 必不可少 —— 默认是子串匹配，'the' 会命中 'further'
  await expect(page.getByRole('checkbox', { name: 'the', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'of', exact: true })).toHaveCount(0)

  // 实词在
  const committee = page.getByRole('checkbox', { name: 'committee', exact: true })
  const anomalies = page.getByRole('checkbox', { name: 'anomalies', exact: true })
  await expect(committee).toBeVisible()

  await committee.click()
  await anomalies.click()
  await expect(committee).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '收藏选中的 2 个词' }).click()

  // 存完后这两个词从可选的 checkbox 变成「已收藏」标记
  await expect(page.getByTestId('picker-saved-committee')).toBeVisible()
  await expect(page.getByTestId('picker-saved-anomalies')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'committee', exact: true })).toHaveCount(0)

  // 真的进了单词本
  await page.goto('/wordbook')
  await expect(page.getByText('committee').first()).toBeVisible()
  await expect(page.getByText('anomalies').first()).toBeVisible()
})

import { test, expect, type Page } from '@playwright/test'

const config = { baseUrl: 'https://device-model.example/v1', model: 'cloud-test', apiKey: 'e2e-test-key-not-real', disableThinking: true }
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }
async function selectSentence(page: Page) {
  await page.locator('.reader-prose p').first().evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}
async function reader(page: Page) {
  await page.goto('/reader?url=podcast/daily-news/example.md')
  await expect(page.locator('.reader-prose p')).toBeVisible()
  await selectSentence(page)
}
test.beforeEach(async ({ context, page }) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`
  const session = { access_token: jwt, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-4000-8000-000000000001', email: 'podcast-test@example.test' } }
  await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + encode(session), domain: 'localhost', path: '/' }])
  await page.route('**/api/translate/config', (route) => route.fulfill({ status: route.request().method() === 'POST' ? 405 : 200, json: route.request().method() === 'POST' ? { error: 'Method not allowed' } : config }))
  await page.route('**/api/fetch-page', (route) => route.fulfill({ json: { url: 'https://qiniu.aiquannei.com/podcast/daily-news/example.md', text: 'This is an English sentence for translation.' } }))
  await page.route('**/api/translate', (route) => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"delta","value":"Vercel 译文"}\n\n' }))
  await page.route('https://device-model.example/**', (route) => route.fulfill({ headers: cors, contentType: 'text/event-stream', body: route.request().method() === 'OPTIONS' ? '' : 'data: {"choices":[{"delta":{"content":"设备译文"}}]}\n\ndata: [DONE]\n' }))
})

test('device config persists across reloads and translations without authorization calls and supports explicit refresh', async ({ page }, info) => {
  const upstream: string[] = [], server: string[] = []
  let configs = 0, authorizations = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/translate/config') && request.method() === 'GET') configs++
    if (request.url().includes('/api/translate/config') && request.method() === 'POST') authorizations++
    if (request.url().endsWith('/api/translate')) server.push(request.url())
    if (request.url().startsWith(config.baseUrl) && request.method() === 'POST') upstream.push(request.url())
  })
  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: '由当前设备发起云端翻译' })
  await expect(toggle).not.toBeChecked()
  expect(configs).toBe(0)
  await toggle.click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  expect(configs).toBe(1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('deviceTranslationConfig')!))).toEqual(config)
  await page.reload()
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('status')).toContainText('已就绪')
  expect(configs).toBe(1)
  await page.screenshot({ path: info.outputPath('settings-device.png'), fullPage: true })
  const request = page.waitForRequest((r) => r.url() === config.baseUrl + '/chat/completions' && r.method() === 'POST')
  await reader(page)
  await expect(page.getByRole('dialog')).toContainText('设备译文')
  const sent = await request
  expect(sent.headers().authorization).toBe('Bearer ' + config.apiKey)
  expect(sent.postDataJSON()).toMatchObject({ model: config.model, thinking: { type: 'disabled' } })
  expect(server).toHaveLength(0); expect(upstream).toHaveLength(1)
  await reader(page)
  await expect(page.getByRole('dialog')).toContainText('设备译文')
  expect(upstream).toHaveLength(2); expect(configs).toBe(1); expect(authorizations).toBe(0)
  await page.goto('/settings')
  await expect(page.getByRole('status')).toContainText('已就绪')
  await page.getByRole('button', { name: '重新获取配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  expect(configs).toBe(2)
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('deviceTranslationConfig'))).toBeNull()
  await reader(page)
  await expect(page.getByRole('dialog')).toContainText('Vercel 译文')
  expect(server.length).toBeGreaterThanOrEqual(1); expect(upstream).toHaveLength(2); expect(authorizations).toBe(0)
})

test('podcast words always go directly to AI in device mode and return to dictionary lookup when disabled', async ({ page }) => {
  const dictionary: string[] = [], upstream: string[] = []
  let authorizations = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/word/')) dictionary.push(request.url())
    if (request.url() === config.baseUrl + '/chat/completions' && request.method() === 'POST') upstream.push(request.url())
    if (request.url().includes('/api/translate/config') && request.method() === 'POST') authorizations++
  })
  await page.route('**/api/podcast/shows/daily-news/device-word', (route) => route.fulfill({ json: {
    episode: { id: 'device-word', title: 'Device word test', publishedAt: null, image: null, channelImage: null, audio: null, english: null, chinese: null, englishWords: 'https://qiniu.aiquannei.com/podcast/daily-news/device-word.en.words.srt' },
    cues: [{ id: '0', startMs: 0, endMs: 1000, text: 'Hello Helo' }], englishError: null, chineseError: null,
  } }))
  await page.route('**/api/podcast/shows/daily-news/device-word/words', (route) => route.fulfill({ json: {
    sourceUrl: 'https://qiniu.aiquannei.com/podcast/daily-news/device-word.en.words.srt',
    cues: [{ id: '1', startMs: 100, endMs: 300, text: 'Hello' }, { id: '2', startMs: 400, endMs: 800, text: 'Helo' }],
  } }))
  await page.route('**/api/word/*', (route) => route.fulfill({ json: { word: 'hello', matchedFrom: 'exact', phonetic: '/həˈləʊ/', senses: [{ meaning: '词库释义' }] } }))
  await page.route('**/api/wordbook?*', (route) => route.fulfill({ json: { entries: [] } }))
  await page.route('https://device-model.example/**', (route) => route.fulfill({ headers: cors, json: {
    choices: [{ message: { content: JSON.stringify({ word: 'hello', phonetic: '/həˈləʊ/', senses: [{ pos: 'int.', meaning: 'AI 问候释义' }] }) } }],
  } }))
  async function selectWord(word: string) {
    await page.locator('[data-selection-english]').first().evaluate((element, word) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode()) && !node.textContent?.includes(word)) { /* Skip markup/other words. */ }
      if (!node) throw new Error('Selection word not found')
      const start = node.textContent!.indexOf(word)
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + word.length)
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, word)
  }
  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: '由当前设备发起云端翻译' })
  await toggle.click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  await page.goto('/podcast/shows/daily-news/device-word')
  await expect(page.locator('[data-selection-english]')).toBeVisible()
  await expect(page.locator('[data-word-index]')).toHaveCount(2)
  for (const word of ['Hello', 'Helo', 'Hello']) {
    const request = page.waitForRequest((r) => r.url() === config.baseUrl + '/chat/completions' && r.method() === 'POST')
    await selectWord(word)
    const sent = await request
    expect(sent.headers().authorization).toBe('Bearer ' + config.apiKey)
    expect(sent.postDataJSON()).toMatchObject({ model: config.model, stream: false, thinking: { type: 'disabled' } })
    const panel = page.getByRole('dialog')
    await expect(panel).toContainText('AI 问候释义')
    await expect(panel).toContainText('/həˈləʊ/')
    await expect(panel.getByRole('button', { name: '播放单词发音' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '收藏 hello' })).toBeVisible()
  }
  expect(dictionary).toHaveLength(0)
  expect(upstream.length).toBeGreaterThanOrEqual(3)
  expect(authorizations).toBe(0)
  const deviceCalls = upstream.length
  await page.goto('/settings'); await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.goto('/podcast/shows/daily-news/device-word')
  await expect(page.locator('[data-selection-english]')).toBeVisible()
  await selectWord('Hello')
  await expect(page.getByRole('dialog')).toContainText('词库释义')
  expect(dictionary.length).toBeGreaterThanOrEqual(1)
  expect(dictionary.every((url) => !url.includes('ai=skip'))).toBe(true)
  expect(upstream).toHaveLength(deviceCalls)
})

test('custom model save and clear remain independent of the cloud request switch', async ({ page }) => {
  let deviceCalls = 0
  page.on('request', (request) => { if (request.url().startsWith(config.baseUrl) && request.method() === 'POST') deviceCalls++ })
  await page.route('https://custom-model.example/**', (route) => route.fulfill({ headers: cors, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"自定义译文"}}]}\n\ndata: [DONE]\n' }))
  await page.goto('/settings')
  await page.getByRole('switch').click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  await page.getByLabel(/Base URL/).fill('https://custom-model.example/v1')
  await page.getByLabel(/^模型名/).fill('custom-test')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('当前：翻译走本地模型')).toBeVisible()
  await reader(page)
  await expect(page.getByRole('dialog')).toContainText('自定义译文')
  expect(deviceCalls).toBe(0)
  await page.goto('/settings')
  await expect(page.getByLabel(/^模型名/)).toHaveValue('custom-test')
  await page.getByRole('button', { name: '清除配置', exact: true }).click()
  await expect(page.getByRole('switch')).toBeChecked()
  await reader(page)
  await expect(page.getByRole('dialog')).toContainText('设备译文')
  expect(deviceCalls).toBe(1)
})

test('device errors remain visible without authorization calls or repeated configuration fetches', async ({ page }) => {
  let attempts = 0, serverCalls = 0
  await page.route('https://device-model.example/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    attempts++; return route.abort('failed')
  })
  page.on('request', (request) => { if (request.url().endsWith('/api/translate')) serverCalls++ })
  await page.goto('/settings'); await page.getByRole('switch').click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  await reader(page)
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('CORS')
  expect(attempts).toBe(1); expect(serverCalls).toBe(0)
  let extraConfigs = 0
  await page.route('**/api/translate/config', (route) => { extraConfigs++; return route.fulfill({ status: 500, json: { error: 'Must not call the website' } }) })
  await reader(page)
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('CORS')
  expect(attempts).toBe(2); expect(extraConfigs).toBe(0); expect(serverCalls).toBe(0)
})

test('request mode and cached config follow other tabs and logout clears persisted credentials', async ({ page, context }) => {
  await page.goto('/settings')
  await page.getByRole('switch').click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  const other = await context.newPage()
  let extraConfigs = 0
  await other.route('**/api/translate/config', (route) => { extraConfigs++; return route.fulfill({ status: 500, json: { error: 'Must use cached config' } }) })
  await other.goto('/settings')
  await expect(other.getByRole('switch')).toBeChecked()
  await expect(other.getByRole('status')).toContainText('已就绪')
  expect(extraConfigs).toBe(0)
  await page.getByRole('switch').click()
  await expect(other.getByRole('switch')).not.toBeChecked()
  expect(await other.evaluate(() => localStorage.getItem('deviceTranslationConfig'))).toBeNull()
  await page.getByRole('switch').click()
  await expect(page.getByRole('status')).toContainText('已就绪')
  await expect(other.getByRole('switch')).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('deviceTranslationConfig'))).not.toBeNull()
  await other.close()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(config.apiKey)
})

import { test, expect, type Page } from '@playwright/test'

const base = 'https://qiniu.aiquannei.com/podcast/daily-news/'
const episode = { id: 'episode-one', title: 'Daily News Listening', publishedAt: '2026-11-01T01:00:00Z', image: null, channelImage: null, audio: base + 'test.mp3', english: base + 'test.srt', chinese: base + 'test.zh-CN.srt' }
const cues = Array.from({ length: 30 }, (_, i) => ({ id: String(i), startMs: i * 2000, endMs: i * 2000 + 1500, text: `Speaker: This is sentence ${i} about learning English.`, chineseText: `这是第 ${i} 句中文。` }))

async function selectText(page: Page, selector: string, text?: string) {
  await page.locator(selector).first().evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const value = node.textContent ?? ''
      const start = text ? value.indexOf(text) : 0
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(node, start); range.setEnd(node, text ? start + text.length : value.length)
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      break
    }
  }, text)
}

test.beforeEach(async ({ context, page }, testInfo) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`
  const session = { access_token: jwt, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-4000-8000-000000000001', email: 'podcast-test@example.test' } }
  await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + encode(session), domain: 'localhost', path: '/' }])
  await page.route('**/api/podcast', (route) => route.fulfill({ json: { episodes: [episode] } }))
  await page.route('**/api/podcast/*', (route) => route.fulfill({ json: { episode, cues, englishError: null, chineseError: null } }))
  await page.route('**/api/word/*', (route) => route.fulfill({ json: { word: 'learning', matchedFrom: 'exact', phonetic: '/ˈlɜːnɪŋ/', senses: [{ pos: 'n.', meaning: '学习'.repeat(100) }] } }))
  await page.route('**/api/wordbook?*', (route) => route.fulfill({ json: { entries: [] } }))
  await page.route('**/api/wordbook', (route) => route.fulfill({ json: { entry: { id: 'test-favorite' } } }))
  await page.route('**/api/translate', (route) => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'delta', value: '这是自动翻译的中文内容。'.repeat(50) })}\n\n` }))
  await page.route('**/api/fetch-page', (route) => route.fulfill({ json: { url: base + 'example.md', text: Array.from({ length: 30 }, (_, i) => `This is paragraph ${i} about learning English.`).join('\n\n') } }))
  const wav = Buffer.alloc(16044)
  wav.write('RIFF'); wav.writeUInt32LE(16036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)
  await page.route('**/test.mp3', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }))
  if (testInfo.title.includes('real MP3')) return
  await page.addInitScript(() => {
    // Controllable media clock for UI tests; no remote audio dependency.
    const states = new WeakMap<HTMLMediaElement, { time: number; paused: boolean }>()
    const state = (a: HTMLMediaElement) => { if (!states.has(a)) states.set(a, { time: 0, paused: true }); return states.get(a)! }
    Object.defineProperties(HTMLMediaElement.prototype, {
      currentTime: { get() { return state(this).time }, set(time) { state(this).time = time; this.dispatchEvent(new Event('timeupdate')) } },
      duration: { get() { return 60 } }, readyState: { get() { return 4 } },
      paused: { get() { return state(this).paused } }, seeking: { get() { return false } }, error: { get() { return null } },
    })
    HTMLMediaElement.prototype.play = async function () { state(this).paused = false; this.dispatchEvent(new Event('playing')) }
    HTMLMediaElement.prototype.pause = function () { state(this).paused = true; this.dispatchEvent(new Event('pause')) }
    setInterval(() => document.querySelectorAll('audio').forEach((a) => { if (!state(a).paused) { state(a).time += 0.025; a.dispatchEvent(new Event('timeupdate')) } }), 25)
  })
})

test('catalog, navigation, direct detail, language toggle and mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/podcast')
  await expect(page.getByRole('heading', { name: '播客', exact: true })).toBeVisible()
  await page.getByRole('link', { name: episode.title }).click()
  await expect(page.getByText('这是第 0 句中文。')).toBeVisible()
  await page.getByLabel('显示中文').uncheck()
  await expect(page.getByText('这是第 0 句中文。')).toHaveCount(0)
  await expect(page.locator('[data-selection-english]').first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: episode.title })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(await page.locator('nav').evaluate((nav) => nav.getBoundingClientRect().height)).toBeLessThan(70)
})

test('sentence bounds, continuous pause/click and Chinese hide preserve player', async ({ page }) => {
  await page.goto('/podcast/episode-one')
  const first = page.getByRole('button', { name: '播放字幕 0:00', exact: true })
  await first.click()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  const end = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)
  expect(end).toBeGreaterThanOrEqual(1.5); expect(end).toBeLessThan(1.65)
  await page.getByRole('button', { name: '从头播放' }).click()
  await page.getByRole('button', { name: '暂停播客' }).click()
  await first.getByText('这是第 0 句中文。').click()
  await expect(page.getByLabel('播放模式')).toHaveValue('continuous')
  await page.getByLabel('显示中文').uncheck()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(1.7)
  await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
  await page.getByRole('link', { name: '← 播客列表' }).click()
  await expect(page.locator('audio')).toHaveCount(0)
})

test('automatic word lookup, four lines, favorite context, internal scroll and body dismiss', async ({ page }) => {
  await page.goto('/podcast/episode-one')
  await expect(page.locator('[data-selection-english]').first()).toBeVisible()
  await selectText(page, '[data-selection-english]', 'learning')
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('/ˈlɜːnɪŋ/')).toBeVisible()
  expect(await panel.locator('[data-translation-content]').evaluate((el) => el.clientHeight <= parseFloat(getComputedStyle(el).lineHeight) * 4 + 1)).toBe(true)
  const favoriteRequest = page.waitForRequest((r) => r.url().endsWith('/api/wordbook') && r.method() === 'POST')
  await panel.getByRole('button', { name: '收藏 learning' }).click()
  expect((await favoriteRequest).postDataJSON().sourceContext).toBe('This is sentence 0 about learning English.')
  await expect(panel).toBeVisible()
  await panel.locator('[data-translation-content]').evaluate((el) => { el.scrollTop = 100 })
  await expect(panel).toBeVisible()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await page.evaluate(() => window.scrollBy(0, 250))
  await expect(panel).toHaveCount(0)
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')))
  await expect(panel).toHaveCount(0)
})

test('reader automatically translates sentences with no dictionary controls', async ({ page }) => {
  await page.goto('/reader?url=podcast/daily-news/example.md')
  await expect(page.locator('.reader-prose p').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => window.innerWidth))
  expect(await page.locator('nav').evaluate((nav) => nav.getBoundingClientRect().height)).toBeLessThan(70)
  await selectText(page, '.reader-prose p')
  const panel = page.getByRole('dialog')
  await expect(panel).toContainText('这是自动翻译的中文内容。')
  await expect(panel.getByRole('button', { name: /发音|收藏/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '翻译选中内容' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('catalog failure, retry, empty state and refresh show newly published episodes', async ({ page }) => {
  let phase = 0
  await page.route('**/api/podcast', (route) => {
    return phase === 0 ? route.fulfill({ status: 502, json: { error: '节目加载失败' } })
      : route.fulfill({ json: { episodes: phase === 1 ? [] : [episode] } })
  })
  await page.goto('/podcast')
  await expect(page.locator('main [role=alert]')).toContainText('节目加载失败')
  phase = 1
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('暂无节目。')).toBeVisible()
  phase = 2
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('link', { name: episode.title })).toBeVisible()
})

test('missing Chinese, audio failure and unknown episode are independent', async ({ page }) => {
  await page.route('**/api/podcast/old', (route) => route.fulfill({ json: { episode: { ...episode, audio: null, chinese: null }, cues: cues.map((cue) => ({ ...cue, chineseText: undefined })), englishError: null, chineseError: '本期暂无中文字幕' } }))
  await page.goto('/podcast/old')
  await expect(page.getByLabel('显示中文')).toBeDisabled()
  await expect(page.locator('[data-selection-english]').first()).toBeVisible()
  await expect(page.getByText('本期音频不可用，可继续阅读字幕。')).toBeVisible()
  await page.route('**/api/podcast/missing', (route) => route.fulfill({ status: 404, json: { error: '节目不存在' } }))
  await page.goto('/podcast/missing')
  await expect(page.locator('main [role=alert]')).toContainText('节目不存在')
  await expect(page.getByRole('link', { name: '← 播客列表' })).toBeVisible()
})

test('new selection wins delayed results and scrolling during a request cannot reopen panel', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/word/learning', async (route) => {
    await pending
    await route.fulfill({ json: { word: 'learning', matchedFrom: 'exact', senses: [{ meaning: '旧结果' }] } }).catch(() => {})
  })
  await page.goto('/podcast/episode-one')
  await expect(page.locator('[data-selection-english]').first()).toBeVisible()
  await selectText(page, '[data-selection-english]', 'learning')
  await expect(page.getByRole('dialog')).toContainText('查询中')
  await selectText(page, '[data-selection-english]')
  await expect(page.getByRole('dialog')).toContainText('这是自动翻译')
  release()
  await expect(page.getByRole('dialog')).not.toContainText('旧结果')
  await page.evaluate(() => window.scrollBy(0, 200))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')))
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('long press never plays a subtitle, keyboard still can and controls do not shift content', async ({ page }, testInfo) => {
  await page.goto('/podcast/episode-one')
  const line = page.locator('[data-selection-english]').first()
  await expect(line).toBeVisible()
  const box = (await line.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 10)
  await page.mouse.down()
  await page.waitForTimeout(500) // Deliberately distinguish long press from ordinary click.
  await page.mouse.up()
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.getByRole('button', { name: '播放字幕 0:00', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
  await selectText(page, '[data-selection-english]', 'learning')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('compact-translation.png'), fullPage: false })
})

test('real MP3 seeks, repeats sentences and continues after a paused continuous jump', async ({ page }, testInfo) => {
  test.skip(process.env.PODCAST_LIVE_TEST !== '1', 'Opt-in network/media integration')
  test.setTimeout(90_000)
  const { loadCatalog, loadEpisode } = await import('../src/lib/podcast/load')
  const catalog = await loadCatalog()
  const latest = catalog.find((e) => e.english && e.chinese)!
  const detail = await loadEpisode(latest.id)
  await page.route('**/api/podcast/live', (route) => route.fulfill({ json: detail }))
  await page.goto('/podcast/live')
  await expect(page.getByRole('heading', { name: latest.title })).toBeVisible()
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.addEventListener('pause', () => { audio.dataset.pausedAt = String(audio.currentTime) }) })
  const short = detail.cues.filter((cue) => cue.endMs - cue.startMs < 3000)
  for (const cue of [short[0], short[Math.floor(short.length / 2)]]) {
    const timestamp = `${Math.floor(cue.startMs / 60000)}:${String(Math.floor(cue.startMs / 1000) % 60).padStart(2, '0')}`
    const row = page.getByRole('button', { name: `播放字幕 ${timestamp}`, exact: true })
    await row.click()
    await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
    await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused), { timeout: 15_000 }).toBe(true)
    const end = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)
    expect(Math.abs(end - cue.endMs / 1000), `cue ${cue.id}: actual=${end}, expected=${cue.endMs / 1000}`).toBeLessThanOrEqual(0.15)
    const actualPauseTime = Number(await page.locator('audio').getAttribute('data-paused-at'))
    expect(actualPauseTime - cue.endMs / 1000).toBeLessThanOrEqual(0.15)
    await row.click()
    await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
    await page.getByRole('button', { name: '暂停播客' }).click()
  }
  await page.getByRole('button', { name: '从头播放' }).click()
  await page.getByRole('button', { name: '暂停播客' }).click()
  const first = page.getByRole('button', { name: '播放字幕 0:00', exact: true })
  await first.locator('p[lang="zh-CN"]').click()
  await page.getByLabel('显示中文').uncheck()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 15_000 }).toBeGreaterThan(detail.cues[0].endMs / 1000 + 0.2)
  await expect(page.getByLabel('播放模式')).toHaveValue('continuous')
  await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('live-podcast.png') })
})

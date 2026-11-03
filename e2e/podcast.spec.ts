import { test, expect, type Page } from '@playwright/test'

const base = 'https://qiniu.aiquannei.com/podcast/daily-news/'
const episode = { id: 'episode-one', title: 'Daily News Listening', publishedAt: '2026-11-01T01:00:00Z', image: null, channelImage: null, audio: base + 'test.mp3', english: base + 'test.srt', chinese: base + 'test.zh-CN.srt' }
const cues = Array.from({ length: 30 }, (_, i) => ({ id: String(i), startMs: i * 2000, endMs: i * 2000 + 1500, text: `Speaker: This is sentence ${i} about learning English.`, chineseText: `这是第 ${i} 句中文。` }))
const wordEpisode = { ...episode, id: 'word-episode', englishWords: base + 'word-episode.en.words.srt' }
const wordSentences = [
  { id: 'a', startMs: 1000, endMs: 2000, text: 'Speaker: Go go now.', chineseText: '现在出发。' },
  { id: 'b', startMs: 4000, endMs: 6000, text: 'Speaker: Read English daily.', chineseText: '每天读英文。' },
  { id: 'c', startMs: 8000, endMs: 9500, text: 'Speaker: Keep learning.', chineseText: '坚持学习。' },
]
const timedWords = [
  { id: '1', startMs: 159, endMs: 400, text: 'Go' }, { id: '2', startMs: 1100, endMs: 1400, text: 'go' }, { id: '3', startMs: 2100, endMs: 2459, text: 'now.' },
  { id: '4', startMs: 4100, endMs: 4400, text: 'Read' }, { id: '5', startMs: 4600, endMs: 4900, text: 'English' }, { id: '6', startMs: 5400, endMs: 5900, text: 'daily.' },
  { id: '7', startMs: 8100, endMs: 8500, text: 'Keep' }, { id: '8', startMs: 8800, endMs: 9400, text: 'learning.' },
]
const wordPath = '/podcast/shows/daily-news/word-episode'
async function installWordEpisode(page: Page) {
  await page.route('**/api/podcast/shows/daily-news/word-episode', (route) => route.fulfill({ json: { episode: wordEpisode, cues: wordSentences, englishError: null, chineseError: null } }))
  await page.route('**/api/podcast/shows/daily-news/word-episode/words', (route) => route.fulfill({ json: { sourceUrl: wordEpisode.englishWords, cues: timedWords } }))
}
const firstWordRow = (page: Page) => page.locator('ol[aria-label="节目字幕"] [role="button"]').first()
const mediaTime = (page: Page) => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)
const paused = (page: Page) => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)

async function selectText(page: Page, selector: string, text?: string) {
  await page.locator(selector).first().evaluate((element, text) => {
    const content = element.textContent ?? ''
    const start = text ? content.indexOf(text) : 0
    if (start < 0) throw new Error(`Selection text not found: ${text}`)
    const end = text ? start + text.length : content.length
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let node: Node | null, offset = 0, started = false
    while ((node = walker.nextNode())) {
      const next = offset + (node.textContent?.length ?? 0)
      if (!started && start >= offset && start < next) {
        range.setStart(node, start - offset)
        started = true
      }
      if (started && end <= next) {
        range.setEnd(node, end - offset)
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        break
      }
      offset = next
    }
  }, text)
}

async function setRate(page: Page, rate: number) {
  const slider = page.getByRole('slider', { name: '播放速度' })
  await slider.focus(); await slider.press('Home')
  for (let i = 0; i < Math.round((rate - 0.5) / 0.1); i++) await slider.press('ArrowRight')
  await expect(slider).toHaveValue(String(rate))
}

async function expandPlayer(page: Page) {
  await page.getByRole('button', { name: '展开播放器' }).click()
}

test.beforeEach(async ({ context, page }, testInfo) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`
  const session = { access_token: jwt, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-4000-8000-000000000001', email: 'podcast-test@example.test' } }
  await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + encode(session), domain: 'localhost', path: '/' }])
  await page.route('**/api/podcast/shows/*', (route) => route.fulfill({ json: { episodes: [episode] } }))
  await page.route('**/api/podcast/shows/*/*', (route) => route.fulfill({ json: { episode, cues, englishError: null, chineseError: null } }))
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
    setInterval(() => document.querySelectorAll('audio').forEach((a) => { if (!state(a).paused) { state(a).time += 0.025 * a.playbackRate; a.dispatchEvent(new Event('timeupdate')) } }), 25)
  })
})

test('catalog, navigation, direct detail, language toggle and mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/podcast')
  await expect(page.getByRole('heading', { name: '播客', exact: true })).toBeVisible()
  await expect(page.locator('main li')).toHaveCount(4)
  for (const card of await page.locator('main li a').all()) {
    await expect(card).toHaveText('')
    await expect(card.locator('img')).toHaveCount(1)
  }
  await page.getByRole('link', { name: 'Daily News 10 Mins', exact: true }).click()
  await page.getByRole('link', { name: episode.title }).click()
  await expect(page.getByText('这是第 0 句中文。')).toBeVisible()
  await expandPlayer(page)
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
  await expandPlayer(page)
  await page.getByRole('button', { name: '从头播放' }).click()
  await page.getByRole('button', { name: '暂停播客' }).click()
  await first.getByText('这是第 0 句中文。').click()
  await expect(page.getByLabel('播放模式')).toHaveValue('continuous')
  await page.getByLabel('显示中文').uncheck()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(1.7)
  await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
  await page.getByRole('link', { name: '← 剧集列表' }).click()
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
  await page.route('**/api/podcast/shows/*', (route) => {
    return phase === 0 ? route.fulfill({ status: 502, json: { error: '节目加载失败' } })
      : route.fulfill({ json: { episodes: phase === 1 ? [] : [episode] } })
  })
  await page.goto('/podcast/shows/daily-news')
  await expect(page.locator('main [role=alert]')).toContainText('节目加载失败')
  phase = 1
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('暂无节目。')).toBeVisible()
  phase = 2
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('link', { name: episode.title })).toBeVisible()
})

test('missing Chinese, audio failure and unknown episode are independent', async ({ page }) => {
  await page.route('**/api/podcast/shows/daily-news/old', (route) => route.fulfill({ json: { episode: { ...episode, audio: null, chinese: null }, cues: cues.map((cue) => ({ ...cue, chineseText: undefined })), englishError: null, chineseError: '本期暂无中文字幕' } }))
  await page.goto('/podcast/old')
  await expandPlayer(page)
  await expect(page.getByLabel('显示中文')).toBeDisabled()
  await expect(page.locator('[data-selection-english]').first()).toBeVisible()
  await expect(page.getByText('本期音频不可用，可继续阅读字幕。')).toBeVisible()
  await page.route('**/api/podcast/shows/daily-news/missing', (route) => route.fulfill({ status: 404, json: { error: '节目不存在' } }))
  await page.goto('/podcast/missing')
  await expect(page.locator('main [role=alert]')).toContainText('节目不存在')
  await expect(page.getByRole('link', { name: '← 剧集列表' })).toBeVisible()
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
  await page.route('**/api/podcast/shows/daily-news/live', (route) => route.fulfill({ json: { ...detail, episode: { ...detail.episode, englishWords: null } } }))
  await page.goto('/podcast/live')
  await expect(page.getByRole('heading', { name: latest.title })).toBeVisible()
  await expandPlayer(page)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.addEventListener('pause', () => { audio.dataset.pausedAt = String(audio.currentTime) }) })
  const short = detail.cues.filter((cue) => cue.endMs - cue.startMs < 3000)
  const timings = []
  for (const [index, cue] of [short[0], short[Math.floor(short.length / 2)]].entries()) {
    await setRate(page, index === 0 ? 0.5 : 1.2)
    const timestamp = `${Math.floor(cue.startMs / 60000)}:${String(Math.floor(cue.startMs / 1000) % 60).padStart(2, '0')}`
    const row = page.getByRole('button', { name: `播放字幕 ${timestamp}`, exact: true })
    await row.click()
    await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
    await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused), { timeout: 15_000 }).toBe(true)
    const end = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)
    expect(Math.abs(end - cue.endMs / 1000), `cue ${cue.id}: actual=${end}, expected=${cue.endMs / 1000}`).toBeLessThanOrEqual(0.15)
    const actualPauseTime = Number(await page.locator('audio').getAttribute('data-paused-at'))
    expect(actualPauseTime - cue.endMs / 1000).toBeLessThanOrEqual(0.15)
    timings.push({ rate: index === 0 ? 0.5 : 1.2, cue: cue.id, endMs: cue.endMs, pausedAtMs: actualPauseTime * 1000, errorMs: actualPauseTime * 1000 - cue.endMs })
    await row.click()
    await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
    await page.getByRole('button', { name: '暂停播客' }).click()
  }
  await page.getByRole('button', { name: '从头播放' }).click()
  await page.getByRole('button', { name: '暂停播客' }).click()
  const first = page.locator('ol[aria-label="节目字幕"] [role="button"]').first()
  await first.locator('p[lang="zh-CN"]').click()
  await page.getByLabel('显示中文').uncheck()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 15_000 }).toBeGreaterThan(detail.cues[0].endMs / 1000 + 0.2)
  await expect(page.getByLabel('播放模式')).toHaveValue('continuous')
  await expect(page.getByRole('button', { name: '暂停播客' })).toBeVisible()
  await testInfo.attach('media-timing.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' })
  console.log(`${testInfo.project.name} real MP3 timings: ${JSON.stringify(timings)}`)
  await page.screenshot({ path: testInfo.outputPath('live-podcast.png') })
})

test('four programs have separate lists, entire episode card is a link, old links redirect', async ({ page }, info) => {
  await page.goto('/podcast')
  await expect(page.locator('main li')).toHaveCount(4)
  await page.screenshot({ path: info.outputPath('programs.png') })
  for (const [id, name] of [['daily-news', 'Daily News 10 Mins'], ['ai-digest', 'AI Digest'], ['topic', 'Talk Today'], ['deep-dive', 'How It Works']]) {
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/podcast/shows/${id}$`))
    const card = page.getByRole('link', { name: new RegExp(episode.title) })
    await expect(card.locator('time')).toBeVisible()
    await expect(card).toHaveAttribute('href', `/podcast/shows/${id}/episode-one`)
    await card.locator('time').click()
    await expect(page.getByRole('heading', { name: episode.title })).toBeVisible()
    await page.getByRole('link', { name: '← 剧集列表' }).click()
    await page.getByRole('link', { name: '← 所有节目' }).click()
    await expect(page).toHaveURL(/\/podcast$/)
  }
  await page.goto('/podcast/episode-one')
  await expect(page).toHaveURL(/\/podcast\/shows\/daily-news\/episode-one$/)
})

test('dock starts folded, speed persists and folding preserves audio and Chinese preference', async ({ page }, info) => {
  await page.goto('/podcast/episode-one')
  await expect(page.getByRole('button', { name: '展开播放器' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('[data-player-dock] button')).toHaveCount(1)
  await expect(page.getByRole('slider')).toHaveCount(0)
  await expandPlayer(page)
  await expect(page.getByRole('slider')).toBeVisible()
  await page.getByRole('slider').press('Home')
  await expect(page.getByRole('slider')).toHaveValue('0.5')
  await page.getByRole('slider').press('ArrowRight')
  await expect(page.getByRole('slider')).toHaveValue('0.6')
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', '0.6 倍')
  await setRate(page, 0.8)
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(0.8)
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await page.getByLabel('显示中文').uncheck()
  await page.getByRole('button', { name: '从头播放' }).click()
  const instance = await page.locator('audio').elementHandle()
  await page.getByRole('button', { name: '折叠播放器' }).click()
  await expect(page.locator('[data-player-dock] button')).toHaveCount(1)
  await expect(page.getByRole('slider')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('folded.png') })
  expect(await instance!.evaluate((a: HTMLAudioElement) => a.isConnected && !a.paused)).toBe(true)
  await page.getByRole('button', { name: '展开播放器' }).click()
  await expect(page.getByRole('slider')).toHaveValue('0.8')
  await expect(page.getByLabel('显示中文')).not.toBeChecked()
  await expect(page.getByLabel('播放模式')).toHaveValue('continuous')
  await page.reload()
  await expect(page.getByRole('button', { name: '展开播放器' })).toBeVisible()
  await expect(page.getByRole('slider')).toHaveCount(0)
  await expandPlayer(page)
  await expect(page.getByRole('slider')).toHaveValue('0.8')
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await page.getByRole('button', { name: '恢复正常速度' }).click()
  await expect(page.getByRole('slider')).toHaveValue('1')
  await page.goto('/podcast/shows/ai-digest/episode-one')
  await expect(page.getByRole('button', { name: '展开播放器' })).toBeVisible()
  await expect(page.getByRole('slider')).toHaveCount(0)
})

test('narrow program grid and long episode cards retain native link interactions and artwork fallback', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/podcast')
  const programs = page.locator('main li')
  const a = await programs.nth(0).boundingBox(), b = await programs.nth(1).boundingBox()
  expect(a!.x).toBe(b!.x)
  expect(b!.y).toBeGreaterThan(a!.y + a!.height)
  await page.getByRole('link', { name: 'Daily News 10 Mins', exact: true }).focus()
  await page.screenshot({ path: info.outputPath('programs-320-dark-focus.png'), fullPage: true })
  const longTitle = 'A long episode title about language, science and technology that wraps on small screens'
  await page.route('**/_next/image?*', (route) => {
    const src = new URL(route.request().url()).searchParams.get('url')
    if (src === base + 'broken.jpg') return route.fulfill({ status: 404 })
    if (src === base + 'fallback.jpg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#5C6A87"/></svg>' })
    return route.continue()
  })
  await page.route('**/api/podcast/shows/daily-news', (route) => route.fulfill({ json: { episodes: [{ ...episode, title: longTitle, image: base + 'broken.jpg', channelImage: base + 'fallback.jpg' }] } }))
  await page.keyboard.press('Enter')
  const card = page.getByRole('link', { name: new RegExp(longTitle) })
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => new URL(image.src).searchParams.get('url'))).toBe(base + 'fallback.jpg')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await card.focus()
  await page.screenshot({ path: info.outputPath('episodes-320-long-title.png'), fullPage: true })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: episode.title })).toBeVisible()
  await page.getByRole('link', { name: '← 剧集列表' }).click()
  await card.locator('img').click()
  await expect(page.getByRole('heading', { name: episode.title })).toBeVisible()
  await page.getByRole('link', { name: '← 剧集列表' }).click()
  const bounds = await card.boundingBox()
  await card.click({ position: { x: bounds!.width - 6, y: bounds!.height - 6 } })
  await expect(page.getByRole('heading', { name: episode.title })).toBeVisible()
  await page.getByRole('link', { name: '← 剧集列表' }).click()
  // Use the anchor's native new-tab behavior without intercepting navigation.
  await card.evaluate((element) => { element.setAttribute('target', '_blank') })
  const popup = page.waitForEvent('popup')
  await card.click()
  const otherTab = await popup
  await expect(otherTab).toHaveURL(/\/podcast\/shows\/daily-news\/episode-one$/)
  await otherTab.close()
})

test('dock and translation stay independent, last cue remains reachable and narrow layouts fit', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/podcast/episode-one')
  await expect(page.locator('[data-selection-english]').first()).toBeVisible()
  await selectText(page, '[data-selection-english]', 'learning')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expandPlayer(page)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '折叠播放器' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '展开播放器' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await setRate(page, 1.2)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: info.outputPath('dock-and-translation.png') })
  await page.locator('[data-selection-english]').last().scrollIntoViewIfNeeded()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const bounds = await page.locator('[data-selection-english]').last().boundingBox()
  const dock = await page.locator('[data-player-dock]').boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(dock!.y)
  await page.getByRole('button', { name: '折叠播放器' }).click()
  await page.getByRole('button', { name: '展开播放器' }).click()
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px' })
  await expect(page.locator('[data-selection-english]').first()).toHaveCSS('color', 'rgb(232, 236, 243)')
  await expect(page.locator('ol[aria-label="节目字幕"] [role="button"]').first()).toHaveCSS('transition-property', 'none')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await page.screenshot({ path: info.outputPath('dock-dark-large-text.png') })
})

test('real library renders the four feeds and their episode details', async ({ page }, info) => {
  test.skip(process.env.PODCAST_LIVE_TEST !== '1', 'Opt-in network library screenshots')
  test.setTimeout(60_000)
  const { PROGRAMS, programPath } = await import('../src/lib/podcast/programs')
  const { loadCatalog, loadEpisode } = await import('../src/lib/podcast/load')
  await page.goto('/podcast')
  await page.screenshot({ path: info.outputPath('real-programs.png') })
  for (const program of PROGRAMS) {
    const episodes = await loadCatalog(program)
    const detail = await loadEpisode(episodes[0].id, program)
    await page.route(`**/api/podcast/shows/${program.id}`, (route) => route.fulfill({ json: { episodes } }))
    await page.route(`**/api/podcast/shows/${program.id}/${detail.episode.id}`, (route) => route.fulfill({ json: detail }))
    await page.goto(programPath(program.id))
    await expect(page.getByRole('heading', { name: program.name, exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`real-${program.id}-episodes.png`) })
    await page.getByRole('link', { name: new RegExp(detail.episode.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
    await expect(page.getByRole('heading', { name: detail.episode.title, exact: true })).toBeVisible()
    await expect(page.locator('[data-selection-english]').first()).toBeVisible()
    await page.screenshot({ path: info.outputPath(`real-${program.id}-detail.png`) })
  }
})

test('word enhancement loads after readable sentences without replacing audio, then a last word beyond the old end plays completely', async ({ page }) => {
  await installWordEpisode(page)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/podcast/shows/daily-news/word-episode/words', async (route) => { await pending; await route.fulfill({ json: { sourceUrl: wordEpisode.englishWords, cues: timedWords } }).catch(() => {}) })
  await page.goto(wordPath)
  const row = firstWordRow(page)
  await expect(row.locator('[data-selection-english]')).toHaveText('Go go now.')
  await expect(row.locator('[data-word-index]')).toHaveCount(0)
  await row.click({ position: { x: 8, y: 8 } })
  await expect.poll(() => paused(page)).toBe(false)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause())
  const at = await mediaTime(page), instance = await page.locator('audio').elementHandle()
  await selectText(page, '[data-selection-english]', 'go')
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('go')
  release()
  await expect(row.locator('[data-word-index]')).toHaveCount(3)
  expect(await instance!.evaluate((audio) => audio.isConnected)).toBe(true)
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('go')
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  expect(await mediaTime(page)).toBe(at); expect(await paused(page)).toBe(true)
  await row.locator('[data-word-index="2"]').click()
  expect(await mediaTime(page)).toBeGreaterThanOrEqual(2.1)
  await expect(row).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => paused(page)).toBe(true)
  expect(Math.abs(await mediaTime(page) - 2.459)).toBeLessThanOrEqual(0.15)
  await row.locator('[data-word-index="2"]').click()
  expect(await mediaTime(page)).toBeLessThan(2.4)
})

test('word jumps repeat the selected occurrence, resume continuous mode and share Chinese whole-sentence playback', async ({ page }) => {
  await installWordEpisode(page); await page.goto(wordPath)
  const row = firstWordRow(page)
  await expect(row.locator('[data-word-index]')).toHaveCount(3)
  await expandPlayer(page); await setRate(page, 0.5)
  await row.locator('[data-word-index="1"]').click()
  expect(await mediaTime(page)).toBeGreaterThanOrEqual(1.1); expect(await mediaTime(page)).toBeLessThan(1.4)
  await page.getByRole('button', { name: '暂停播客' }).click()
  const at = await mediaTime(page)
  await page.getByRole('button', { name: '继续播放' }).click()
  expect(await mediaTime(page)).toBeGreaterThanOrEqual(at)
  await expect.poll(() => paused(page)).toBe(true)
  await page.getByRole('button', { name: '继续播放' }).click()
  expect(await mediaTime(page)).toBeLessThan(1.4)
  await page.getByRole('button', { name: '暂停播客' }).click()
  await page.getByLabel('播放模式').selectOption('continuous')
  expect(await paused(page)).toBe(true)
  await setRate(page, 1.2)
  await row.locator('[data-word-index="2"]').click()
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(2.8)
  expect(await paused(page)).toBe(false)
  await page.getByRole('button', { name: '暂停播客' }).click()
  await row.locator('[data-word-index="1"]').click()
  await expect(page.getByLabel('播放模式')).toHaveValue('continuous')
  expect(await mediaTime(page)).toBeLessThan(1.5)
  await page.getByRole('button', { name: '暂停播客' }).click()
  await row.locator('p[lang="zh-CN"]').click()
  expect(await mediaTime(page)).toBeGreaterThanOrEqual(0.159); expect(await mediaTime(page)).toBeLessThan(0.5)
})

test('keyboard word navigation preserves one Tab stop per row and compact bilingual layout', async ({ page }, info) => {
  await installWordEpisode(page); await page.goto(wordPath)
  const row = firstWordRow(page)
  await expect(row.locator('[data-word-index]')).toHaveCount(3)
  await row.focus(); await row.press('ArrowRight'); await row.press('ArrowRight')
  await expect(row).toHaveAttribute('aria-label', /定位词 go$/)
  expect(await paused(page)).toBe(true)
  await row.press('Enter'); expect(await mediaTime(page)).toBeGreaterThanOrEqual(1.1)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause())
  await row.press('End'); await row.press('Space')
  expect(await mediaTime(page)).toBeGreaterThanOrEqual(2.1)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause())
  await row.press('Home'); await row.press('Escape'); await row.press('Enter')
  expect(await mediaTime(page)).toBeLessThan(0.5)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause())
  const at = await mediaTime(page)
  await row.press('Shift+ArrowRight'); expect(await mediaTime(page)).toBe(at)
  expect(await row.locator('[tabindex]').count()).toBe(0)
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.evaluate(() => { window.getSelection()?.removeAllRanges(); document.documentElement.style.fontSize = '20px' })
  await row.focus(); await row.press('End')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await expect(row.locator('p[lang="zh-CN"]')).toHaveText('现在出发。')
  await page.screenshot({ path: info.outputPath('words-keyboard-320-dark.png'), fullPage: true })
  await expandPlayer(page)
  await page.screenshot({ path: info.outputPath('words-dock-320-dark.png'), fullPage: true })
})

test('word spans keep long-press and cross-word translation isolated from playback and selection clearing', async ({ page }) => {
  await installWordEpisode(page); await page.goto(wordPath)
  // This short fixture must have actual scroll space, including on a tall mobile viewport.
  await page.evaluate(() => { document.body.style.minHeight = '1600px' })
  await page.route('**/api/word/go', (route) => route.fulfill({ json: { word: 'go', matchedFrom: 'exact', phonetic: '/ɡəʊ/', senses: [{ meaning: '走' }] } }))
  const row = firstWordRow(page)
  await expect(row.locator('[data-word-index]')).toHaveCount(3)
  await row.dispatchEvent('pointerdown', { clientX: 20, clientY: 20, pointerType: 'touch' })
  await page.waitForTimeout(500)
  await row.locator('[data-selection-english]').evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element)
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await row.dispatchEvent('pointerup', { pointerType: 'touch' }); await row.locator('[data-word-index="1"]').dispatchEvent('click')
  await expect(page.getByRole('dialog')).toContainText('这是自动翻译')
  expect(await mediaTime(page)).toBe(0); expect(await paused(page)).toBe(true)
  await row.locator('[data-word-index="1"]').click()
  expect(await paused(page)).toBe(true)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await row.dispatchEvent('pointerdown', { clientX: 20, clientY: 20 })
  await selectText(page, '[data-selection-english]', 'go')
  await row.dispatchEvent('pointerup')
  const panel = page.getByRole('dialog')
  await expect(panel).toContainText('/ɡəʊ/')
  const favorite = page.waitForRequest((request) => request.url().endsWith('/api/wordbook') && request.method() === 'POST')
  await panel.getByRole('button', { name: '收藏 go' }).click()
  expect((await favorite).postDataJSON().sourceContext).toBe('Go go now.')
  await expect(panel).toBeVisible()
  expect(await paused(page)).toBe(true)
  await page.evaluate(() => window.scrollBy(0, 250))
  await expect(panel).toHaveCount(0)
  expect(await paused(page)).toBe(true)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await row.locator('[data-word-index="1"]').click()
  await expect.poll(() => paused(page)).toBe(false)
})

test('optional word failure retries locally, handles missing tokens, and rejects a changed source declaration', async ({ page }) => {
  await installWordEpisode(page)
  let phase = 'error'
  await page.route('**/api/podcast/shows/daily-news/word-episode/words', (route) => phase === 'error' ? route.fulfill({ status: 502, json: { error: '逐词文件暂时不可用' } }) : route.fulfill({ json: { sourceUrl: phase === 'changed' ? base + 'new.words.srt' : wordEpisode.englishWords, cues: timedWords.filter((word) => word.id !== '2') } }))
  await page.goto(wordPath)
  await expect(page.getByText('逐词文件暂时不可用')).toBeVisible()
  const row = firstWordRow(page)
  await row.click({ position: { x: 8, y: 8 } })
  expect(await mediaTime(page)).toBeGreaterThanOrEqual(1)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause())
  const instance = await page.locator('audio').elementHandle(), at = await mediaTime(page)
  phase = 'valid'; await page.getByRole('button', { name: '重试逐词字幕' }).click()
  await expect(page.getByText('部分逐词定位不可用', { exact: false })).toBeVisible()
  await expect(row.locator('[data-word-index]')).toHaveCount(0)
  await expect(page.locator('[data-selection-english]').nth(1).locator('[data-word-index]')).toHaveCount(3)
  await expect(row.locator('p[lang="zh-CN"]')).toHaveText('现在出发。')
  expect(await instance!.evaluate((a) => a.isConnected)).toBe(true)
  expect(await mediaTime(page)).toBe(at)
  phase = 'changed'; await page.getByRole('button', { name: '重试逐词字幕' }).click()
  await expect(page.getByText('逐词字幕声明已更新', { exact: false })).toBeVisible()
  await expect(page.locator('[data-word-index]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新加载节目字幕' })).toBeVisible()
  await page.route('**/api/podcast/shows/daily-news/word-episode', (route) => route.fulfill({ json: { episode: { ...wordEpisode, englishWords: base + 'new.words.srt' }, cues: wordSentences, englishError: null, chineseError: null } }))
  await page.getByRole('button', { name: '重新加载节目字幕' }).click()
  await expect(page.locator('[data-selection-english]').nth(1).locator('[data-word-index]')).toHaveCount(3)
  await expect(page.getByText('逐词字幕声明已更新', { exact: false })).toHaveCount(0)
})

test('late word responses cannot affect another program and old episodes make no enhancement request', async ({ page }) => {
  await installWordEpisode(page)
  let release!: () => void
  const pending = new Promise<void>((r) => { release = r })
  await page.route('**/api/podcast/shows/daily-news/word-episode/words', async (route) => { await pending; await route.fulfill({ json: { sourceUrl: wordEpisode.englishWords, cues: timedWords } }).catch(() => {}) })
  await page.goto(wordPath)
  await expect(firstWordRow(page).locator('[data-selection-english]')).toHaveText('Go go now.')
  let extra = 0
  page.on('request', (request) => { if (request.url().endsWith('/words')) extra++ })
  await page.goto('/podcast/shows/ai-digest/episode-one')
  release()
  await expect(page.locator('[data-selection-english]').first()).toContainText('This is sentence')
  await expect(page.locator('[data-word-index]')).toHaveCount(0)
  expect(extra).toBe(0); expect(await paused(page)).toBe(true)
})

test('real MP3 word seeking uses actual word starts and sentence-final word ends at slow and fast speeds', async ({ page }, info) => {
  test.skip(process.env.PODCAST_LIVE_TEST !== '1', 'Opt-in real word timing and audio integration')
  test.setTimeout(90_000)
  const { loadCatalog, loadEpisode, loadWordTrack } = await import('../src/lib/podcast/load')
  const { alignWords } = await import('../src/lib/podcast/words')
  const latest = (await loadCatalog()).find((e) => e.englishWords)!
  const [detail, track] = await Promise.all([loadEpisode(latest.id), loadWordTrack(latest.id)])
  const alignment = alignWords(detail.cues, track.cues)
  expect(alignment.size).toBe(detail.cues.length)
  await page.route('**/api/podcast/shows/daily-news/live-words', (route) => route.fulfill({ json: detail }))
  await page.route('**/api/podcast/shows/daily-news/*/words', (route) => route.fulfill({ json: track }))
  await page.goto('/podcast/shows/daily-news/live-words')
  await expect(page.locator('[data-word-index]').first()).toBeVisible()
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 15_000 }).toBeGreaterThan(0)
  await expandPlayer(page)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.dataset.pauseCount = '0'
    audio.addEventListener('seeking', () => { audio.dataset.seekStart = String(audio.currentTime) })
    audio.addEventListener('pause', () => { audio.dataset.pausedAt = String(audio.currentTime); audio.dataset.pauseCount = String(Number(audio.dataset.pauseCount) + 1) })
  })
  const values = [...alignment.values()]
  const crossed = values.find((sentence) => sentence.words.at(-1)!.startMs > detail.cues.find((cue) => cue.id === sentence.cueId)!.endMs)!
  expect(crossed).toBeDefined()
  const samples = [values[0], values[Math.floor(values.length / 2)], crossed]
  const timings = []
  for (const [i, sentence] of samples.entries()) {
    const wordIndex = Math.max(0, sentence.words.length - (i === 0 ? 2 : 1))
    const word = sentence.words[wordIndex]
    const rate = i === 0 ? 0.5 : 1.2
    await setRate(page, rate)
    const rowIndex = detail.cues.findIndex((cue) => cue.id === sentence.cueId)
    const row = page.locator('ol[aria-label="节目字幕"] [role="button"]').nth(rowIndex)
    const pauses = Number(await page.locator('audio').getAttribute('data-pause-count'))
    await row.locator(`[data-word-index="${wordIndex}"]`).click()
    await expect.poll(async () => Number(await page.locator('audio').getAttribute('data-pause-count')), { timeout: 15_000 }).toBeGreaterThan(pauses)
    expect(await paused(page)).toBe(true)
    const seek = Number(await page.locator('audio').getAttribute('data-seek-start'))
    const stop = Number(await page.locator('audio').getAttribute('data-paused-at'))
    expect(Math.abs(seek - word.startMs / 1000)).toBeLessThanOrEqual(0.15)
    expect(Math.abs(stop - sentence.endMs / 1000)).toBeLessThanOrEqual(0.15)
    timings.push({ cueId: sentence.cueId, wordIndex, rate, expectedStartMs: word.startMs, expectedEndMs: sentence.endMs, actualStartMs: seek * 1000, actualEndMs: stop * 1000, startErrorMs: (seek * 1000) - word.startMs, endErrorMs: (stop * 1000) - sentence.endMs })
  }
  await page.getByLabel('播放模式').selectOption('continuous')
  const row = page.locator('ol[aria-label="节目字幕"] [role="button"]').nth(detail.cues.findIndex((cue) => cue.id === crossed.cueId))
  await row.locator(`[data-word-index="${crossed.words.length - 1}"]`).click()
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(crossed.endMs / 1000 + 0.2)
  expect(await paused(page)).toBe(false)
  await page.getByRole('button', { name: '暂停播客' }).click()
  await info.attach('real-word-timing.json', { body: JSON.stringify({ episodeId: latest.id, sentences: detail.cues.length, words: track.cues.length, timings }, null, 2), contentType: 'application/json' })
  console.log(`${info.project.name} real word timings: ${JSON.stringify(timings)}`)
  await page.screenshot({ path: info.outputPath('real-word-playback.png') })
})

test('wordbook search ignores an older response arriving after a new search', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const requests: string[] = []
  await page.route('**/api/wordbook?*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    requests.push(q)
    if (q === 'alpha') await pending
    await route.fulfill({ json: { entries: q ? [{ id: q, word: q, wordKey: q, senses: [{ pos: 'n.', meaning: '释义' }], familiarity: 0, reviewCount: 0 }] : [] } }).catch(() => {})
  })
  await page.goto('/wordbook')
  const search = page.getByRole('textbox', { name: '搜索单词' })
  await search.fill('alpha')
  await expect.poll(() => requests.includes('alpha')).toBe(true)
  await search.fill('beta')
  await expect(page.locator('main')).toContainText('beta')
  release()
  await expect(page.locator('main')).not.toContainText('alpha')
  await expect(page.locator('main')).toContainText('beta')
})

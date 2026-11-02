import { afterEach, describe, it, expect, vi } from 'vitest'
import { fetchPodcastText, loadCatalog, loadEpisode } from './load'
const base = 'https://qiniu.aiquannei.com/podcast/daily-news/'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('bounded fixed-source requests', () => {
  it('uses no-store, revalidation, timeout and controlled cache busting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<rss><channel><title>x</title></channel></rss>'))
    vi.stubGlobal('fetch', fetcher)
    expect(await loadCatalog()).toEqual([])
    const [url, init] = fetcher.mock.calls[0]
    expect(url.searchParams.has('_refresh')).toBe(true)
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('rejects redirect outside allowed source before fetching it', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchPodcastText(base + 'feed.xml')).rejects.toThrow('地址')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('bounds redirects and response bytes even without content-length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: base + 'feed.xml' } })))
    await expect(fetchPodcastText(base + 'feed.xml')).rejects.toThrow('重定向')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1))))
    await expect(fetchPodcastText(base + 'a.srt')).rejects.toThrow('2MB')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { headers: { 'content-length': '3000000' } })))
    await expect(fetchPodcastText(base + 'a.srt')).rejects.toThrow('2MB')
  })
  it('aborts after ten seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(fetchPodcastText(base + 'a.srt')).rejects.toThrow()
    expect(timeout).toHaveBeenCalledWith(10_000)
    timeout.mockRestore()
  })
  it('loads languages independently and never guesses absent Chinese paths', async () => {
    const xml = `<rss><channel><item><guid>a</guid><title>A</title><podcast:transcript url="${base}a.srt" type="application/x-subrip" language="en"/></item></channel></rss>`
    const fetcher = vi.fn().mockImplementation(async (url: URL) => new Response(url.pathname.endsWith('xml') ? xml : '1\n00:00:00,000 --> 00:00:01,000\nHello'))
    vi.stubGlobal('fetch', fetcher)
    const id = (await loadCatalog())[0].id
    const detail = await loadEpisode(id)
    expect(detail.cues).toHaveLength(1)
    expect(detail.chineseError).toContain('暂无')
    expect(fetcher.mock.calls.every(([u]) => !String(u).includes('zh-CN'))).toBe(true)
    await expect(loadEpisode('missing')).rejects.toMatchObject({ status: 404 })
  })
})

import { PROGRAMS } from './programs'
it('rejects redirects to another registered program directory', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: PROGRAMS[0].feed } }))
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchPodcastText(PROGRAMS[1].feed, PROGRAMS[1])).rejects.toThrow('地址')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

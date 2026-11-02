import { describe, it, expect } from 'vitest'
import { parseFeed, resourceUrl } from './feed'
const base = 'https://qiniu.aiquannei.com/podcast/daily-news/'
const item = (body = '', guid = 'one') => `<item><guid>${guid}</guid><title>A &amp; B</title><pubDate>Sun, 01 Nov 2026 09:00:00 +0800</pubDate><enclosure url="${base}a.mp3" type="audio/mpeg"/>${body}</item>`
const rss = (items: string) => `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><itunes:image href="${base}cover.jpg"/>${items}</channel></rss>`
describe('podcast RSS', () => {
  it('selects language independently of node order and stable IDs survive reordering', () => {
    const tracks = `<podcast:transcript url="${base}a.zh-CN.srt" type="application/x-subrip" language="zh-CN" rel="captions"/><podcast:transcript url="${base}a.srt" type="application/x-subrip" language="en"/>`
    const [episode] = parseFeed(rss(item(tracks)))
    expect(episode).toMatchObject({ title: 'A & B', english: base + 'a.srt', chinese: base + 'a.zh-CN.srt', channelImage: base + 'cover.jpg' })
    expect(parseFeed(rss(item('', 'two') + item(tracks)))[1].id).toBe(episode.id)
    expect(parseFeed(rss(item(tracks) + item(tracks)))).toHaveLength(1)
  })
  it('falls back to enclosure for missing GUID and keeps old English-only episodes', () => {
    const [e] = parseFeed(rss(item().replace('<guid>one</guid>', '')))
    expect(e.id).toHaveLength(24)
    expect(e.chinese).toBeNull()
  })
  it('sorts by date, handles missing fields, preserves markup as text', () => {
    const older = item('', 'old').replace('01 Nov', '31 Oct').replace('Sun,', 'Sat,')
    expect(parseFeed(rss(older + item()))[0].publishedAt).toBe('2026-11-01T01:00:00.000Z')
    const [e] = parseFeed(rss('<item><guid>x</guid><title><![CDATA[<script>x</script>]]></title></item>'))
    expect(e).toMatchObject({ title: '<script>x</script>', audio: null, publishedAt: null })
  })
  it('rejects DTD/entities and malformed XML', () => {
    expect(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "boom">]>' + rss(item()))).toThrow()
    expect(() => parseFeed('<rss>')).toThrow()
  })
  it.each(['http://qiniu.aiquannei.com/podcast/daily-news/a', 'https://evil.test/a', 'https://qiniu.aiquannei.com/podcast/daily-news/%2e%2e/a', 'https://u@qiniu.aiquannei.com/podcast/daily-news/a', 'https://qiniu.aiquannei.com:8443/podcast/daily-news/a'])('rejects untrusted resource %s', (url) => expect(resourceUrl(url)).toBeNull())
})

import { PROGRAMS } from './programs'
it('keeps each program directory isolated and preserves GUID-based Daily News IDs', () => {
  const ids = PROGRAMS.map((program) => {
    const content = rss(item(`<podcast:transcript url="https://qiniu.aiquannei.com${program.directory}a.srt" type="application/x-subrip" language="en"/>`).replaceAll(base, `https://qiniu.aiquannei.com${program.directory}`))
    const parsed = parseFeed(content, program)[0]
    expect(parsed.audio).toContain(program.directory)
    expect(parsed.english).toContain(program.directory)
    expect(parsed.chinese).toBeNull()
    for (const other of PROGRAMS.filter((p) => p.id !== program.id)) expect(resourceUrl(`https://qiniu.aiquannei.com${other.directory}a.mp3`, program)).toBeNull()
    return parsed.id
  })
  expect(new Set(ids).size).toBe(1) // The URL's program context, not a changed GUID hash, scopes identity.
  expect(ids[0]).toBe(parseFeed(rss(item()))[0].id)
})

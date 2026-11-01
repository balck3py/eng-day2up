import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { Episode } from './types'

export const FEED_URL = 'https://qiniu.aiquannei.com/podcast/daily-news/feed.xml'

export function resourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    const path = decodeURIComponent(url.pathname)
    if (url.protocol !== 'https:' || url.hostname !== 'qiniu.aiquannei.com' ||
        url.port || url.username || url.password || !path.startsWith('/podcast/daily-news/') ||
        path.includes('..') || path.includes('\\')) return null
    return url.href
  } catch { return null }
}

type XmlNode = Record<string, unknown>
const record = (v: unknown): XmlNode => v && typeof v === 'object' ? v as XmlNode : {}
const list = (v: unknown): unknown[] => v == null ? [] : Array.isArray(v) ? v : [v]
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : textValue(record(v)['#text'])
const textValue = (v: unknown): string => typeof v === 'string' ? v.trim() : ''

export function parseFeed(xml: string): Episode[] {
  // RSS never needs DTDs. Reject them before parsing, rather than expanding entities.
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('节目源格式无效')
  }
  const parsed = new XMLParser({
    ignoreAttributes: false, parseTagValue: false, processEntities: true,
  }).parse(xml)
  const channel = record(record(record(parsed).rss).channel)
  if (!Object.keys(channel).length) throw new Error('节目源缺少频道信息')
  const channelImage = resourceUrl(record(channel['itunes:image'])['@_href']) ??
    resourceUrl(text(record(channel.image).url))
  const ids = new Set<string>()
  return list(channel.item).map((raw): Episode | null => {
    const item = record(raw)
    const enclosure = list(item.enclosure).map(record).find((e) => text(e['@_type']).startsWith('audio/'))
    const audio = resourceUrl(enclosure?.['@_url'])
    const identity = text(item.guid) || audio
    if (!identity) return null
    const id = createHash('sha256').update(identity).digest('hex').slice(0, 24)
    if (ids.has(id)) return null
    ids.add(id)
    const date = Date.parse(text(item.pubDate))
    const tracks = list(item['podcast:transcript']).map(record)
      .filter((t) => text(t['@_type']).split(';')[0].toLowerCase() === 'application/x-subrip' && resourceUrl(t['@_url']))
    function track(language: 'en' | 'zh-CN') {
      const candidates = tracks.filter((t) => {
        const lang = text(t['@_language']).toLowerCase()
        return language === 'en' ? /^en(?:-|$)/.test(lang) : lang === 'zh-cn'
      })
      candidates.sort((a, b) => {
        const score = (t: XmlNode) => (text(t['@_language']).toLowerCase() === language.toLowerCase() ? 2 : 0) +
          (t['@_rel'] === 'captions' ? 1 : 0)
        return score(b) - score(a)
      })
      return resourceUrl(candidates[0]?.['@_url'])
    }
    return {
      id, title: text(item.title) || '未命名节目',
      publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
      image: resourceUrl(record(item['itunes:image'])['@_href']), channelImage,
      audio, english: track('en'), chinese: track('zh-CN'),
    }
  }).filter((e): e is Episode => e !== null)
    .sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0))
}

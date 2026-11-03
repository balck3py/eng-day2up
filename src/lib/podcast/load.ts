import { parseFeed, resourceUrl } from './feed'
import { parseSrt, pairCues } from './srt'
import type { Episode, EpisodeDetail, WordTrack } from './types'
import { PROGRAMS, type Program } from './programs'

export class PodcastError extends Error {
  constructor(message: string, readonly status = 502) { super(message) }
}

export async function fetchPodcastText(input: string, program: Program = PROGRAMS[0]): Promise<string> {
  let url = new URL(input)
  const signal = AbortSignal.timeout(10_000)
  try {
    for (let hop = 0; ; hop++) {
      if (!resourceUrl(url.href, program)) throw new PodcastError('节目资源地址不受支持')
      const res = await fetch(url, {
        redirect: 'manual', cache: 'no-store', signal,
        headers: { Accept: 'application/rss+xml, application/xml, text/plain;q=0.9', 'Cache-Control': 'no-cache' },
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location || hop >= 3) throw new PodcastError('节目资源重定向失败')
        url = new URL(location, url)
        continue
      }
      if (!res.ok) throw new PodcastError(`节目资源返回 ${res.status}`)
      const max = 2 * 1024 * 1024
      if (Number(res.headers.get('content-length')) > max) {
        await res.body?.cancel()
        throw new PodcastError('节目文本超过 2MB')
      }
      if (!res.body) throw new PodcastError('节目资源为空')
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > max) throw new PodcastError('节目文本超过 2MB')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      return new TextDecoder().decode(Buffer.concat(chunks))
    }
  } catch (error) {
    if (error instanceof PodcastError) throw error
    throw new PodcastError(signal.aborted ? '节目资源加载超时，请重试' : '节目资源加载失败，请重试')
  }
}

export async function loadCatalog(program: Program = PROGRAMS[0]): Promise<Episode[]> {
  const url = new URL(program.feed)
  url.searchParams.set('_refresh', String(Date.now()))
  return parseFeed(await fetchPodcastText(url.href, program), program)
}

export async function loadEpisode(id: string, program: Program = PROGRAMS[0]): Promise<EpisodeDetail> {
  const episode = (await loadCatalog(program)).find((e) => e.id === id)
  if (!episode) throw new PodcastError('节目不存在', 404)
  async function track(url: string | null, language: string) {
    if (!url) return { cues: [], error: `本期暂无${language}字幕` }
    try {
      const cues = parseSrt(await fetchPodcastText(url, program))
      return { cues, error: cues.length ? null : `${language}字幕没有有效时间段` }
    } catch { return { cues: [], error: `${language}字幕加载失败，请重试` } }
  }
  const [english, chinese] = await Promise.all([track(episode.english, '英文'), track(episode.chinese, '中文')])
  const cues = pairCues(english.cues, chinese.cues)
  return {
    episode, cues, englishError: english.error,
    chineseError: chinese.error ?? (cues.some((c) => !c.chineseText) ? '部分中文字幕不可用' : null),
  }
}

/** Optional enhancement: never delays the primary bilingual detail response. */
export async function loadWordTrack(id: string, program: Program = PROGRAMS[0]): Promise<WordTrack> {
  const episode = (await loadCatalog(program)).find((e) => e.id === id)
  if (!episode) throw new PodcastError('节目不存在', 404)
  if (!episode.englishWords) return { sourceUrl: null, cues: [] }
  const cues = parseSrt(await fetchPodcastText(episode.englishWords, program))
  if (!cues.length) throw new PodcastError('逐词字幕没有有效时间段')
  return { sourceUrl: episode.englishWords, cues }
}

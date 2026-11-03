import { it, expect } from 'vitest'
import { loadCatalog, loadEpisode, loadWordTrack } from './load'
import { alignWords } from './words'

it.skipIf(process.env.PODCAST_LIVE_TEST !== '1')('loads the real feed twice and pairs its latest bilingual episode', async () => {
  const first = await loadCatalog()
  const second = await loadCatalog()
  expect(first.length).toBeGreaterThan(0)
  expect(second[0].id).toBe(first[0].id)
  const bilingual = second.find((e) => e.english && e.chinese)
  expect(bilingual).toBeDefined()
  const detail = await loadEpisode(bilingual!.id)
  expect(detail.englishError).toBeNull()
  expect(detail.chineseError).toBeNull()
  expect(detail.cues.length).toBeGreaterThan(0)
  expect(detail.cues.every((c) => c.chineseText)).toBe(true)
  const res = await fetch(bilingual!.audio!, { headers: { Range: 'bytes=0-0' } })
  expect(res.status).toBe(206)
  await res.body?.cancel()
}, 30_000)

import { PROGRAMS } from './programs'
it.skipIf(process.env.PODCAST_LIVE_TEST !== '1')('loads each registered feed in its own program context', async () => {
  for (const program of PROGRAMS) {
    const catalog = await loadCatalog(program)
    expect(catalog.length).toBeGreaterThan(0)
    const detail = await loadEpisode(catalog[0].id, program)
    expect(detail.episode.audio).toContain(program.directory)
    expect(detail.englishError).toBeNull()
    expect(detail.cues.length).toBeGreaterThan(0)
    if (!detail.episode.chinese) expect(detail.chineseError).toContain('暂无')
    else expect(detail.cues.some((cue) => !!cue.chineseText)).toBe(true)
  }
}, 60_000)

it.skipIf(process.env.PODCAST_LIVE_TEST !== '1')('aligns the real three-track Daily News episode without changing sentence/Chinese timing', async () => {
  const catalog = await loadCatalog()
  const latest = catalog.find((episode) => episode.englishWords)
  expect(latest).toBeDefined()
  const [detail, track] = await Promise.all([loadEpisode(latest!.id), loadWordTrack(latest!.id)])
  expect(track.sourceUrl).toBe(latest!.englishWords)
  expect(latest!.english).not.toContain('.words.srt')
  const before = JSON.stringify(detail.cues)
  const alignment = alignWords(detail.cues, track.cues)
  expect(alignment.size, JSON.stringify(detail.cues.filter((cue) => !alignment.has(cue.id)))).toBe(detail.cues.length)
  expect([...alignment.values()].reduce((sum, sentence) => sum + sentence.words.length, 0)).toBe(track.cues.length)
  expect(detail.cues.every((cue) => cue.chineseText)).toBe(true)
  expect(JSON.stringify(detail.cues)).toBe(before)
  console.log(JSON.stringify({ episode: latest!.id, sentences: detail.cues.length, words: track.cues.length, aligned: alignment.size }))
}, 45_000)

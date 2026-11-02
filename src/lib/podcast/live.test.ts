import { it, expect } from 'vitest'
import { loadCatalog, loadEpisode } from './load'

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

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

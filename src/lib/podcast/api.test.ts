import { beforeEach, it, expect, vi } from 'vitest'
const { getUser, catalog, episode, words } = vi.hoisted(() => ({ getUser: vi.fn(), catalog: vi.fn(), episode: vi.fn(), words: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: { getUser } }) }))
vi.mock('@/lib/podcast/load', async (original) => ({ ...await original<typeof import('./load')>(), loadCatalog: catalog, loadEpisode: episode, loadWordTrack: words }))
import { GET as list } from '@/app/api/podcast/route'
import { GET as detail } from '@/app/api/podcast/[episodeId]/route'
import { PodcastError } from './load'
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('ALLOWED_EMAILS', ''); getUser.mockResolvedValue({ data: { user: { email: 'test@test.com' } } }) })
it('requires login and does not fetch feed for anonymous requests', async () => {
  getUser.mockResolvedValue({ data: { user: null } })
  expect((await list()).status).toBe(401)
  expect((await detail(new Request('http://x'), { params: Promise.resolve({ episodeId: 'a' }) })).status).toBe(401)
  expect(catalog).not.toHaveBeenCalled()
  expect(episode).not.toHaveBeenCalled()
})
it('enforces the existing allowlist', async () => {
  vi.stubEnv('ALLOWED_EMAILS', 'other@test.com')
  expect((await list()).status).toBe(403)
})
it('returns private no-store catalog and preserves per-track errors', async () => {
  catalog.mockResolvedValue([])
  const res = await list()
  expect(await res.json()).toEqual({ episodes: [] })
  expect(res.headers.get('Cache-Control')).toContain('no-store')
  episode.mockResolvedValue({ cues: [], chineseError: '暂无中文', englishError: null })
  const d = await detail(new Request('http://x'), { params: Promise.resolve({ episodeId: 'stable-id' }) })
  expect((await d.json()).chineseError).toBe('暂无中文')
  expect(episode).toHaveBeenCalledWith('stable-id')
})
it('returns 404 for unknown IDs and a retryable failure for upstream errors', async () => {
  episode.mockRejectedValue(new PodcastError('节目不存在', 404))
  expect((await detail(new Request('http://x'), { params: Promise.resolve({ episodeId: 'bad' }) })).status).toBe(404)
  catalog.mockRejectedValue(new Error('upstream'))
  expect((await list()).status).toBe(502)
})

import { GET as programList } from '@/app/api/podcast/shows/[programId]/route'
import { GET as programDetail } from '@/app/api/podcast/shows/[programId]/[episodeId]/route'
import { PROGRAMS } from './programs'
import { GET as wordTrack } from '@/app/api/podcast/shows/[programId]/[episodeId]/words/route'
it('protects and scopes optional word tracks, with independent errors and no-store', async () => {
  const request = new Request('http://x')
  const params = Promise.resolve({ programId: 'daily-news', episodeId: 'same' })
  getUser.mockResolvedValue({ data: { user: null } })
  expect((await wordTrack(request, { params })).status).toBe(401)
  expect(words).not.toHaveBeenCalled()
  getUser.mockResolvedValue({ data: { user: { email: 'test@test.com' } } })
  vi.stubEnv('ALLOWED_EMAILS', 'other@test.com')
  expect((await wordTrack(request, { params })).status).toBe(403)
  vi.stubEnv('ALLOWED_EMAILS', '')
  expect((await wordTrack(request, { params: Promise.resolve({ programId: 'unknown', episodeId: 'same' }) })).status).toBe(404)
  words.mockResolvedValue({ sourceUrl: null, cues: [] })
  const response = await wordTrack(request, { params })
  expect(await response.json()).toEqual({ sourceUrl: null, cues: [] })
  expect(response.headers.get('Cache-Control')).toContain('private, no-store')
  expect(words).toHaveBeenCalledWith('same', PROGRAMS[0])
  for (const status of [404, 502]) {
    words.mockRejectedValueOnce(new PodcastError('word track unavailable', status))
    expect((await wordTrack(request, { params })).status).toBe(status)
  }
})
it('scopes new routes to registered programs and rejects unknown programs after auth', async () => {
  const request = new Request('http://x')
  catalog.mockResolvedValue([]); episode.mockResolvedValue({ cues: [] })
  for (const program of PROGRAMS) {
    expect((await programList(request, { params: Promise.resolve({ programId: program.id }) })).status).toBe(200)
    expect(catalog).toHaveBeenLastCalledWith(program)
    expect((await programDetail(request, { params: Promise.resolve({ programId: program.id, episodeId: 'same' }) })).status).toBe(200)
    expect(episode).toHaveBeenLastCalledWith('same', program)
  }
  expect((await programList(request, { params: Promise.resolve({ programId: 'unknown' }) })).status).toBe(404)
  getUser.mockResolvedValue({ data: { user: null } })
  expect((await programList(request, { params: Promise.resolve({ programId: 'unknown' }) })).status).toBe(401)
})

import { afterEach, it, expect, vi } from 'vitest'
const { config, localStream, localEntry } = vi.hoisted(() => ({ config: vi.fn(), localStream: vi.fn(), localEntry: vi.fn() }))
vi.mock('./localModel', () => ({ getLocalModelConfig: config, streamLocalTranslate: localStream, generateLocalWordEntry: localEntry }))
import { streamTranslate } from './client'
import { lookupWordClient } from '@/lib/dict/clientLookup'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('passes optional signal to server lookup and translation without changing old signatures', async () => {
  config.mockReturnValue(null)
  const fetcher = vi.fn().mockImplementation(async (url: string) => url.includes('/word/') ? Response.json({ word: 'one' }) : new Response('data: {"type":"delta","value":"一"}\n'))
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController(), delta = vi.fn()
  await lookupWordClient('one', controller.signal)
  await streamTranslate('one sentence', 'en2zh', delta, undefined, controller.signal)
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal)
  expect(fetcher.mock.calls[1][1].signal).toBe(controller.signal)
  expect(delta).toHaveBeenCalledWith('一')
  await expect(lookupWordClient('one')).resolves.toMatchObject({ word: 'one' })
})
it('cancels the local stream and local word-generation branch', async () => {
  const local = { baseUrl: 'http://localhost:11434/v1', model: 'test' }
  config.mockReturnValue(local)
  localStream.mockImplementation(async function* () { yield '本地译文' })
  localEntry.mockResolvedValue(null)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ word: 'ontology', matchedFrom: 'none' })))
  const controller = new AbortController()
  await streamTranslate('test sentence', 'en2zh', vi.fn(), undefined, controller.signal)
  expect(localStream).toHaveBeenCalledWith('test sentence', 'en2zh', local, controller.signal)
  await lookupWordClient('ontology', controller.signal)
  expect(localEntry).toHaveBeenCalledWith('ontology', local, controller.signal)
})
it('does not surface a user-visible network error for cancelled translation', async () => {
  config.mockReturnValue(null)
  const controller = new AbortController(); controller.abort()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
  const delta = vi.fn()
  const result = await streamTranslate('test sentence', 'en2zh', delta, undefined, controller.signal)
  expect(result.error).toBeNull()
  expect(delta).not.toHaveBeenCalled()
})

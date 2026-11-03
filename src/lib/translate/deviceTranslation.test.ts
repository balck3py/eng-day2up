// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
let device: typeof import('./deviceTranslation')
const config = { baseUrl: 'https://model.example/v1', model: 'test-model', apiKey: 'test-key-not-real', disableThinking: true }
const sse = () => new Response('data: {"choices":[{"delta":{"reasoning_content":"ignored"}}]}\n\ndata: {"choices":[{"delta":{"content":"译文"}}]}\n\ndata: [DONE]\n')
beforeEach(async () => { vi.resetModules(); localStorage.clear(); device = await import('./deviceTranslation') })
afterEach(() => { device.clearDeviceConfig(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('defaults to Vercel, remembers only the choice, and shares a memory-only configuration preload', async () => {
  expect(device.getRequestSource()).toBe('vercel')
  device.setRequestSource('device')
  const fetcher = vi.fn().mockImplementation(async () => Response.json(config)); vi.stubGlobal('fetch', fetcher)
  const [a, b] = await Promise.all([device.getDeviceConfig(), device.getDeviceConfig()])
  expect(a).toBe(b); await device.getDeviceConfig()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1].cache).toBe('no-store')
  expect(localStorage.length).toBe(1)
  expect(localStorage.getItem('translationRequestSource')).toBe('device')
  expect(JSON.stringify(localStorage)).not.toContain(config.apiKey)
  device.setRequestSource('vercel')
  await device.getDeviceConfig(); expect(fetcher).toHaveBeenCalledTimes(2)
})

it('does not let a late response restore credentials after clearing the session', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r })).mockResolvedValue(Response.json({ ...config, model: 'new-model' })))
  const loading = device.getDeviceConfig()
  device.clearDeviceConfig(); resolve(Response.json(config))
  await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
  expect((await device.getDeviceConfig()).model).toBe('new-model')
})

it('cancels an individual waiter without cancelling a shared configuration load', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((r) => { resolve = r })); vi.stubGlobal('fetch', fetcher)
  const aborter = new AbortController()
  const a = device.getDeviceConfig(aborter.signal), b = device.getDeviceConfig()
  aborter.abort()
  await expect(a).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false)
  resolve(Response.json(config)); await expect(b).resolves.toEqual(config)
})

it('streams through the device endpoint with the server model parameters and retained quota', async () => {
  device.setRequestSource('device')
  const aborter = new AbortController()
  const fetcher = vi.fn().mockImplementation(async (url, options) => url === '/api/translate/config' ? Response.json(options?.method === 'POST' ? { ok: true } : config) : sse())
  vi.stubGlobal('fetch', fetcher)
  const { streamTranslate } = await import('./client')
  const delta = vi.fn()
  const result = await streamTranslate('An example sentence.', 'en2zh', delta, undefined, aborter.signal)
  expect(result).toEqual({ provider: 'device', error: null }); expect(delta).toHaveBeenCalledWith('译文')
  const [url, options] = fetcher.mock.calls.at(-1)!
  expect(url).toBe(config.baseUrl + '/chat/completions')
  expect(options.signal).toBe(aborter.signal)
  expect(options.headers.Authorization).toBe('Bearer ' + config.apiKey)
  expect(JSON.parse(options.body)).toMatchObject({ model: config.model, stream: true, thinking: { type: 'disabled' } })
  expect(fetcher.mock.calls.some(([url]) => url === '/api/translate')).toBe(false)
  expect(fetcher.mock.calls.some(([url, options]) => url === '/api/translate/config' && options.method === 'POST')).toBe(true)
})

it('does not contact the upstream when quota is denied', async () => {
  device.setRequestSource('device')
  const fetcher = vi.fn().mockImplementation(async (_url, options) => options?.method === 'POST' ? Response.json({ error: '今日配额已用完' }, { status: 429 }) : Response.json(config)); vi.stubGlobal('fetch', fetcher)
  const { streamTranslate } = await import('./client')
  expect((await streamTranslate('A sentence.', 'en2zh', vi.fn())).error).toBe('今日配额已用完')
  expect(fetcher.mock.calls.every(([url]) => url === '/api/translate/config')).toBe(true)
})

it('preserves custom-model precedence and its existing request format', async () => {
  device.setRequestSource('device')
  localStorage.setItem('localModelConfig', JSON.stringify({ baseUrl: 'http://localhost:11434/v1', model: 'custom' }))
  const fetcher = vi.fn().mockResolvedValue(sse()); vi.stubGlobal('fetch', fetcher)
  const { streamTranslate } = await import('./client')
  expect((await streamTranslate('A sentence.', 'en2zh', vi.fn())).provider).toBe('local')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('thinking')
})

it('reports CORS/network errors without silently changing request origin', async () => {
  device.setRequestSource('device')
  const fetcher = vi.fn().mockImplementation(async (url, options) => {
    if (url === '/api/translate/config') return Response.json(options?.method === 'POST' ? { ok: true } : config)
    throw new TypeError('Failed to fetch')
  }); vi.stubGlobal('fetch', fetcher)
  const { streamTranslate } = await import('./client')
  expect((await streamTranslate('A sentence.', 'en2zh', vi.fn())).error).toContain('CORS')
  expect(fetcher.mock.calls.some(([url]) => url === '/api/translate')).toBe(false)
})

it('always asks the device model for words, including repeated known words and spelling corrections, without consulting the dictionary', async () => {
  device.setRequestSource('device')
  const aborter = new AbortController()
  const fetcher = vi.fn().mockImplementation(async (url, options) => {
    if (url === '/api/translate/config') return Response.json(options?.method === 'POST' ? { ok: true } : config)
    if (url === config.baseUrl + '/chat/completions') return Response.json({ choices: [{ message: { content: JSON.stringify({ word: 'hello', phonetic: '/həˈləʊ/', senses: [{ pos: 'int.', meaning: '你好' }] }) } }] })
    throw new Error('Unexpected request: ' + url)
  }); vi.stubGlobal('fetch', fetcher)
  const { lookupWordClient } = await import('@/lib/dict/clientLookup')
  for (const word of ['Hello', 'Hello', 'Helo']) {
    expect(await lookupWordClient(word, aborter.signal)).toEqual({
      query: word, word: 'hello', correctedFrom: word === 'Helo' ? word : null,
      matchedFrom: 'ai', phonetic: '/həˈləʊ/', senses: [{ pos: 'int.', meaning: '你好' }],
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
      tags: [], collins: null, oxford: false,
    })
  }
  expect(fetcher.mock.calls.filter(([url]) => url === config.baseUrl + '/chat/completions')).toHaveLength(3)
  expect(fetcher.mock.calls.filter(([url, options]) => url === '/api/translate/config' && options?.method === 'POST')).toHaveLength(3)
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/word/') || url === '/api/ai-entry')).toBe(false)
  const upstream = fetcher.mock.calls.find(([url]) => url === config.baseUrl + '/chat/completions')!
  expect(JSON.parse(upstream[1].body)).toMatchObject({ stream: false, thinking: { type: 'disabled' } })
  expect(upstream[1].headers.Authorization).toBe('Bearer ' + config.apiKey)
  expect(upstream[1].signal).toBe(aborter.signal)
})

it.each(['quota', 'network', 'invalid', 'abort'])('does not fall back to a dictionary request on a device word %s failure', async (failure) => {
  device.setRequestSource('device')
  const aborter = new AbortController()
  const fetcher = vi.fn().mockImplementation(async (url, options) => {
    if (url === '/api/translate/config') return Response.json(options?.method !== 'POST' ? config : failure === 'quota' ? { error: '今日配额已用完' } : { ok: true }, { status: options?.method === 'POST' && failure === 'quota' ? 429 : 200 })
    if (failure === 'network') throw new TypeError('Failed to fetch')
    if (failure === 'abort') aborter.abort()
    return Response.json({ choices: [{ message: { content: failure === 'invalid' ? 'not JSON' : JSON.stringify({ word: 'hello', senses: [{ meaning: '你好' }] }) } }] })
  }); vi.stubGlobal('fetch', fetcher)
  const { lookupWordClient } = await import('@/lib/dict/clientLookup')
  expect(await lookupWordClient('Hello', aborter.signal)).toBeNull()
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/word/') || url === '/api/ai-entry')).toBe(false)
  if (failure === 'quota') expect(fetcher.mock.calls.every(([url]) => url === '/api/translate/config')).toBe(true)
})

it('retains the server word lookup when device mode is off and restores it after switching off', async () => {
  const detail = { word: 'hello', matchedFrom: 'exact', senses: [{ meaning: '词库释义' }] }
  const fetcher = vi.fn().mockImplementation(async () => Response.json(detail)); vi.stubGlobal('fetch', fetcher)
  const { lookupWordClient } = await import('@/lib/dict/clientLookup')
  expect(await lookupWordClient('Hello')).toEqual(detail)
  device.setRequestSource('device'); device.setRequestSource('vercel')
  expect(await lookupWordClient('Hello')).toEqual(detail)
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/word/Hello', '/api/word/Hello'])
})

it('uses a custom model directly in device mode while preserving its dictionary-first behavior when the switch is off', async () => {
  localStorage.setItem('localModelConfig', JSON.stringify({ baseUrl: 'http://localhost:11434/v1', model: 'custom' }))
  const fetcher = vi.fn().mockImplementation(async (url) => url.startsWith('/api/word/')
    ? Response.json({ word: 'hello', matchedFrom: 'exact', senses: [{ meaning: '词库释义' }] })
    : Response.json({ choices: [{ message: { content: JSON.stringify({ word: 'hello', senses: [{ meaning: '自定义模型释义' }] }) } }] }))
  vi.stubGlobal('fetch', fetcher)
  const { lookupWordClient } = await import('@/lib/dict/clientLookup')
  expect((await lookupWordClient('Hello'))?.matchedFrom).toBe('exact')
  device.setRequestSource('device'); fetcher.mockClear()
  expect((await lookupWordClient('Hello'))?.senses[0].meaning).toBe('自定义模型释义')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseDictApi, getPhonetics } from './dictapi'

const EMPTY = { phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null }

describe('parseDictApi', () => {
  it('按音频文件名区分美英', () => {
    const json = [{
      phonetics: [
        { text: '/həˈləʊ/', audio: 'https://x/hello-uk.mp3' },
        { text: '/həˈloʊ/', audio: 'https://x/hello-us.mp3' },
      ],
    }]
    expect(parseDictApi(json)).toEqual({
      phoneticUs: '/həˈloʊ/',
      phoneticUk: '/həˈləʊ/',
      audioUs: 'https://x/hello-us.mp3',
      audioUk: 'https://x/hello-uk.mp3',
    })
  })

  it('只有无标记音标时，美英同时回退到它', () => {
    const json = [{ phonetics: [{ text: '/wɜːd/', audio: '' }] }]
    expect(parseDictApi(json)).toEqual({
      phoneticUs: '/wɜːd/',
      phoneticUk: '/wɜːd/',
      audioUs: null,
      audioUk: null,
    })
  })

  it('只有美音时英音回退到无标记音标', () => {
    const json = [{
      phonetics: [
        { text: '/fɔːlbæk/', audio: '' },
        { text: '/ˈjuːɛs/', audio: 'https://x/w-us.mp3' },
      ],
    }]
    const r = parseDictApi(json)
    expect(r.phoneticUs).toBe('/ˈjuːɛs/')
    expect(r.audioUs).toBe('https://x/w-us.mp3')
    expect(r.phoneticUk).toBe('/fɔːlbæk/')
    expect(r.audioUk).toBeNull()
  })

  it('有音频无文本时不编造音标', () => {
    const json = [{ phonetics: [{ text: '', audio: 'https://x/w-us.mp3' }] }]
    const r = parseDictApi(json)
    expect(r.audioUs).toBe('https://x/w-us.mp3')
    expect(r.phoneticUs).toBeNull()
  })

  it('取每个方言的第一个音标，忽略后续', () => {
    const json = [{
      phonetics: [
        { text: '/first/', audio: 'https://x/a-us.mp3' },
        { text: '/second/', audio: 'https://x/b-us.mp3' },
      ],
    }]
    const r = parseDictApi(json)
    expect(r.phoneticUs).toBe('/first/')
    expect(r.audioUs).toBe('https://x/a-us.mp3')
  })

  it('跨多个词条合并', () => {
    const json = [
      { phonetics: [{ text: '/uk/', audio: 'https://x/a-uk.mp3' }] },
      { phonetics: [{ text: '/us/', audio: 'https://x/a-us.mp3' }] },
    ]
    const r = parseDictApi(json)
    expect(r.phoneticUk).toBe('/uk/')
    expect(r.phoneticUs).toBe('/us/')
  })

  it('空数组返回全 null', () => {
    expect(parseDictApi([])).toEqual({
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  })

  it('非数组输入返回全 null', () => {
    expect(parseDictApi({ title: 'No Definitions Found' })).toEqual({
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  })

  it('缺少 phonetics 字段不抛异常', () => {
    expect(() => parseDictApi([{ word: 'x' }])).not.toThrow()
  })

  it('phonetics 非数组不抛异常', () => {
    expect(() => parseDictApi([{ phonetics: 'oops' }])).not.toThrow()
  })

  it('phonetics 数组内含 null 元素不抛异常，返回全 null', () => {
    expect(() => parseDictApi([{ phonetics: [null] }])).not.toThrow()
    expect(parseDictApi([{ phonetics: [null] }])).toEqual(EMPTY)
  })

  it('phonetics 数组内含 undefined 元素不抛异常，返回全 null', () => {
    expect(() => parseDictApi([{ phonetics: [undefined] }])).not.toThrow()
    expect(parseDictApi([{ phonetics: [undefined] }])).toEqual(EMPTY)
  })

  it('phonetics 数组内含非对象元素（字符串）不抛异常，返回全 null', () => {
    expect(() => parseDictApi([{ phonetics: ['not-an-object'] }])).not.toThrow()
    expect(parseDictApi([{ phonetics: ['not-an-object'] }])).toEqual(EMPTY)
  })

  it('phonetics 元素的 text 字段类型非法（数字）时忽略，不抛异常', () => {
    expect(() => parseDictApi([{ phonetics: [{ text: 123 }] }])).not.toThrow()
    expect(parseDictApi([{ phonetics: [{ text: 123 }] }])).toEqual(EMPTY)
  })

  it('空对象输入返回全 null', () => {
    expect(parseDictApi({})).toEqual(EMPTY)
  })

  it('空数组输入返回全 null（重复确认）', () => {
    expect(parseDictApi([])).toEqual(EMPTY)
  })

  it('"未找到释义" 形状的响应返回全 null', () => {
    expect(parseDictApi([{ title: 'No Definitions Found' }])).toEqual(EMPTY)
  })
})

/** 构造一个手写的 SupabaseClient 桩，只实现 getPhonetics 用到的链式调用。 */
function createStubAdmin(cachedRow: Record<string, unknown> | null) {
  const upsertCalls: Record<string, unknown>[] = []
  const admin = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: cachedRow, error: null }),
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        upsertCalls.push(row)
        return { data: null, error: null }
      },
    }),
  }
  return { admin: admin as unknown as SupabaseClient, upsertCalls }
}

describe('getPhonetics', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('新鲜缓存命中时直接返回，不发起请求', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    const { admin } = createStubAdmin({
      word_key: 'hello',
      phonetic_us: '/həˈloʊ/',
      phonetic_uk: '/həˈləʊ/',
      audio_us: 'https://x/hello-us.mp3',
      audio_uk: 'https://x/hello-uk.mp3',
      found: true,
      fetched_at: new Date().toISOString(),
    })

    const result = await getPhonetics(admin, 'hello')

    expect(result).toEqual({
      phoneticUs: '/həˈloʊ/',
      phoneticUk: '/həˈləʊ/',
      audioUs: 'https://x/hello-us.mp3',
      audioUk: 'https://x/hello-uk.mp3',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('缓存过期时触发重新抓取', async () => {
    const staleDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    const { admin, upsertCalls } = createStubAdmin({
      word_key: 'hello',
      phonetic_us: '/old-us/',
      phonetic_uk: '/old-uk/',
      audio_us: 'https://x/old-us.mp3',
      audio_uk: 'https://x/old-uk.mp3',
      found: true,
      fetched_at: staleDate,
    })

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        phonetics: [
          { text: '/new-us/', audio: 'https://x/new-us.mp3' },
        ],
      }],
    }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const result = await getPhonetics(admin, 'hello')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.phoneticUs).toBe('/new-us/')
    expect(result.audioUs).toBe('https://x/new-us.mp3')
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toMatchObject({ word_key: 'hello', found: true })
  })

  it('found=false 且在 TTL 内时短路返回空结果，不发起请求', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    const { admin } = createStubAdmin({
      word_key: 'zzzznotaword',
      phonetic_us: null,
      phonetic_uk: null,
      audio_us: null,
      audio_uk: null,
      found: false,
      fetched_at: new Date().toISOString(),
    })

    const result = await getPhonetics(admin, 'zzzznotaword')

    expect(result).toEqual(EMPTY)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('API 返回 404 时写入负缓存', async () => {
    const { admin, upsertCalls } = createStubAdmin(null)

    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const result = await getPhonetics(admin, 'zzzznotaword')

    expect(result).toEqual(EMPTY)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toMatchObject({ word_key: 'zzzznotaword', found: false })
  })

  it('网络错误 / 超时时返回空结果，且不写缓存', async () => {
    const { admin, upsertCalls } = createStubAdmin(null)

    const fetchSpy = vi.fn(async () => {
      throw new Error('network down')
    })
    global.fetch = fetchSpy as unknown as typeof fetch

    const result = await getPhonetics(admin, 'hello')

    expect(result).toEqual(EMPTY)
    expect(upsertCalls).toHaveLength(0)
  })

  it('响应体解析异常（parseDictApi 抛出）时被 try/catch 兜住，返回空结果且不写缓存', async () => {
    const { admin, upsertCalls } = createStubAdmin(null)

    // 即便上游 JSON 形状异常导致解析逻辑出错，也不应打穿整个请求。
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('malformed body')
      },
    }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const result = await getPhonetics(admin, 'hello')

    expect(result).toEqual(EMPTY)
    expect(upsertCalls).toHaveLength(0)
  })
})

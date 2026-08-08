import { describe, it, expect, vi, beforeEach } from 'vitest'

// 三个依赖全部 mock：createServerSupabase / createAdminSupabase / lookupWord。
// 不需要网络，也不依赖 dict_entries 是否已导入数据。
const { getUserMock, createAdminMock, lookupWordMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  createAdminMock: vi.fn(() => ({ __fake: 'admin-db' })),
  lookupWordMock: vi.fn(async (_db: unknown, raw: string) => ({
    query: raw, word: raw.toLowerCase(), matchedFrom: 'none' as const,
    phonetic: null, phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    senses: [], tags: [], collins: null, oxford: false,
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: createAdminMock,
}))
vi.mock('@/lib/dict/lookup', () => ({ lookupWord: lookupWordMock }))

import { GET } from './route'

function ctx(word: string) {
  return { params: Promise.resolve({ word }) }
}

const AUTHED = { data: { user: { id: 'u1' } } }
const ANON = { data: { user: null } }

beforeEach(() => {
  getUserMock.mockReset()
  createAdminMock.mockClear()
  lookupWordMock.mockClear()
})

describe('GET /api/word/[word]', () => {
  it('401 未登录时不查库', async () => {
    getUserMock.mockResolvedValueOnce(ANON)
    const res = await GET(new Request('http://x/api/word/apple'), ctx('apple'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未登录' })
    expect(lookupWordMock).not.toHaveBeenCalled()
  })

  it('400 当 word 为空白', async () => {
    getUserMock.mockResolvedValueOnce(AUTHED)
    const res = await GET(new Request('http://x/api/word/'), ctx('   '))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '缺少查询词' })
    expect(lookupWordMock).not.toHaveBeenCalled()
  })

  it('200 正常路径：用 admin 客户端、trim 后的词调用 lookupWord', async () => {
    getUserMock.mockResolvedValueOnce(AUTHED)
    const res = await GET(new Request('http://x/api/word/apple'), ctx('  apple  '))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('apple')
    expect(createAdminMock).toHaveBeenCalledTimes(1)
    expect(lookupWordMock).toHaveBeenCalledWith({ __fake: 'admin-db' }, 'apple')
  })

  it('回归用例：字面 "%" 不再触发 decodeURIComponent 抛出，正常返回 JSON', async () => {
    // Next 路由匹配阶段已解码过一次，"100%" 会作为已解码值原样交给 params。
    // 之前的实现在这里又调用了一次 decodeURIComponent，对 "100%" 会抛出
    // URIError（"%" 后面不是合法的两位十六进制转义）。修复后不应再抛出。
    getUserMock.mockResolvedValueOnce(AUTHED)
    const res = await GET(new Request('http://x/api/word/100%25'), ctx('100%'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('100%')
    expect(lookupWordMock).toHaveBeenCalledWith({ __fake: 'admin-db' }, '100%')
  })

  it('不做二次解码：已解码的 "+" 和空格原样传递，不被当成新一轮转义处理', async () => {
    // 若代码错误地对已解码值再调用一次 decodeURIComponent，"+" 本身在
    // decodeURIComponent 语义下是字面量（不同于 decodeURI 的表单编码），
    // 不会报错也不会变化，因此这条用例真正验证的是空格与内容都原样透传，
    // 不存在任何形式的重复解码/转换。
    getUserMock.mockResolvedValueOnce(AUTHED)
    const res = await GET(new Request('http://x/api/word/foo+bar'), ctx('foo+bar baz'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('foo+bar baz')
    expect(lookupWordMock).toHaveBeenCalledWith({ __fake: 'admin-db' }, 'foo+bar baz')
  })
})

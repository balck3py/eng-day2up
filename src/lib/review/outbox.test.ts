import { describe, it, expect } from 'vitest'
import { classify, enqueue, flushOutbox, readOutbox, sendItem, type FetchLike } from './outbox'
import { memoryStorage } from './storage'

const mark = (id: string) =>
  ({ kind: 'mark', id, known: true, quizType: 'en2cn', reviewedAt: '2026-10-21T13:00:00Z' }) as const

/** 按请求体里的 id 返回预设状态码，并记下发过的请求 */
function fakeFetch(statusById: Record<string, number | 'throw'>) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fn: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ url, body })
    const s = statusById[String(body.id ?? 'leftover')] ?? 200
    if (s === 'throw') throw new TypeError('network')
    return { status: s }
  }
  return { fn, calls }
}

describe('classify', () => {
  it('按状态码分类', () => {
    expect(classify(200)).toBe('ok')
    expect(classify(401)).toBe('auth')
    expect(classify(500)).toBe('retry')
    expect(classify(404)).toBe('drop')
    expect(classify(400)).toBe('drop')
  })
})

describe('sendItem', () => {
  it('网络异常算 retry', async () => {
    const { fn } = fakeFetch({ a: 'throw' })
    expect(await sendItem(mark('a'), fn)).toBe('retry')
  })
  it('判定带上作答时间，名单走 PUT', async () => {
    const { fn, calls } = fakeFetch({})
    await sendItem(mark('a'), fn)
    await sendItem({ kind: 'leftover', ids: ['x'] }, fn)
    expect(calls[0]).toMatchObject({ url: '/api/review/mark', body: { reviewedAt: '2026-10-21T13:00:00Z' } })
    expect(calls[1]).toMatchObject({ url: '/api/review/leftover', body: { ids: ['x'] } })
  })
})

describe('enqueue', () => {
  it('名单只留最新一条，判定全部保留', () => {
    const kv = memoryStorage()
    enqueue(mark('a'), kv)
    enqueue({ kind: 'leftover', ids: ['1'] }, kv)
    enqueue(mark('b'), kv)
    enqueue({ kind: 'leftover', ids: ['2'] }, kv)
    const q = readOutbox(kv)
    expect(q.map((x) => (x.kind === 'mark' ? x.id : x.ids[0]))).toEqual(['a', 'b', '2'])
  })
})

describe('flushOutbox', () => {
  it('成功与 drop 的移除，retry 的保留', async () => {
    const kv = memoryStorage()
    ;['a', 'b', 'c'].forEach((id) => enqueue(mark(id), kv))
    const { fn } = fakeFetch({ a: 200, b: 500, c: 404 })
    const r = await flushOutbox(fn, kv)
    expect(r).toEqual({ remaining: 1, authExpired: false })
    expect(readOutbox(kv).map((x) => x.kind === 'mark' && x.id)).toEqual(['b'])
  })
  it('遇到 401 停下，后面的不发', async () => {
    const kv = memoryStorage()
    ;['a', 'b', 'c'].forEach((id) => enqueue(mark(id), kv))
    const { fn, calls } = fakeFetch({ b: 401 })
    const r = await flushOutbox(fn, kv)
    expect(r).toEqual({ remaining: 2, authExpired: true })
    expect(calls.map((c) => c.body.id)).toEqual(['a', 'b'])
  })
  it('补写途中新入队的不会被冲掉', async () => {
    const kv = memoryStorage()
    enqueue(mark('a'), kv)
    const fn: FetchLike = async () => {
      enqueue(mark('late'), kv)
      return { status: 200 }
    }
    await flushOutbox(fn, kv)
    expect(readOutbox(kv).map((x) => x.kind === 'mark' && x.id)).toContain('late')
  })
})

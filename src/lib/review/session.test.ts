import { describe, it, expect } from 'vitest'
import {
  clearSession,
  isExpired,
  loadSession,
  restoreSession,
  saveSession,
  SESSION_TTL_MS,
  type SavedSession,
} from './session'
import { memoryStorage } from './storage'

function saved(over: Partial<SavedSession> = {}): SavedSession {
  return {
    v: 1,
    kind: 'regular',
    limit: 10,
    mustDo: 2,
    cursor: 3,
    cards: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'en2cn' as const })),
    verdicts: { 0: true, 1: false, 2: false },
    marked: { 0: true, 1: false, 2: false },
    startedAt: 1000,
    ...over,
  }
}
const entries = (ids: string[]) => ids.map((id) => ({ id, word: id }))

describe('存档读写', () => {
  it('写入后读得回来，清除后为空', () => {
    const kv = memoryStorage()
    saveSession(saved(), kv)
    expect(loadSession(kv)?.cursor).toBe(3)
    clearSession(kv)
    expect(loadSession(kv)).toBeNull()
  })
  it('格式不对当没有存档', () => {
    const kv = memoryStorage()
    kv.setItem('review-session-v1', '{"v":2}')
    expect(loadSession(kv)).toBeNull()
    kv.setItem('review-session-v1', 'not json')
    expect(loadSession(kv)).toBeNull()
  })
  it('没有 storage 也不抛', () => {
    expect(loadSession(null)).toBeNull()
    expect(() => saveSession(saved(), null)).not.toThrow()
  })
})

describe('isExpired', () => {
  it('3 天内未过期，超过即过期', () => {
    expect(isExpired(saved({ startedAt: 0 }), SESSION_TTL_MS)).toBe(false)
    expect(isExpired(saved({ startedAt: 0 }), SESSION_TTL_MS + 1)).toBe(true)
  })
})

describe('restoreSession', () => {
  it('词都在：原样恢复，用最新词条', () => {
    const all = entries(['a', 'b', 'c', 'd', 'e'])
    const r = restoreSession(saved(), all)!
    expect(r.cards.map((c) => c.item)).toEqual(all)
    expect(r.cursor).toBe(3)
    expect(r.mustDo).toBe(2)
    expect(r.verdicts).toEqual({ 0: true, 1: false, 2: false })
  })
  it('删掉的词连同判定剔除，其余重新编号', () => {
    const r = restoreSession(saved(), entries(['a', 'c', 'd', 'e']))!
    expect(r.cards.map((c) => c.item.id)).toEqual(['a', 'c', 'd', 'e'])
    expect(r.verdicts).toEqual({ 0: true, 1: false })
    expect(r.marked).toEqual({ 0: true, 1: false })
    expect(r.cursor).toBe(2) // 原来停在 d，d 现在是第 2 张
    expect(r.mustDo).toBe(1) // 必修的 a、b 只剩 a
  })
  it('cursor 所在的卡被删：顺延到下一张', () => {
    const r = restoreSession(saved(), entries(['a', 'b', 'c', 'e']))!
    expect(r.cards[r.cursor].item.id).toBe('e')
  })
  it('cursor 之后都被删：停在最后一张', () => {
    const r = restoreSession(saved(), entries(['a', 'b', 'c']))!
    expect(r.cursor).toBe(2)
  })
  it('全被删光返回 null', () => {
    expect(restoreSession(saved(), entries([]))).toBeNull()
  })
})

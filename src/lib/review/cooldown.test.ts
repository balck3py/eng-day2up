import { describe, it, expect } from 'vitest'
import { inCooldown, MASTERED_COOLDOWN_MS } from './cooldown'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-10-22T12:00:00Z')
const ago = (days: number) => new Date(now - days * DAY).toISOString()

describe('inCooldown', () => {
  it('满值、3 天前复习过：在冷却期', () => {
    expect(inCooldown({ familiarity: 5, lastReviewedAt: ago(3) }, now)).toBe(true)
  })
  it('满值、15 天前复习过：冷却期满', () => {
    expect(inCooldown({ familiarity: 5, lastReviewedAt: ago(15) }, now)).toBe(false)
  })
  it('恰好满 14 天：冷却期满', () => {
    expect(inCooldown({ familiarity: 5, lastReviewedAt: new Date(now - MASTERED_COOLDOWN_MS).toISOString() }, now)).toBe(false)
  })
  it('熟练度 4 不冷却', () => {
    expect(inCooldown({ familiarity: 4, lastReviewedAt: ago(1) }, now)).toBe(false)
  })
  it('时间戳为空或不可解析不冷却', () => {
    expect(inCooldown({ familiarity: 5, lastReviewedAt: null }, now)).toBe(false)
    expect(inCooldown({ familiarity: 5, lastReviewedAt: 'not-a-date' }, now)).toBe(false)
  })
})

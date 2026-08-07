import { describe, it, expect } from 'vitest'
import { nextFamiliarity } from './mark'

describe('nextFamiliarity', () => {
  it('认识则加一', () => {
    expect(nextFamiliarity(2, true)).toBe(3)
  })
  it('不认识则减一', () => {
    expect(nextFamiliarity(2, false)).toBe(1)
  })
  it('上限封顶为 5', () => {
    expect(nextFamiliarity(5, true)).toBe(5)
  })
  it('下限兜底为 0', () => {
    expect(nextFamiliarity(0, false)).toBe(0)
  })
  it('从 0 认识一次到 1', () => {
    expect(nextFamiliarity(0, true)).toBe(1)
  })
  it('从 4 认识一次到 5（进入已掌握）', () => {
    expect(nextFamiliarity(4, true)).toBe(5)
  })
  it('超出范围的输入被夹回区间', () => {
    expect(nextFamiliarity(99, true)).toBe(5)
    expect(nextFamiliarity(-5, false)).toBe(0)
  })
})

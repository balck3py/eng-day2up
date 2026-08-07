import { describe, it, expect } from 'vitest'
import { scoreWord, selectHardWords } from './score'
import type { ScoreInput } from './score'

function input(o: Partial<ScoreInput> = {}): ScoreInput {
  return {
    key: 'w', index: 0, frq: null, bnc: null, oxford: null,
    collins: null, inDict: true, familiarity: null, ...o,
  }
}

describe('scoreWord', () => {
  it('不在词库中的词得最高分', () => {
    expect(scoreWord(input({ inDict: false }))).toBe(1000)
  })
  it('词频排名越靠后分越高', () => {
    const common = scoreWord(input({ frq: 500 }))
    const rare = scoreWord(input({ frq: 20000 }))
    expect(rare).toBeGreaterThan(common)
  })
  it('词频得分有上限 500', () => {
    expect(scoreWord(input({ frq: 999999 }))).toBeLessThanOrEqual(500)
  })
  it('frq 与 bnc 取较小者（更常见者）', () => {
    expect(scoreWord(input({ frq: 30000, bnc: 500 })))
      .toBe(scoreWord(input({ frq: 500 })))
  })
  it('两者皆无时按 20000 计', () => {
    expect(scoreWord(input())).toBe(scoreWord(input({ frq: 20000 })))
  })
  it('牛津核心词降分', () => {
    expect(scoreWord(input({ frq: 20000, oxford: 1 })))
      .toBe(scoreWord(input({ frq: 20000 })) - 100)
  })
  it('柯林斯 5 星降 80 分', () => {
    expect(scoreWord(input({ frq: 20000, collins: 5 })))
      .toBe(scoreWord(input({ frq: 20000 })) - 80)
  })
  it('柯林斯 3 星降 40 分', () => {
    expect(scoreWord(input({ frq: 20000, collins: 3 })))
      .toBe(scoreWord(input({ frq: 20000 })) - 40)
  })
  it('已掌握的词返回 -1（排除）', () => {
    expect(scoreWord(input({ familiarity: 4 }))).toBe(-1)
    expect(scoreWord(input({ familiarity: 5 }))).toBe(-1)
  })
  it('已收藏未掌握的词提权 200', () => {
    expect(scoreWord(input({ frq: 20000, familiarity: 1 })))
      .toBe(scoreWord(input({ frq: 20000 })) + 200)
  })
  it('不在词库但已掌握，仍然排除', () => {
    expect(scoreWord(input({ inDict: false, familiarity: 5 }))).toBe(-1)
  })
})

describe('selectHardWords', () => {
  it('取分值最高的前 N 个', () => {
    const items = [
      input({ key: 'easy', index: 0, frq: 100 }),
      input({ key: 'hard', index: 1, inDict: false }),
      input({ key: 'mid', index: 2, frq: 30000 }),
    ]
    expect(selectHardWords(items, 2).map((i) => i.key)).toEqual(['hard', 'mid'])
  })
  it('结果按原文出现顺序排列', () => {
    const items = [
      input({ key: 'mid', index: 0, frq: 30000 }),
      input({ key: 'easy', index: 1, frq: 100 }),
      input({ key: 'hard', index: 2, inDict: false }),
    ]
    expect(selectHardWords(items, 2).map((i) => i.key)).toEqual(['mid', 'hard'])
  })
  it('排除已掌握的词', () => {
    const items = [
      input({ key: 'known', index: 0, inDict: false, familiarity: 5 }),
      input({ key: 'new', index: 1, frq: 30000 }),
    ]
    expect(selectHardWords(items, 5).map((i) => i.key)).toEqual(['new'])
  })
  it('候选不足时返回全部', () => {
    expect(selectHardWords([input({ frq: 30000 })], 12)).toHaveLength(1)
  })
  it('空输入返回空数组', () => {
    expect(selectHardWords([], 12)).toEqual([])
  })
  it('limit 为 0 时返回空数组', () => {
    expect(selectHardWords([input({ inDict: false })], 0)).toEqual([])
  })
})

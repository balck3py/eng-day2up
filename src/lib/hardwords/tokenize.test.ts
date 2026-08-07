import { describe, it, expect } from 'vitest'
import { tokenize } from './tokenize'

describe('tokenize', () => {
  it('切出英文单词并小写化', () => {
    expect(tokenize('Hello World').map((t) => t.key)).toEqual(['hello', 'world'])
  })
  it('保留原始形态', () => {
    expect(tokenize('Hello')[0].surface).toBe('Hello')
  })
  it('剔除停用词', () => {
    expect(tokenize('the committee of a review').map((t) => t.key))
      .toEqual(['committee', 'review'])
  })
  it('忽略标点', () => {
    expect(tokenize('deferred, pending.').map((t) => t.key))
      .toEqual(['deferred', 'pending'])
  })
  it('忽略中文', () => {
    expect(tokenize('委员会 deferred 决定').map((t) => t.key)).toEqual(['deferred'])
  })
  it('忽略纯数字', () => {
    expect(tokenize('2024 review').map((t) => t.key)).toEqual(['review'])
  })
  it('保留词内连字符', () => {
    expect(tokenize('well-known').map((t) => t.key)).toEqual(['well-known'])
  })
  it('剔除单字母词', () => {
    expect(tokenize('a b committee').map((t) => t.key)).toEqual(['committee'])
  })
  it('同一个词重复出现只保留首次', () => {
    const out = tokenize('review the review again')
    expect(out.filter((t) => t.key === 'review')).toHaveLength(1)
  })
  it('index 反映出现顺序', () => {
    const out = tokenize('alpha beta gamma')
    expect(out.map((t) => t.index)).toEqual([0, 1, 2])
  })
  it('空文本返回空数组', () => {
    expect(tokenize('')).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { shouldSaveLeftover, unknownIds } from './leftover'

const cards = ['a', 'b', 'c', 'd'].map((id) => ({ item: { id } }))

describe('unknownIds', () => {
  it('只取答不出来的，按出卡顺序', () => {
    expect(unknownIds({ 2: false, 0: false, 1: true }, cards)).toEqual(['a', 'c'])
  })
  it('同一个词出现两次只记一次', () => {
    const dup = [{ item: { id: 'a' } }, { item: { id: 'a' } }]
    expect(unknownIds({ 0: false, 1: false }, dup)).toEqual(['a'])
  })
  it('越界下标忽略', () => {
    expect(unknownIds({ 9: false }, cards)).toEqual([])
  })
})

describe('shouldSaveLeftover', () => {
  it('常规复习有生词：覆盖', () => {
    expect(shouldSaveLeftover('regular', { 0: true, 1: false })).toBe(true)
  })
  it('常规复习零生词：不覆盖', () => {
    expect(shouldSaveLeftover('regular', { 0: true })).toBe(false)
    expect(shouldSaveLeftover('regular', {})).toBe(false)
  })
  it('重练与复习上一轮生词：不覆盖', () => {
    expect(shouldSaveLeftover('repeat', { 0: false })).toBe(false)
    expect(shouldSaveLeftover('leftover', { 0: false })).toBe(false)
  })
})

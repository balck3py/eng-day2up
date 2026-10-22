import { describe, it, expect } from 'vitest'
import { stripSuffixCandidates } from './inflect'

describe('stripSuffixCandidates', () => {
  it('双写辅音的现在分词还原', () => {
    expect(stripSuffixCandidates('running')).toContain('run')
  })
  it('普通现在分词还原', () => {
    expect(stripSuffixCandidates('working')).toContain('work')
  })
  it('去 e 的现在分词还原', () => {
    expect(stripSuffixCandidates('making')).toContain('make')
  })
  it('ies 复数还原', () => {
    expect(stripSuffixCandidates('studies')).toContain('study')
  })
  it('es 复数还原', () => {
    expect(stripSuffixCandidates('boxes')).toContain('box')
  })
  it('s 复数还原', () => {
    expect(stripSuffixCandidates('cats')).toContain('cat')
  })
  it('过去式还原', () => {
    expect(stripSuffixCandidates('worked')).toContain('work')
  })
  it('去 e 的过去式还原', () => {
    expect(stripSuffixCandidates('loved')).toContain('love')
  })
  it('ily 副词还原为 y 结尾', () => {
    expect(stripSuffixCandidates('happily')).toContain('happy')
  })
  it('ly 副词还原', () => {
    expect(stripSuffixCandidates('quickly')).toContain('quick')
  })
  it('比较级还原', () => {
    expect(stripSuffixCandidates('smaller')).toContain('small')
  })
  it('最高级还原', () => {
    expect(stripSuffixCandidates('smallest')).toContain('small')
  })
  it('不把 ss 结尾误判为复数', () => {
    expect(stripSuffixCandidates('glass')).not.toContain('glas')
  })
  it('太短的词不处理', () => {
    expect(stripSuffixCandidates('is')).toEqual([])
  })
  it('结果不含原词本身', () => {
    expect(stripSuffixCandidates('running')).not.toContain('running')
  })
  it('结果去重', () => {
    const out = stripSuffixCandidates('studies')
    expect(out.length).toBe(new Set(out).size)
  })
  it('大写输入按小写处理', () => {
    expect(stripSuffixCandidates('Running')).toContain('run')
  })
  it('候选顺序：哑音 e 还原（现在分词）排在直接去后缀之前，caring → care 先于 car', () => {
    const out = stripSuffixCandidates('caring')
    expect(out.indexOf('care')).toBeLessThan(out.indexOf('car'))
  })
  it('候选顺序：哑音 e 还原（过去式）排在直接去后缀之前，cared → care 先于 car', () => {
    const out = stripSuffixCandidates('cared')
    expect(out.indexOf('care')).toBeLessThan(out.indexOf('car'))
  })
  it('候选顺序：双写辅音还原排在未变形词干之前，running → run 先于 runn', () => {
    const out = stripSuffixCandidates('running')
    expect(out.indexOf('run')).toBeLessThan(out.indexOf('runn'))
  })
})

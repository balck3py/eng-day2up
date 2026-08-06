import { describe, it, expect } from 'vitest'
import { parseExchange } from './exchange'

describe('parseExchange', () => {
  it('把各种变形映射回原型', () => {
    const pairs = parseExchange('say', 'p:said/d:said/i:saying/3:says')
    expect(pairs).toEqual(
      expect.arrayContaining([
        { form: 'said', lemma: 'say' },
        { form: 'saying', lemma: 'say' },
        { form: 'says', lemma: 'say' },
      ]),
    )
  })

  it('去重重复的变形', () => {
    const pairs = parseExchange('say', 'p:said/d:said')
    expect(pairs).toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('键 0 表示方向相反：word 本身是变形', () => {
    expect(parseExchange('said', '0:say/1:p'))
      .toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('忽略键 1', () => {
    const pairs = parseExchange('said', '0:say/1:p')
    expect(pairs.some((p) => p.lemma === 'p')).toBe(false)
  })

  it('处理比较级与最高级', () => {
    expect(parseExchange('good', 'r:better/t:best')).toEqual(
      expect.arrayContaining([
        { form: 'better', lemma: 'good' },
        { form: 'best', lemma: 'good' },
      ]),
    )
  })

  it('统一小写', () => {
    expect(parseExchange('Say', 'p:Said')).toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('跳过与原词相同的映射', () => {
    expect(parseExchange('cut', 'p:cut/d:cut')).toEqual([])
  })

  it('空 exchange 返回空数组', () => {
    expect(parseExchange('word', '')).toEqual([])
  })

  it('忽略没有冒号的片段', () => {
    expect(parseExchange('say', 'garbage/p:said'))
      .toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('忽略值为空的片段', () => {
    expect(parseExchange('say', 'p:/d:said'))
      .toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('忽略未知的键', () => {
    expect(parseExchange('say', 'z:whatever')).toEqual([])
  })
})

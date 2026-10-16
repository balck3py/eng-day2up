import { describe, expect, it } from 'vitest'
import { sentenceAt, sentenceContaining, sentencesCovering } from './sentence'

const TEXT = 'The cat sat. It was content with life! Was it? Yes.'

describe('sentenceAt', () => {
  it('取偏移所在的那一句', () => {
    expect(sentenceAt(TEXT, TEXT.indexOf('content'))).toBe('It was content with life!')
    expect(sentenceAt(TEXT, 0)).toBe('The cat sat.')
    expect(sentenceAt(TEXT, TEXT.length - 1)).toBe('Yes.')
  })

  it('超长句截到上限', () => {
    const long = 'word '.repeat(200).trim() + '.'
    expect(sentenceAt(long, 10).length).toBeLessThanOrEqual(500)
  })
})

describe('sentenceContaining', () => {
  it('按整词（忽略大小写）找第一句', () => {
    expect(sentenceContaining(TEXT, 'Content')).toBe('It was content with life!')
  })

  it('不把词的一部分当命中', () => {
    expect(sentenceContaining('A cathedral. The cat ran.', 'cat')).toBe('The cat ran.')
  })

  it('找不到时退回整段（截断）', () => {
    expect(sentenceContaining(TEXT, 'dog')).toBe(TEXT)
  })
})

describe('sentencesCovering', () => {
  it('选了半句也补成整句', () => {
    const s = TEXT.indexOf('content')
    expect(sentencesCovering(TEXT, s, s + 'content with'.length)).toBe('It was content with life!')
  })

  it('跨句选择返回覆盖到的全部句子', () => {
    const s = TEXT.indexOf('sat')
    const e = TEXT.indexOf('Was') + 3
    expect(sentencesCovering(TEXT, s, e)).toBe('The cat sat. It was content with life! Was it?')
  })
})

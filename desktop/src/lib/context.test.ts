import { describe, it, expect } from 'vitest'
import { modeOf, resolveContext, MAX_SELECTION } from './context'

describe('modeOf', () => {
  it('单词带标点仍是单词模式', () => {
    expect(modeOf(' ubiquitous, ')).toEqual({ kind: 'word', word: 'ubiquitous' })
  })
  it('句子是文本模式', () => {
    expect(modeOf('The cache is stale.')).toMatchObject({ kind: 'text', truncated: false })
  })
  it('空白是 empty', () => {
    expect(modeOf('  \n')).toEqual({ kind: 'empty' })
  })
  it('超过 5000 字截断并标记', () => {
    const m = modeOf('word '.repeat(2000))
    expect(m.kind).toBe('text')
    if (m.kind === 'text') {
      expect(m.text.length).toBe(MAX_SELECTION)
      expect(m.truncated).toBe(true)
    }
  })
})

describe('resolveContext', () => {
  const paragraph = 'First point. The approach is pragmatic and fast. Done.'

  it('单词 + 段落：按偏移取所在句子', () => {
    const offset = paragraph.indexOf('pragmatic')
    expect(resolveContext({ text: 'pragmatic', paragraph, offset }, 'word', 'pragmatic')).toBe(
      'The approach is pragmatic and fast.',
    )
  })

  it('单词带尾随标点和空格时偏移仍正确', () => {
    const p = 'One. Two stale. Three.'
    const offset = p.indexOf('stale')
    expect(resolveContext({ text: 'stale. ', paragraph: p, offset }, 'word', 'stale')).toBe('Two stale.')
  })

  it('偏移不可信时退回按词定位', () => {
    expect(resolveContext({ text: 'pragmatic', paragraph, offset: 3 }, 'word', 'pragmatic')).toBe(
      'The approach is pragmatic and fast.',
    )
  })

  it('单词 + 无段落（剪贴板）：null', () => {
    expect(resolveContext({ text: 'pragmatic', paragraph: null, offset: null }, 'word', 'pragmatic')).toBeNull()
  })

  it('文本模式：难词所在的第二句', () => {
    const text = 'Cats sleep well. Dogs are running fast.'
    expect(resolveContext({ text, paragraph: null, offset: null }, 'text', 'running')).toBe(
      'Dogs are running fast.',
    )
  })

  it('文本模式 + 段落：选区只有半句时扩到完整句子', () => {
    const p = 'Intro here. The protocol is idempotent by design. End.'
    const text = 'is idempotent by'
    const offset = p.indexOf(text)
    expect(resolveContext({ text, paragraph: p, offset }, 'text', 'idempotent')).toBe(
      'The protocol is idempotent by design.',
    )
  })

  it('文本模式 + 段落：取选区内那次出现，而不是段落里更早的同词', () => {
    const p = 'A stale cache. Another stale entry here.'
    const text = 'Another stale entry'
    const offset = p.indexOf(text)
    expect(resolveContext({ text, paragraph: p, offset }, 'text', 'stale')).toBe('Another stale entry here.')
  })
})

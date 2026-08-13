import { describe, it, expect } from 'vitest'
import { mergeHistory, type HistoryItem } from './store'

const item = (at: number, source: string, translation = 't'): HistoryItem => ({
  id: `id-${at}`,
  at,
  source,
  translation,
})

describe('mergeHistory', () => {
  it('新记录置顶', () => {
    const list = [item(1, 'a')]
    expect(mergeHistory(list, item(2, 'b')).map((h) => h.source)).toEqual(['b', 'a'])
  })

  it('同 source 去重并置顶（忽略大小写与首尾空白）', () => {
    const list = [item(1, 'Hello'), item(2, 'world')]
    const next = mergeHistory(list, item(3, '  hello  ', '新译文'))
    expect(next.map((h) => h.source)).toEqual(['  hello  ', 'world'])
    expect(next[0].translation).toBe('新译文')
    expect(next).toHaveLength(2)
  })

  it('超出上限丢弃最旧', () => {
    const list = [item(2, 'b'), item(1, 'a')]
    const next = mergeHistory(list, item(3, 'c'), 2)
    expect(next.map((h) => h.source)).toEqual(['c', 'b'])
  })
})

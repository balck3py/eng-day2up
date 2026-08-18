import { describe, it, expect } from 'vitest'
import { assignQuizTypes } from './quiz'

interface Item {
  id: number
  hasSenses: boolean
}

/** 20 个条目，其中 id 为偶数的没有中文释义 */
const ITEMS: Item[] = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  hasSenses: i % 2 === 1,
}))

const canAskCn = (x: Item) => x.hasSenses

describe('assignQuizTypes', () => {
  it('比例为 0 时全是英译中，且一个词都不丢', () => {
    const out = assignQuizTypes(ITEMS, 0, canAskCn, 42)
    expect(out).toHaveLength(20)
    expect(out.every((c) => c.type === 'en2cn')).toBe(true)
  })

  it('比例为 100 时全是中译英，且无释义的词全被剔除', () => {
    const out = assignQuizTypes(ITEMS, 100, canAskCn, 42)
    expect(out).toHaveLength(10)
    expect(out.every((c) => c.type === 'cn2en')).toBe(true)
    expect(out.every((c) => c.item.hasSenses)).toBe(true)
  })

  it('比例居中时两种题型都出现', () => {
    const out = assignQuizTypes(ITEMS, 50, canAskCn, 42)
    expect(out.some((c) => c.type === 'en2cn')).toBe(true)
    expect(out.some((c) => c.type === 'cn2en')).toBe(true)
  })

  it('被分到中译英的卡一定有中文释义', () => {
    const out = assignQuizTypes(ITEMS, 50, canAskCn, 42)
    expect(out.filter((c) => c.type === 'cn2en').every((c) => c.item.hasSenses)).toBe(true)
  })

  it('保留原有顺序', () => {
    const out = assignQuizTypes(ITEMS, 0, canAskCn, 42)
    expect(out.map((c) => c.item.id)).toEqual(ITEMS.map((i) => i.id))
  })

  it('相同种子产生相同结果', () => {
    const a = assignQuizTypes(ITEMS, 50, canAskCn, 7)
    const b = assignQuizTypes(ITEMS, 50, canAskCn, 7)
    expect(a).toEqual(b)
  })

  it('不同种子产生不同结果', () => {
    const a = assignQuizTypes(ITEMS, 50, canAskCn, 1)
    const b = assignQuizTypes(ITEMS, 50, canAskCn, 2)
    expect(a).not.toEqual(b)
  })

  it('比例越界时被夹到 0-100', () => {
    expect(assignQuizTypes(ITEMS, -20, canAskCn, 42)).toEqual(
      assignQuizTypes(ITEMS, 0, canAskCn, 42),
    )
    expect(assignQuizTypes(ITEMS, 999, canAskCn, 42)).toEqual(
      assignQuizTypes(ITEMS, 100, canAskCn, 42),
    )
  })

  it('不修改入参数组', () => {
    const copy = [...ITEMS]
    assignQuizTypes(copy, 50, canAskCn, 42)
    expect(copy).toEqual(ITEMS)
  })

  it('空数组返回空数组', () => {
    expect(assignQuizTypes([], 50, canAskCn, 42)).toEqual([])
  })

  it('全部无释义 + 比例 100 时返回空数组', () => {
    const none = ITEMS.map((i) => ({ ...i, hasSenses: false }))
    expect(assignQuizTypes(none, 100, canAskCn, 42)).toEqual([])
  })
})

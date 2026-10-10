import { describe, it, expect } from 'vitest'
import { assignQuizTypes, type QuizRules } from './quiz'

interface Item {
  id: number
  hasSenses: boolean
  firstEver?: boolean
  owesSpelling?: boolean
}

/** 20 个条目，其中 id 为偶数的没有中文释义 */
const ITEMS: Item[] = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  hasSenses: i % 2 === 1,
}))

/** 只按「有没有中文释义」筛，两条强制规则都不触发 —— 老行为的基线 */
const RULES: QuizRules<Item> = {
  canAskCn: (x) => x.hasSenses,
  isFirstEver: (x) => x.firstEver === true,
  owesSpelling: (x) => x.owesSpelling === true,
}

describe('assignQuizTypes', () => {
  it('比例为 0 时全是英译中，且一个词都不丢', () => {
    const out = assignQuizTypes(ITEMS, 0, RULES, 42)
    expect(out).toHaveLength(20)
    expect(out.every((c) => c.type === 'en2cn')).toBe(true)
  })

  it('比例为 100 时全是中译英，且无释义的词全被剔除', () => {
    const out = assignQuizTypes(ITEMS, 100, RULES, 42)
    expect(out).toHaveLength(10)
    expect(out.every((c) => c.type === 'cn2en')).toBe(true)
    expect(out.every((c) => c.item.hasSenses)).toBe(true)
  })

  it('比例居中时两种题型都出现', () => {
    const out = assignQuizTypes(ITEMS, 50, RULES, 42)
    expect(out.some((c) => c.type === 'en2cn')).toBe(true)
    expect(out.some((c) => c.type === 'cn2en')).toBe(true)
  })

  it('被分到中译英的卡一定有中文释义', () => {
    const out = assignQuizTypes(ITEMS, 50, RULES, 42)
    expect(out.filter((c) => c.type === 'cn2en').every((c) => c.item.hasSenses)).toBe(true)
  })

  it('保留原有顺序', () => {
    const out = assignQuizTypes(ITEMS, 0, RULES, 42)
    expect(out.map((c) => c.item.id)).toEqual(ITEMS.map((i) => i.id))
  })

  it('相同种子产生相同结果', () => {
    const a = assignQuizTypes(ITEMS, 50, RULES, 7)
    const b = assignQuizTypes(ITEMS, 50, RULES, 7)
    expect(a).toEqual(b)
  })

  it('不同种子产生不同结果', () => {
    const a = assignQuizTypes(ITEMS, 50, RULES, 1)
    const b = assignQuizTypes(ITEMS, 50, RULES, 2)
    expect(a).not.toEqual(b)
  })

  it('比例越界时被夹到 0-100', () => {
    expect(assignQuizTypes(ITEMS, -20, RULES, 42)).toEqual(
      assignQuizTypes(ITEMS, 0, RULES, 42),
    )
    expect(assignQuizTypes(ITEMS, 999, RULES, 42)).toEqual(
      assignQuizTypes(ITEMS, 100, RULES, 42),
    )
  })

  it('不修改入参数组', () => {
    const copy = [...ITEMS]
    assignQuizTypes(copy, 50, RULES, 42)
    expect(copy).toEqual(ITEMS)
  })

  it('空数组返回空数组', () => {
    expect(assignQuizTypes([], 50, RULES, 42)).toEqual([])
  })

  it('全部无释义 + 比例 100 时返回空数组', () => {
    const none = ITEMS.map((i) => ({ ...i, hasSenses: false }))
    expect(assignQuizTypes(none, 100, RULES, 42)).toEqual([])
  })
})

describe('assignQuizTypes · 第一次背的词只出英译中', () => {
  const firstEver: Item[] = [{ id: 1, hasSenses: true, firstEver: true }]

  it('比例 100 也只出英译中', () => {
    const out = assignQuizTypes(firstEver, 100, RULES, 42)
    expect(out).toEqual([{ item: firstEver[0], type: 'en2cn' }])
  })

  it('哪个种子都不出中译英', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const out = assignQuizTypes(firstEver, 100, RULES, seed)
      expect(out[0].type).toBe('en2cn')
    }
  })

  it('第一次背压过拼写欠账 —— 还没见过的词写不出来', () => {
    const both: Item[] = [{ id: 1, hasSenses: true, firstEver: true, owesSpelling: true }]
    expect(assignQuizTypes(both, 100, RULES, 42)[0].type).toBe('en2cn')
  })

  it('第一次背的词一个都不会被剔除，哪怕没有中文释义', () => {
    const noSense: Item[] = [{ id: 1, hasSenses: false, firstEver: true }]
    expect(assignQuizTypes(noSense, 100, RULES, 42)).toHaveLength(1)
  })
})

describe('assignQuizTypes · 欠拼写的词强制出中译英', () => {
  const owing: Item[] = [{ id: 1, hasSenses: true, owesSpelling: true }]

  it('比例 0 也出中译英', () => {
    const out = assignQuizTypes(owing, 0, RULES, 42)
    expect(out).toEqual([{ item: owing[0], type: 'cn2en' }])
  })

  it('哪个种子都不出英译中', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const out = assignQuizTypes(owing, 0, RULES, seed)
      expect(out[0].type).toBe('cn2en')
    }
  })

  it('还清欠账后回归比例分配', () => {
    const paid: Item[] = [{ id: 1, hasSenses: true, owesSpelling: false }]
    expect(assignQuizTypes(paid, 0, RULES, 42)[0].type).toBe('en2cn')
  })

  it('没有中文释义就不强制 —— 中译英的题面正是释义', () => {
    const noSense: Item[] = [{ id: 1, hasSenses: false, owesSpelling: true }]
    const out = assignQuizTypes(noSense, 0, RULES, 42)
    expect(out).toEqual([{ item: noSense[0], type: 'en2cn' }])
  })
})

describe('assignQuizTypes · 强制规则不打乱随机序列', () => {
  const tail: Item[] = [
    { id: 1, hasSenses: true },
    { id: 2, hasSenses: true },
    { id: 3, hasSenses: true },
  ]

  /** 每张卡都消费一个随机数，与它是否被强制无关 —— 否则强制会让后续分配漂移 */
  function tailTypes(head: Item, seed: number): string[] {
    return assignQuizTypes([head, ...tail], 50, RULES, seed)
      .slice(1)
      .map((c) => c.type)
  }

  it('队首那张是否被强制，都不影响后面几张的分配', () => {
    const plain: Item = { id: 0, hasSenses: true }
    expect(tailTypes({ ...plain, firstEver: true }, 99)).toEqual(tailTypes(plain, 99))
    expect(tailTypes({ ...plain, owesSpelling: true }, 99)).toEqual(tailTypes(plain, 99))
  })
})

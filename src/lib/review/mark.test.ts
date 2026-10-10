import { describe, it, expect } from 'vitest'
import { nextFamiliarity, nextSpellOkCount, owesSpelling, SPELL_QUOTA } from './mark'

describe('nextFamiliarity', () => {
  it('认识则加一', () => {
    expect(nextFamiliarity(2, true)).toBe(3)
  })
  it('不认识则减一', () => {
    expect(nextFamiliarity(2, false)).toBe(1)
  })
  it('上限封顶为 5', () => {
    expect(nextFamiliarity(5, true)).toBe(5)
  })
  it('下限兜底为 0', () => {
    expect(nextFamiliarity(0, false)).toBe(0)
  })
  it('从 0 认识一次到 1', () => {
    expect(nextFamiliarity(0, true)).toBe(1)
  })
  it('从 4 认识一次到 5（进入已掌握）', () => {
    expect(nextFamiliarity(4, true)).toBe(5)
  })
  it('超出范围的输入被夹回区间', () => {
    expect(nextFamiliarity(99, true)).toBe(5)
    expect(nextFamiliarity(-5, false)).toBe(0)
  })
})

describe('nextSpellOkCount', () => {
  it('中译英拼对，计数加一', () => {
    expect(nextSpellOkCount(0, 2, true, 'cn2en')).toBe(1)
  })

  it('中译英拼错，既不加也不清零', () => {
    expect(nextSpellOkCount(1, 2, false, 'cn2en')).toBe(1)
  })

  it('英译中答对不算拼写', () => {
    expect(nextSpellOkCount(1, 2, true, 'en2cn')).toBe(1)
  })

  it('英译中答错也不动计数', () => {
    expect(nextSpellOkCount(1, 2, false, 'en2cn')).toBe(1)
  })

  it('攒够了还能继续涨 —— 两次是地板不是天花板', () => {
    expect(nextSpellOkCount(SPELL_QUOTA, 5, true, 'cn2en')).toBe(SPELL_QUOTA + 1)
  })

  it('已掌握的词又忘了，计数清零重新欠两次', () => {
    expect(nextSpellOkCount(3, 5, false, 'en2cn')).toBe(0)
  })

  it('已掌握的词在中译英上拼错，同样清零', () => {
    expect(nextSpellOkCount(3, 5, false, 'cn2en')).toBe(0)
  })

  it('没掌握的词答错不清零', () => {
    expect(nextSpellOkCount(1, 4, false, 'en2cn')).toBe(1)
  })

  it('负数计数被兜到 0', () => {
    expect(nextSpellOkCount(-3, 2, false, 'en2cn')).toBe(0)
  })
})

describe('owesSpelling', () => {
  it('生词且一次没拼对过 —— 欠账', () => {
    expect(owesSpelling(0, 0)).toBe(true)
  })

  it('生词只拼对过一次 —— 还欠一次', () => {
    expect(owesSpelling(2, 1)).toBe(true)
  })

  it('生词拼对满两次 —— 不再强制', () => {
    expect(owesSpelling(2, SPELL_QUOTA)).toBe(false)
  })

  it('已掌握的词不欠账，哪怕一次没拼过', () => {
    expect(owesSpelling(5, 0)).toBe(false)
  })

  it('刚好到 4 还算生词', () => {
    expect(owesSpelling(4, 0)).toBe(true)
  })
})

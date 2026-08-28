import { describe, it, expect } from 'vitest'
import { splitRecent, interleave, RECENT_WINDOW_MS } from './ebbinghaus'

const NOW = Date.parse('2026-08-28T12:00:00Z')

function at(msAgo: number) {
  return new Date(NOW - msAgo).toISOString()
}

const HOUR = 60 * 60 * 1000

describe('splitRecent', () => {
  it('一天内复习过的进 recent，更早的进 rest', () => {
    const items = [
      { id: 'a', lastReviewedAt: at(2 * HOUR) },
      { id: 'b', lastReviewedAt: at(30 * HOUR) },
    ]
    const { recent, rest } = splitRecent(items, NOW)
    expect(recent.map((i) => i.id)).toEqual(['a'])
    expect(rest.map((i) => i.id)).toEqual(['b'])
  })

  it('从没复习过的词永远是 rest', () => {
    const { recent, rest } = splitRecent([{ id: 'a', lastReviewedAt: null }], NOW)
    expect(recent).toHaveLength(0)
    expect(rest).toHaveLength(1)
  })

  it('上午背完下午再背：同一天的前一轮也算刚背过', () => {
    const items = [{ id: 'morning', lastReviewedAt: at(5 * HOUR) }]
    expect(splitRecent(items, NOW).recent).toHaveLength(1)
  })

  it('刚好卡在窗口边界上的算旧词', () => {
    const items = [{ id: 'edge', lastReviewedAt: at(RECENT_WINDOW_MS) }]
    expect(splitRecent(items, NOW).recent).toHaveLength(0)
  })

  it('时间戳解析不出来当作没复习过', () => {
    const { recent, rest } = splitRecent([{ id: 'bad', lastReviewedAt: '不是时间' }], NOW)
    expect(recent).toHaveLength(0)
    expect(rest).toHaveLength(1)
  })

  it('时间戳在未来（本机时钟偏了）也不当成刚背过', () => {
    const items = [{ id: 'future', lastReviewedAt: at(-3 * HOUR) }]
    expect(splitRecent(items, NOW).recent).toHaveLength(0)
  })

  it('不改动入参', () => {
    const items = [{ id: 'a', lastReviewedAt: at(HOUR) }]
    splitRecent(items, NOW)
    expect(items).toHaveLength(1)
  })
})

describe('interleave', () => {
  it('等长时一张隔一张', () => {
    expect(interleave([1, 3, 5], [2, 4, 6])).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a 先用完，b 的剩余整段接在后面', () => {
    expect(interleave([1], [2, 4, 6])).toEqual([1, 2, 4, 6])
  })

  it('b 先用完，a 的剩余整段接在后面', () => {
    expect(interleave([1, 3, 5], [2])).toEqual([1, 2, 3, 5])
  })

  it('一边为空时原样返回另一边', () => {
    expect(interleave([], [1, 2])).toEqual([1, 2])
    expect(interleave([1, 2], [])).toEqual([1, 2])
  })

  it('巩固词从第一张就开始出现，不至于一轮下来一个没见着', () => {
    const recent = ['r1', 'r2', 'r3']
    const rest = Array.from({ length: 300 }, (_, i) => `n${i}`)
    const out = interleave(recent, rest)
    // 前 6 张里三个巩固词全在
    expect(out.slice(0, 6).filter((w) => w.startsWith('r'))).toHaveLength(3)
    expect(out).toHaveLength(303)
  })
})

import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], ranges: [] as number[], failFrom: -1,
  batches: [] as number[],
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from(table: string) {
    let from = 0, to = 999, exact = '', search = '', keys: string[] = []
    const q = {
      select: () => q, order: () => q,
      range(a: number, b: number) { from = a; to = b; state.ranges.push(a); return q },
      eq(_col: string, value: string) { exact = value; return q },
      ilike(_col: string, value: string) { search = value.slice(1, -1); return q },
      in(_col: string, value: string[]) { keys = value; state.batches.push(value.length); return q },
      then(resolve: (value: unknown) => void) {
        if (table === 'dict_entries') return Promise.resolve({ data: keys.map((word_key) => ({ word_key, translation: 'n. 释义', phonetic: '/test/' })), error: null }).then(resolve)
        const filtered = state.rows.filter((r) => (!exact || r.word_key === exact) && (!search || String(r.word).includes(search)))
        return Promise.resolve(from === state.failFrom
          ? { data: null, error: { message: 'database unavailable' } }
          : { data: filtered.slice(from, Math.min(to + 1, from + 1000)), error: null }).then(resolve)
      },
    }
    return q
  },
}) }))
import { GET } from './route'

beforeEach(() => {
  state.rows = Array.from({ length: 1101 }, (_, i) => ({
    id: String(i), word: `word${i}`, word_key: `word${i}`, created_at: '2026-11-03',
    review_count: 0, familiarity: 0, spell_ok_count: 0,
  }))
  Object.assign(state.rows[1100], { word: 'quizzical', word_key: 'quizzical' })
  state.ranges = []; state.batches = []; state.failFrom = -1
})
it('分页返回超过 1000 个收藏，分批补齐末尾词条释义', async () => {
  const result = await GET(new Request('https://test/api/wordbook'))
  const { entries } = await result.json()
  expect(entries).toHaveLength(1101)
  expect(entries.at(-1).senses).toEqual([{ pos: 'n.', meaning: '释义' }])
  expect(state.ranges).toEqual([0, 500, 1000])
  expect(Math.max(...state.batches)).toBeLessThanOrEqual(200)
})
it('后续页失败返回错误，不把不完整的词本当作完整列表', async () => {
  state.failFrom = 500
  expect((await GET(new Request('https://test/api/wordbook'))).status).toBe(500)
})
it('精确查询仍能查到超过首 1000 条以外的收藏', async () => {
  const result = await GET(new Request('https://test/api/wordbook?word=quizzical'))
  expect((await result.json()).entries.map((r: { word: string }) => r.word)).toEqual(['quizzical'])
})

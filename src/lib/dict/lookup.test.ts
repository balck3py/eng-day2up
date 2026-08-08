import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupWord } from './lookup'

vi.mock('./dictapi', () => ({
  getPhonetics: vi.fn(async () => ({
    phoneticUs: '/us/', phoneticUk: '/uk/',
    audioUs: 'a-us.mp3', audioUk: 'a-uk.mp3',
  })),
}))

type EntryRow = {
  word: string; phonetic: string | null; translation: string | null
  collins: number | null; oxford: number | null; tag: string | null
}

/**
 * 构造一个只支持本模块所用查询形态的假客户端。
 * entries 按 word_key 索引，lemmas 是 form → lemma 列表。
 */
function fakeDb(entries: Record<string, EntryRow>, lemmas: Record<string, string[]>) {
  return {
    from(table: string) {
      if (table === 'dict_entries') {
        return {
          select: () => ({
            in: (_col: string, keys: string[]) => Promise.resolve({
              data: keys.map((k) => entries[k]).filter(Boolean), error: null,
            }),
          }),
        }
      }
      if (table === 'dict_lemma') {
        return {
          select: () => ({
            eq: (_col: string, form: string) => Promise.resolve({
              data: (lemmas[form] ?? []).map((lemma) => ({ lemma })), error: null,
            }),
          }),
        }
      }
      throw new Error(`未预期的表: ${table}`)
    },
  } as unknown as SupabaseClient
}

const APPLE: EntryRow = {
  word: 'apple', phonetic: '/ˈæpl/', translation: 'n. 苹果\nn. 苹果树',
  collins: 5, oxford: 1, tag: 'zk gk cet4',
}
const SAY: EntryRow = {
  word: 'say', phonetic: '/seɪ/', translation: 'vt. 说', collins: 5,
  oxford: 1, tag: 'zk',
}
const RUN: EntryRow = {
  word: 'run', phonetic: '/rʌn/', translation: 'vi. 跑', collins: 5,
  oxford: 1, tag: '',
}

describe('lookupWord', () => {
  it('第一级：精确命中', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    const r = await lookupWord(db, 'apple')
    expect(r.matchedFrom).toBe('exact')
    expect(r.word).toBe('apple')
    expect(r.senses).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'n.', meaning: '苹果树' },
    ])
  })

  it('精确命中前先规范化输入', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    const r = await lookupWord(db, '  Apple!  ')
    expect(r.matchedFrom).toBe('exact')
    expect(r.query).toBe('  Apple!  ')
  })

  it('第二级：经 dict_lemma 命中原型', async () => {
    const db = fakeDb({ say: SAY }, { said: ['say'] })
    const r = await lookupWord(db, 'said')
    expect(r.matchedFrom).toBe('lemma')
    expect(r.word).toBe('say')
  })

  it('第三级：后缀规则兜底', async () => {
    const db = fakeDb({ run: RUN }, {})
    const r = await lookupWord(db, 'running')
    expect(r.matchedFrom).toBe('suffix')
    expect(r.word).toBe('run')
  })

  it('第四级：全部未命中', async () => {
    const db = fakeDb({}, {})
    const r = await lookupWord(db, 'zzzznotaword')
    expect(r.matchedFrom).toBe('none')
    expect(r.senses).toEqual([])
    expect(r.phonetic).toBeNull()
  })

  it('未命中时仍返回在线音标', async () => {
    const db = fakeDb({}, {})
    const r = await lookupWord(db, 'zzzznotaword')
    expect(r.phoneticUs).toBe('/us/')
    expect(r.phoneticUk).toBe('/uk/')
  })

  it('把 tag 拆成数组', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    const r = await lookupWord(db, 'apple')
    expect(r.tags).toEqual(['zk', 'gk', 'cet4'])
  })

  it('tag 为空串时 tags 为空数组', async () => {
    const db = fakeDb({ run: RUN }, {})
    const r = await lookupWord(db, 'run')
    expect(r.tags).toEqual([])
  })

  it('oxford 转为布尔', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    expect((await lookupWord(db, 'apple')).oxford).toBe(true)
  })

  it('保留 ECDICT 单一音标作为保底', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    expect((await lookupWord(db, 'apple')).phonetic).toBe('/ˈæpl/')
  })

  it('空输入直接返回未命中，不查库', async () => {
    const db = fakeDb({}, {})
    const r = await lookupWord(db, '!!!')
    expect(r.matchedFrom).toBe('none')
  })
})

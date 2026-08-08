import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupWord } from './lookup'
import { getPhonetics } from './dictapi'

vi.mock('./dictapi', () => ({
  getPhonetics: vi.fn(async () => ({
    phoneticUs: '/us/', phoneticUk: '/uk/',
    audioUs: 'a-us.mp3', audioUk: 'a-uk.mp3',
  })),
}))

const mockedGetPhonetics = vi.mocked(getPhonetics)

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

/**
 * 与 fakeDb 类似，但 dict_entries 的 `.in()` 永远按 `rowOrder` 里的顺序
 * 返回命中行，忽略调用方传入的 keys 顺序——用来模拟真实 Postgres 不保证
 * IN 查询返回行序与查询列表顺序一致的情况，验证 lookupWord 不依赖行序，
 * 而是依赖候选优先级（stripSuffixCandidates 的顺序 / lemma 的字典序）。
 */
function fakeDbScrambled(
  entries: Record<string, EntryRow>,
  lemmas: Record<string, string[]>,
  rowOrder: string[],
) {
  return {
    from(table: string) {
      if (table === 'dict_entries') {
        return {
          select: () => ({
            in: (_col: string, keys: string[]) => Promise.resolve({
              data: rowOrder.filter((k) => keys.includes(k) && entries[k]).map((k) => entries[k]),
              error: null,
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
const CARE: EntryRow = {
  word: 'care', phonetic: '/keər/', translation: 'vi. 关心', collins: 5,
  oxford: 1, tag: 'zk',
}
const CAR: EntryRow = {
  word: 'car', phonetic: '/kɑːr/', translation: 'n. 汽车', collins: 5,
  oxford: 1, tag: 'zk',
}
const STUDY: EntryRow = {
  word: 'study', phonetic: '/ˈstʌdi/', translation: 'v. 学习', collins: 3,
  oxford: 0, tag: '',
}
const WORK: EntryRow = {
  word: 'work', phonetic: '/wɜːk/', translation: 'vi. 工作', collins: 3,
  oxford: 0, tag: '',
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

  it('第三级：单一候选命中不受排序调整影响（studies → study）', async () => {
    const db = fakeDb({ study: STUDY }, {})
    const r = await lookupWord(db, 'studies')
    expect(r.matchedFrom).toBe('suffix')
    expect(r.word).toBe('study')
  })

  it('第三级：单一候选命中不受排序调整影响（worked → work）', async () => {
    const db = fakeDb({ work: WORK }, {})
    const r = await lookupWord(db, 'worked')
    expect(r.matchedFrom).toBe('suffix')
    expect(r.word).toBe('work')
  })

  it('第三级：多个候选都是真词时优先取哑音 e 还原（caring → care，而不是 car），且不依赖数据库返回行序', async () => {
    // 刻意让数据库先返回 car 这一行，验证代码是按 stripSuffixCandidates
    // 的候选优先级挑赢家，而不是直接取查询结果的第一行。
    const db = fakeDbScrambled({ car: CAR, care: CARE }, {}, ['car', 'care'])
    const r = await lookupWord(db, 'caring')
    expect(r.matchedFrom).toBe('suffix')
    expect(r.word).toBe('care')
  })

  it('第三级：过去式候选同理（cared → care，而不是 car），且不依赖数据库返回行序', async () => {
    const db = fakeDbScrambled({ car: CAR, care: CARE }, {}, ['car', 'care'])
    const r = await lookupWord(db, 'cared')
    expect(r.matchedFrom).toBe('suffix')
    expect(r.word).toBe('care')
  })

  it('第三级：命中后用的是解析出的原型词去查在线音标，而不是原始输入', async () => {
    const db = fakeDbScrambled({ car: CAR, care: CARE }, {}, ['car', 'care'])
    await lookupWord(db, 'caring')
    expect(mockedGetPhonetics).toHaveBeenCalledWith(db, 'care')
    expect(mockedGetPhonetics).not.toHaveBeenCalledWith(db, 'caring')
  })

  it('第二级：一个 form 对应多个 lemma 时按字典序取最小者作为确定性选择，且不依赖数据库返回行序', async () => {
    // dict_lemma 对 'foo' 给出两个 lemma；数据库先返回 run 这一行，
    // 验证代码取的是排序后的 apple（'apple' < 'run'），而不是行序里的第一行。
    const db = fakeDbScrambled(
      { apple: APPLE, run: RUN },
      { foo: ['run', 'apple'] },
      ['run', 'apple'],
    )
    const r = await lookupWord(db, 'foo')
    expect(r.matchedFrom).toBe('lemma')
    expect(r.word).toBe('apple')
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

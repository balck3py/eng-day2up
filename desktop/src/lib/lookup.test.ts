import { describe, it, expect } from 'vitest'
import { lookupWord } from './lookup'
import { fakeDb } from './fakeDb'

const entry = (word: string, translation = 'n. 释义') => ({
  word, word_key: word.toLowerCase(), phonetic: `/${word}/`, translation,
  collins: 3, oxford: 1, tag: 'cet4 ielts',
})

describe('lookupWord', () => {
  it('精确命中，音标读 dict_cache', async () => {
    const { db } = fakeDb({
      dict_entries: [entry('stale', 'adj. 陈旧的\nvt. 使变陈旧')],
      dict_cache: [{ word_key: 'stale', phonetic_us: '/steɪl/', phonetic_uk: '/steɪl/', found: true }],
    })
    const d = await lookupWord(db, 'Stale,')
    expect(d.matchedFrom).toBe('exact')
    expect(d.word).toBe('stale')
    expect(d.phoneticUs).toBe('/steɪl/')
    expect(d.senses).toEqual([
      { pos: 'adj.', meaning: '陈旧的' },
      { pos: 'vt.', meaning: '使变陈旧' },
    ])
    expect(d.tags).toEqual(['cet4', 'ielts'])
    expect(d.oxford).toBe(true)
  })

  it('dict_lemma 词形还原：running → run', async () => {
    const { db } = fakeDb({
      dict_entries: [entry('run')],
      dict_lemma: [{ form: 'running', lemma: 'run' }],
      dict_cache: [{ word_key: 'run', phonetic_us: '/rʌn/', phonetic_uk: null, found: true }],
    })
    const d = await lookupWord(db, 'running')
    expect(d.matchedFrom).toBe('lemma')
    expect(d.word).toBe('run')
    expect(d.query).toBe('running')
    expect(d.phoneticUs).toBe('/rʌn/')
  })

  it('后缀规则按候选优先级挑选：caring → care 而不是 car', async () => {
    const { db } = fakeDb({ dict_entries: [entry('car'), entry('care')] })
    const d = await lookupWord(db, 'caring')
    expect(d.matchedFrom).toBe('suffix')
    expect(d.word).toBe('care')
  })

  it('未命中：none，无音标时回落为空', async () => {
    const { db } = fakeDb({
      dict_cache: [{ word_key: 'zzqanotaword', phonetic_us: '/x/', phonetic_uk: '/x/', found: false }],
    })
    const d = await lookupWord(db, 'zzqanotaword')
    expect(d.matchedFrom).toBe('none')
    expect(d.senses).toEqual([])
    expect(d.phoneticUs).toBeNull()
  })

  it('音标缺失时保留 ECDICT phonetic 作保底', async () => {
    const { db } = fakeDb({ dict_entries: [entry('cache')] })
    const d = await lookupWord(db, 'cache')
    expect(d.phoneticUs).toBeNull()
    expect(d.phonetic).toBe('/cache/')
  })

  it('第一轮三个查询并行发起', async () => {
    const { db, log } = fakeDb({ dict_entries: [entry('stale')] })
    await lookupWord(db, 'stale')
    expect(log).toEqual(['select dict_entries', 'select dict_lemma', 'select dict_cache'])
  })

  it('空输入不查库', async () => {
    const { db, log } = fakeDb({})
    const d = await lookupWord(db, '  ,, ')
    expect(d.matchedFrom).toBe('none')
    expect(log).toEqual([])
  })
})

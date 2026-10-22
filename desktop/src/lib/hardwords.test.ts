import { describe, it, expect } from 'vitest'
import { extractHardWords } from './hardwords'
import { fakeDb } from './fakeDb'

const entry = (word: string, frq: number) => ({
  word, word_key: word, phonetic: null, translation: `n. ${word}义`,
  collins: null, oxford: null, tag: null, bnc: null, frq,
})

const tables = () => ({
  dict_entries: [entry('protocol', 8000), entry('idempotent', 40000), entry('design', 900)],
  dict_lemma: [{ form: 'protocols', lemma: 'protocol' }],
  wordbook: [] as Record<string, unknown>[],
})

describe('extractHardWords', () => {
  it('词形还原后按原文顺序返回，保留原文词形', async () => {
    const { db } = fakeDb(tables())
    const got = await extractHardWords(db, 'The protocols are idempotent by design.')
    expect(got.map((h) => [h.word, h.surface])).toEqual([
      ['protocol', 'protocols'],
      ['idempotent', 'idempotent'],
      ['design', 'design'],
    ])
  })

  it('单词本熟练度 ≥ 阈值的词被排除', async () => {
    const t = tables()
    t.wordbook.push({ word_key: 'idempotent', familiarity: 3 })
    const { db } = fakeDb(t)
    const keep = await extractHardWords(db, 'idempotent design')
    expect(keep.map((h) => h.word)).toContain('idempotent')
    const drop = await extractHardWords(db, 'idempotent design', 3)
    expect(drop.map((h) => h.word)).not.toContain('idempotent')
  })

  it('没有可用词时不查库', async () => {
    const { db, log } = fakeDb(tables())
    expect(await extractHardWords(db, 'the and of')).toEqual([])
    expect(log).toEqual([])
  })
})

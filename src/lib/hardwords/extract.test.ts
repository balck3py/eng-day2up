import { it, expect } from 'vitest'
import { extractHardWords } from './extract'
import { fakeDb } from '@/test/fakeDb'

it('原型与变形同时出现仍保留释义，并正确排除已掌握原型的变形', async () => {
  const tables = {
    dict_entries: [{ word: 'protocol', word_key: 'protocol', translation: 'n. 协议', frq: 8000 }],
    dict_lemma: [{ form: 'protocols', lemma: 'protocol' }],
    wordbook: [] as Record<string, unknown>[],
  }
  const { db } = fakeDb(tables)
  expect((await extractHardWords(db, 'protocol protocols', 'u1')).map((w) => [w.word, w.senses.length]))
    .toEqual([['protocol', 1], ['protocol', 1]])
  tables.wordbook.push({ user_id: 'u1', word_key: 'protocol', familiarity: 4 })
  expect(await extractHardWords(db, 'protocol protocols', 'u1')).toEqual([])
})

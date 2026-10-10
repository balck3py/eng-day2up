import { describe, it, expect } from 'vitest'
import { favorite, isSaved } from './favorite'
import { fakeDb } from './fakeDb'

describe('favorite', () => {
  it('新词：插入 word / word_key / source_context', async () => {
    const { db, tables } = fakeDb({ wordbook: [] })
    const r = await favorite(db, 'u1', { word: 'Pragmatic', sourceContext: 'It is pragmatic.' })
    expect(r).toBe('added')
    expect(tables.wordbook).toEqual([
      { user_id: 'u1', word: 'Pragmatic', word_key: 'pragmatic', source_context: 'It is pragmatic.' },
    ])
  })

  it('已存在：返回 exists，不插入也不改旧值', async () => {
    const old = { id: '1', word_key: 'pragmatic', source_context: '旧句子' }
    const { db, tables, log } = fakeDb({ wordbook: [old] })
    const r = await favorite(db, 'u1', { word: 'pragmatic', sourceContext: '新句子' })
    expect(r).toBe('exists')
    expect(tables.wordbook).toEqual([old])
    expect(log).not.toContain('insert wordbook')
  })

  it('插入遇到 23505 视为已存在', async () => {
    const { db } = fakeDb({ wordbook: [] }, { insertError: { code: '23505', message: 'dup' } })
    expect(await favorite(db, 'u1', { word: 'stale', sourceContext: null })).toBe('exists')
  })

  it('其他插入错误抛出', async () => {
    const { db } = fakeDb({ wordbook: [] }, { insertError: { code: '42501', message: 'rls' } })
    await expect(favorite(db, 'u1', { word: 'stale', sourceContext: null })).rejects.toThrow('rls')
  })

  it('空上下文存 null', async () => {
    const { db, tables } = fakeDb({ wordbook: [] })
    await favorite(db, 'u1', { word: 'stale', sourceContext: '' })
    expect(tables.wordbook[0].source_context).toBeNull()
  })

  it('isSaved 按规范化键查询', async () => {
    const { db } = fakeDb({ wordbook: [{ id: '1', word_key: 'stale' }] })
    expect(await isSaved(db, 'Stale,')).toBe(true)
    expect(await isSaved(db, 'fresh')).toBe(false)
  })
})

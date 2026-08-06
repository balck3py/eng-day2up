import { describe, it, expect } from 'vitest'
import { shouldImport } from './filter'
import type { EcdictRow } from './types'

function row(overrides: Partial<EcdictRow> = {}): EcdictRow {
  return {
    word: 'sample', phonetic: '', definition: '', translation: '',
    pos: '', collins: '', oxford: '', tag: '', bnc: '', frq: '',
    exchange: '', ...overrides,
  }
}

describe('shouldImport', () => {
  it('frq 有排名则导入', () => {
    expect(shouldImport(row({ frq: '1200' }))).toBe(true)
  })
  it('bnc 有排名则导入', () => {
    expect(shouldImport(row({ bnc: '800' }))).toBe(true)
  })
  it('柯林斯星级非零则导入', () => {
    expect(shouldImport(row({ collins: '3' }))).toBe(true)
  })
  it('牛津核心词则导入', () => {
    expect(shouldImport(row({ oxford: '1' }))).toBe(true)
  })
  it('带考试标签则导入', () => {
    expect(shouldImport(row({ tag: 'cet4 ky' }))).toBe(true)
  })
  it('所有指标为空则跳过', () => {
    expect(shouldImport(row())).toBe(false)
  })
  it('所有指标为零则跳过', () => {
    expect(shouldImport(row({ frq: '0', bnc: '0', collins: '0', oxford: '0' })))
      .toBe(false)
  })
  it('空 word 一律跳过', () => {
    expect(shouldImport(row({ word: '', frq: '1200' }))).toBe(false)
  })
  it('纯空白 word 一律跳过', () => {
    expect(shouldImport(row({ word: '   ', frq: '1200' }))).toBe(false)
  })
  it('非数字字段按 0 处理', () => {
    expect(shouldImport(row({ frq: 'NULL', bnc: 'abc' }))).toBe(false)
  })
})

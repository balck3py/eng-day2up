import { describe, it, expect } from 'vitest'
import { parseTranslation } from './senses'

describe('parseTranslation', () => {
  it('按真实换行拆分并提取词性', () => {
    expect(parseTranslation('n. 苹果\nvt. 吃苹果')).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'vt.', meaning: '吃苹果' },
    ])
  })

  it('兼容字面的反斜杠 n', () => {
    expect(parseTranslation('n. 苹果\\nvt. 吃苹果')).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'vt.', meaning: '吃苹果' },
    ])
  })

  it('无词性前缀时 pos 为空串', () => {
    expect(parseTranslation('一个没有词性的释义')).toEqual([
      { pos: '', meaning: '一个没有词性的释义' },
    ])
  })

  it('保留释义中的逗号分隔项', () => {
    expect(parseTranslation('n. 手, 帮助, 指针')).toEqual([
      { pos: 'n.', meaning: '手, 帮助, 指针' },
    ])
  })

  it('丢弃空行', () => {
    expect(parseTranslation('n. 苹果\n\n\nvt. 吃')).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'vt.', meaning: '吃' },
    ])
  })

  it('去除每行首尾空白', () => {
    expect(parseTranslation('  n.   苹果   ')).toEqual([
      { pos: 'n.', meaning: '苹果' },
    ])
  })

  it('null 返回空数组', () => {
    expect(parseTranslation(null)).toEqual([])
  })

  it('空串返回空数组', () => {
    expect(parseTranslation('')).toEqual([])
  })

  it('不把中文开头误判为词性', () => {
    expect(parseTranslation('苹果. 一种水果')).toEqual([
      { pos: '', meaning: '苹果. 一种水果' },
    ])
  })
})

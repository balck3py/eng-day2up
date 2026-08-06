import { describe, it, expect } from 'vitest'
import { isSingleWord, normalizeWord } from './normalize'

describe('isSingleWord', () => {
  it('识别单个单词', () => {
    expect(isSingleWord('hello')).toBe(true)
  })
  it('忽略首尾空白', () => {
    expect(isSingleWord('  hello  ')).toBe(true)
  })
  it('接受撇号', () => {
    expect(isSingleWord("don't")).toBe(true)
  })
  it('接受连字符', () => {
    expect(isSingleWord('well-known')).toBe(true)
  })
  it('多个词判为段落', () => {
    expect(isSingleWord('hello world')).toBe(false)
  })
  it('中文判为段落', () => {
    expect(isSingleWord('你好')).toBe(false)
  })
  it('空串判为段落', () => {
    expect(isSingleWord('')).toBe(false)
  })
  it('带句号判为段落', () => {
    expect(isSingleWord('hello.')).toBe(false)
  })
  it('数字开头判为段落', () => {
    expect(isSingleWord('3d')).toBe(false)
  })
})

describe('normalizeWord', () => {
  it('去除尾部标点并小写', () => {
    expect(normalizeWord('Hello,')).toBe('hello')
  })
  it('去除首尾空白与感叹号', () => {
    expect(normalizeWord('  Running!  ')).toBe('running')
  })
  it('保留词内撇号', () => {
    expect(normalizeWord("Don't")).toBe("don't")
  })
  it('保留词内连字符', () => {
    expect(normalizeWord('Well-Known')).toBe('well-known')
  })
  it('全非字母输入返回空串', () => {
    expect(normalizeWord('!!!')).toBe('')
  })
})

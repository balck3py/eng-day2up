import { describe, it, expect } from 'vitest'
import { isAnswerCorrect } from './answer'

describe('isAnswerCorrect', () => {
  it('完全一致判对', () => {
    expect(isAnswerCorrect('serendipity', 'serendipity')).toBe(true)
  })
  it('忽略大小写', () => {
    expect(isAnswerCorrect('Serendipity', 'serendipity')).toBe(true)
    expect(isAnswerCorrect('SERENDIPITY', 'serendipity')).toBe(true)
  })
  it('忽略首尾空格', () => {
    expect(isAnswerCorrect('  serendipity  ', 'serendipity')).toBe(true)
  })
  it('忽略首尾标点', () => {
    expect(isAnswerCorrect('serendipity.', 'serendipity')).toBe(true)
    expect(isAnswerCorrect('"serendipity"', 'serendipity')).toBe(true)
  })
  it('词条侧也归一化', () => {
    expect(isAnswerCorrect('run', 'Run')).toBe(true)
  })
  it('词内连字符必须一致', () => {
    expect(isAnswerCorrect('wellbeing', 'well-being')).toBe(false)
    expect(isAnswerCorrect('well-being', 'well-being')).toBe(true)
  })
  it('词内撇号必须一致', () => {
    expect(isAnswerCorrect('dont', "don't")).toBe(false)
  })
  it('拼写错误判错', () => {
    expect(isAnswerCorrect('serendipty', 'serendipity')).toBe(false)
  })
  it('词形变化判错 —— 本题型就是拼写训练', () => {
    expect(isAnswerCorrect('running', 'run')).toBe(false)
    expect(isAnswerCorrect('cats', 'cat')).toBe(false)
  })
  it('空输入判错', () => {
    expect(isAnswerCorrect('', 'serendipity')).toBe(false)
  })
  it('纯空格输入判错', () => {
    expect(isAnswerCorrect('   ', 'serendipity')).toBe(false)
  })
  it('纯标点输入判错', () => {
    expect(isAnswerCorrect('...', 'serendipity')).toBe(false)
  })
})

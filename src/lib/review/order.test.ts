import { describe, it, expect } from 'vitest'
import { orderCards } from './order'

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('orderCards', () => {
  it('顺序模式原样返回', () => {
    expect(orderCards(ITEMS, 'sequential', 42)).toEqual(ITEMS)
  })
  it('顺序模式不修改原数组', () => {
    const copy = [...ITEMS]
    orderCards(copy, 'sequential', 42)
    expect(copy).toEqual(ITEMS)
  })
  it('随机模式打乱顺序', () => {
    expect(orderCards(ITEMS, 'random', 42)).not.toEqual(ITEMS)
  })
  it('随机模式保留全部元素', () => {
    expect([...orderCards(ITEMS, 'random', 42)].sort((a, b) => a - b)).toEqual(ITEMS)
  })
  it('相同种子产生相同结果', () => {
    expect(orderCards(ITEMS, 'random', 7)).toEqual(orderCards(ITEMS, 'random', 7))
  })
  it('不同种子产生不同结果', () => {
    expect(orderCards(ITEMS, 'random', 1)).not.toEqual(orderCards(ITEMS, 'random', 2))
  })
  it('随机模式不修改原数组', () => {
    const copy = [...ITEMS]
    orderCards(copy, 'random', 42)
    expect(copy).toEqual(ITEMS)
  })
  it('空数组返回空数组', () => {
    expect(orderCards([], 'random', 1)).toEqual([])
  })
  it('单元素数组原样返回', () => {
    expect(orderCards([9], 'random', 1)).toEqual([9])
  })
})

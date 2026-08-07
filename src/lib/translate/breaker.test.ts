import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from './breaker'

const T = 1_000_000   // 任意基准时刻

describe('CircuitBreaker', () => {
  it('初始为闭合状态', () => {
    expect(new CircuitBreaker(3, 5000).isOpen(T)).toBe(false)
  })

  it('未达阈值不熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T)
    b.recordFailure(T)
    expect(b.isOpen(T)).toBe(false)
  })

  it('达到阈值后熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    expect(b.isOpen(T)).toBe(true)
  })

  it('冷却期内保持熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    expect(b.isOpen(T + 4999)).toBe(true)
  })

  it('冷却期满后恢复', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    expect(b.isOpen(T + 5000)).toBe(false)
  })

  it('成功后失败计数清零', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T)
    b.recordSuccess()
    b.recordFailure(T)
    expect(b.isOpen(T)).toBe(false)
  })

  it('成功后立即解除熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    b.recordSuccess()
    expect(b.isOpen(T)).toBe(false)
  })

  it('冷却期满后再次失败需重新累积到阈值', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    const after = T + 5000
    expect(b.isOpen(after)).toBe(false)
    b.recordFailure(after)
    expect(b.isOpen(after)).toBe(false)   // 计数已在恢复时清零
  })

  it('阈值为 1 时单次失败即熔断', () => {
    const b = new CircuitBreaker(1, 5000)
    b.recordFailure(T)
    expect(b.isOpen(T)).toBe(true)
  })
})

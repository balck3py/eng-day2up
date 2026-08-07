/**
 * 连续失败达到阈值即熔断，冷却期满自动恢复并清零计数。
 * 时钟通过参数注入，便于测试。
 *
 * 注意：Vercel 的无状态函数实例之间不共享该状态，各实例独立维护。
 * 最坏情况是每个新实例多试探一次 ollama，可接受。
 */
export class CircuitBreaker {
  private failures = 0
  private openUntil = 0

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  isOpen(now: number): boolean {
    if (this.openUntil === 0) return false
    if (now >= this.openUntil) {
      // 冷却期满，恢复并清零
      this.openUntil = 0
      this.failures = 0
      return false
    }
    return true
  }

  recordSuccess(): void {
    this.failures = 0
    this.openUntil = 0
  }

  recordFailure(now: number): void {
    this.failures += 1
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.cooldownMs
    }
  }
}

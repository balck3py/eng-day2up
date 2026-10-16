import { describe, expect, it, vi } from 'vitest'
import { runWithQuota } from './withQuota'
import type { TranslationStream } from './types'

function stream() {
  const s = {
    provider: 'cloud' as const,
    chunks: (async function* () {
      yield 'x'
    })(),
    cancel: vi.fn<() => void>(),
  }
  return s satisfies TranslationStream
}

describe('runWithQuota', () => {
  it('配额与模型请求同时发起，而不是先等配额', async () => {
    const order: string[] = []
    let releaseQuota!: (v: boolean) => void
    const quota = () => {
      order.push('quota')
      return new Promise<boolean>((r) => (releaseQuota = r))
    }
    const run = vi.fn(async () => {
      order.push('run')
      return stream()
    })
    const p = runWithQuota(quota, run)
    await Promise.resolve()
    expect(order.sort()).toEqual(['quota', 'run'])
    releaseQuota(true)
    expect((await p).kind).toBe('ok')
  })

  it('超配额时掐断已发出的模型请求', async () => {
    const s = stream()
    const r = await runWithQuota(async () => false, async () => s)
    expect(r.kind).toBe('quota')
    expect(s.cancel).toHaveBeenCalled()
  })

  it('模型不可用时返回错误信息', async () => {
    const r = await runWithQuota(async () => true, async () => {
      throw new Error('全挂了')
    })
    expect(r).toEqual({ kind: 'error', message: '全挂了' })
  })

  it('超配额优先于模型错误', async () => {
    const r = await runWithQuota(async () => false, async () => {
      throw new Error('全挂了')
    })
    expect(r.kind).toBe('quota')
  })
})

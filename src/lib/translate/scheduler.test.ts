import { describe, it, expect, vi } from 'vitest'
import { createScheduler } from './scheduler'
import type { ChatMessage, ProviderName, TranslationProvider } from './types'

const MSGS: ChatMessage[] = [{ role: 'user', content: 'x' }]

function okProvider(name: ProviderName, chunks: string[]): TranslationProvider {
  return {
    name,
    async *stream() {
      for (const c of chunks) yield c
    },
  }
}

function failProvider(name: ProviderName): TranslationProvider {
  return {
    name,
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error(`${name} 挂了`)
    },
  }
}

/** 首字节前挂起 delayMs 的 provider */
function slowProvider(name: ProviderName, delayMs: number): TranslationProvider {
  return {
    name,
    async *stream() {
      await new Promise((r) => setTimeout(r, delayMs))
      yield 'late'
    },
  }
}

async function drain(it: AsyncIterable<string>): Promise<string> {
  let s = ''
  for await (const c of it) s += c
  return s
}

describe('createScheduler', () => {
  it('首选可用时直接使用它', async () => {
    const s = createScheduler([okProvider('ollama', ['你', '好']), failProvider('cloud')])
    const r = await s.run(MSGS)
    expect(r.provider).toBe('ollama')
    expect(await drain(r.chunks)).toBe('你好')
  })

  it('首选抛异常时降级到次选', async () => {
    const s = createScheduler([failProvider('ollama'), okProvider('cloud', ['fall', 'back'])])
    const r = await s.run(MSGS)
    expect(r.provider).toBe('cloud')
    expect(await drain(r.chunks)).toBe('fallback')
  })

  it('首字节超时时降级', async () => {
    const s = createScheduler(
      [slowProvider('ollama', 200), okProvider('cloud', ['ok'])],
      { firstByteTimeoutMs: 50 },
    )
    const r = await s.run(MSGS)
    expect(r.provider).toBe('cloud')
  })

  it('降级后不丢首字节', async () => {
    const s = createScheduler([failProvider('ollama'), okProvider('cloud', ['A', 'B', 'C'])])
    const r = await s.run(MSGS)
    expect(await drain(r.chunks)).toBe('ABC')
  })

  it('全部失败时抛异常', async () => {
    const s = createScheduler([failProvider('ollama'), failProvider('cloud')])
    await expect(s.run(MSGS)).rejects.toThrow()
  })

  it('连续失败达阈值后跳过该 provider 不再试探', async () => {
    const ollama = failProvider('ollama')
    const spy = vi.spyOn(ollama, 'stream')
    const s = createScheduler([ollama, okProvider('cloud', ['x'])], {
      failureThreshold: 2,
      cooldownMs: 60_000,
    })
    await s.run(MSGS) // 第 1 次失败
    await s.run(MSGS) // 第 2 次失败 → 熔断
    await s.run(MSGS) // 熔断中，应跳过
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('成功一次后失败计数清零', async () => {
    let shouldFail = true
    const flaky: TranslationProvider = {
      name: 'ollama',
      async *stream() {
        if (shouldFail) throw new Error('boom')
        yield 'ok'
      },
    }
    const s = createScheduler([flaky, okProvider('cloud', ['c'])], {
      failureThreshold: 2,
      cooldownMs: 60_000,
    })
    await s.run(MSGS) // 失败 1
    shouldFail = false
    expect((await s.run(MSGS)).provider).toBe('ollama') // 成功，清零
    shouldFail = true
    await s.run(MSGS) // 失败 1（不是 2）
    shouldFail = false
    expect((await s.run(MSGS)).provider).toBe('ollama') // 未熔断
  })

  it('只有一个 provider 且可用时正常工作', async () => {
    const s = createScheduler([okProvider('cloud', ['solo'])])
    expect((await s.run(MSGS)).provider).toBe('cloud')
  })

  it('首字节之后的错误不触发降级（已开始输出）', async () => {
    const midFail: TranslationProvider = {
      name: 'ollama',
      async *stream() {
        yield 'start'
        throw new Error('中途断流')
      },
    }
    const s = createScheduler([midFail, okProvider('cloud', ['never'])])
    const r = await s.run(MSGS)
    expect(r.provider).toBe('ollama')
    await expect(drain(r.chunks)).rejects.toThrow('中途断流')
  })

  // —— 心跳空串：推理模型开头只有 reasoning_content，provider 以空串表示
  //    「连接活着但还没内容」。调度器必须认它为首字节，且不把它外传。

  it('空串心跳算首字节，不触发降级', async () => {
    const reasoning: TranslationProvider = {
      name: 'cloud',
      async *stream() {
        yield ''
        yield ''
        await new Promise((r) => setTimeout(r, 120))
        yield '真正的内容'
      },
    }
    const s = createScheduler([reasoning, okProvider('ollama', ['不该用到'])], {
      firstByteTimeoutMs: 50,
    })
    const r = await s.run(MSGS)
    expect(r.provider).toBe('cloud')
    expect(await drain(r.chunks)).toBe('真正的内容')
  })

  it('空串不外传给消费者', async () => {
    const s = createScheduler([okProvider('cloud', ['', 'a', '', 'b', ''])])
    const r = await s.run(MSGS)
    const out: string[] = []
    for await (const c of r.chunks) out.push(c)
    expect(out).toEqual(['a', 'b'])
  })

  it('整条流只有心跳时消费者收到空输出而非报错', async () => {
    const s = createScheduler([okProvider('cloud', ['', ''])])
    const r = await s.run(MSGS)
    expect(await drain(r.chunks)).toBe('')
  })

  it('首字节超时后 abort 传给了 provider', async () => {
    let aborted = false
    const hanging: TranslationProvider = {
      name: 'ollama',
      async *stream(_messages, signal) {
        signal?.addEventListener('abort', () => {
          aborted = true
        })
        await new Promise((r) => setTimeout(r, 500))
        yield 'too late'
      },
    }
    const s = createScheduler([hanging, okProvider('cloud', ['ok'])], {
      firstByteTimeoutMs: 30,
    })
    const r = await s.run(MSGS)
    expect(r.provider).toBe('cloud')
    expect(aborted).toBe(true)
  })
})

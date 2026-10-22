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

  // —— 最后一个 provider（身后没有兜底）：熔断与 5 秒超时只会把偶发慢请求放大成
  //    整段不可用，所以它永不被熔断跳过、超时放宽，并且用对冲请求压尾延迟。

  it('最后一个 provider 连续失败也不熔断，每次都会再试', async () => {
    const cloud = failProvider('cloud')
    const spy = vi.spyOn(cloud, 'stream')
    const s = createScheduler([cloud], { failureThreshold: 1, cooldownMs: 60_000 })
    for (let i = 0; i < 3; i++) await expect(s.run(MSGS)).rejects.toThrow()
    // 每次 run：首发 + 快速失败后的一次重试
    expect(spy).toHaveBeenCalledTimes(6)
  })

  it('最后一个 provider 用放宽的超时', async () => {
    const s = createScheduler([slowProvider('cloud', 120)], {
      firstByteTimeoutMs: 50,
      lastFirstByteTimeoutMs: 500,
      hedgeAfterMs: null,
    })
    const r = await s.run(MSGS)
    expect(await drain(r.chunks)).toBe('late')
  })

  it('最后一个 provider 首字节迟迟不来时发对冲请求，先到者胜，落后者被 abort', async () => {
    let calls = 0
    let firstAborted = false
    const cloud: TranslationProvider = {
      name: 'cloud',
      async *stream(_m, signal) {
        const n = ++calls
        if (n === 1) {
          signal?.addEventListener('abort', () => {
            firstAborted = true
          })
          await new Promise((r) => setTimeout(r, 400))
          yield '慢'
        } else {
          yield '快'
        }
      },
    }
    const s = createScheduler([cloud], { lastFirstByteTimeoutMs: 1000, hedgeAfterMs: 30 })
    const t0 = Date.now()
    const r = await s.run(MSGS)
    expect(Date.now() - t0).toBeLessThan(300)
    expect(await drain(r.chunks)).toBe('快')
    expect(firstAborted).toBe(true)
  })

  it('最后一个 provider 快速失败时立即重试一次', async () => {
    let calls = 0
    const cloud: TranslationProvider = {
      name: 'cloud',
      async *stream() {
        if (++calls === 1) throw new Error('502')
        yield 'ok'
      },
    }
    const s = createScheduler([cloud], { hedgeAfterMs: 10_000 })
    expect(await drain((await s.run(MSGS)).chunks)).toBe('ok')
  })

  it('最后一个 provider 两次都没在超时内到达时报超时', async () => {
    const s = createScheduler([slowProvider('cloud', 300)], {
      lastFirstByteTimeoutMs: 60,
      hedgeAfterMs: 20,
    })
    await expect(s.run(MSGS)).rejects.toThrow('首字节超时')
  })

  it('身后还有兜底的 provider 不对冲，超时直接降级', async () => {
    const ollama = slowProvider('ollama', 200)
    const spy = vi.spyOn(ollama, 'stream')
    const s = createScheduler([ollama, okProvider('cloud', ['ok'])], {
      firstByteTimeoutMs: 50,
      hedgeAfterMs: 10,
    })
    expect((await s.run(MSGS)).provider).toBe('cloud')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('最后一个 provider 只发心跳（在思考）迟迟不出正文时也会对冲', async () => {
    let calls = 0
    const cloud: TranslationProvider = {
      name: 'cloud',
      async *stream() {
        if (++calls === 1) {
          // 不认「关闭思考」参数的上游：先吐一长串思考心跳
          for (let i = 0; i < 20; i++) {
            yield ''
            await new Promise((r) => setTimeout(r, 20))
          }
          yield '慢'
        } else {
          yield '快'
        }
      },
    }
    const s = createScheduler([cloud], { lastFirstByteTimeoutMs: 2000, hedgeAfterMs: 50 })
    expect(await drain((await s.run(MSGS)).chunks)).toBe('快')
  })

  it('cancel() 掐断上游（如超配额时丢弃已发出的请求）', async () => {
    let aborted = false
    const cloud: TranslationProvider = {
      name: 'cloud',
      async *stream(_m, signal) {
        signal?.addEventListener('abort', () => {
          aborted = true
        })
        yield 'a'
        yield 'b'
      },
    }
    const r = await createScheduler([cloud]).run(MSGS)
    r.cancel()
    expect(aborted).toBe(true)
  })
})

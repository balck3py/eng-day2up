import { CircuitBreaker } from './breaker'
import type { ChatMessage, TranslationProvider, TranslationStream } from './types'

export interface SchedulerOptions {
  /** 首字节超时。总时长不设限 —— 流式响应长度不可控。 */
  firstByteTimeoutMs?: number
  failureThreshold?: number
  cooldownMs?: number
}

export interface Scheduler {
  run(messages: ChatMessage[]): Promise<TranslationStream>
}

const DEFAULTS = {
  firstByteTimeoutMs: 5000,
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000,
}

/** 在 timeoutMs 内取迭代器的第一个值，超时则拒绝。 */
async function firstChunk(
  it: AsyncIterator<string>,
  timeoutMs: number,
): Promise<IteratorResult<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('首字节超时')), timeoutMs)
  })
  try {
    return await Promise.race([it.next(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 按顺序尝试各 provider，以首字节是否按时到达为判据决定是否降级。
 * 首字节到手后才返回，因此 TranslationStream.provider 一定是最终生效的那个。
 * 首字节之后的错误不再降级 —— 此时已经有内容输出给用户了。
 *
 * 「首字节」指 provider 产出的第一个值，**包括空串**。空串是 provider 读到
 * 了一行但该行没有文本内容（推理模型的 reasoning_content、ollama 的 done 行）
 * 时发出的心跳。若改判成「第一个非空文本」，推理模型开头那几十块思考内容
 * 会白白烧掉超时预算，健康的后端会被误判为挂掉。心跳在这里被滤掉，不外传。
 */
export function createScheduler(
  providers: TranslationProvider[],
  opts: SchedulerOptions = {},
): Scheduler {
  const cfg = { ...DEFAULTS, ...opts }
  const breakers = new Map<string, CircuitBreaker>(
    providers.map((p) => [p.name, new CircuitBreaker(cfg.failureThreshold, cfg.cooldownMs)]),
  )

  return {
    async run(messages) {
      const errors: string[] = []

      for (const provider of providers) {
        const breaker = breakers.get(provider.name)!
        if (breaker.isOpen(Date.now())) {
          errors.push(`${provider.name}: 熔断中`)
          continue
        }

        const controller = new AbortController()
        const iterator = provider
          .stream(messages, controller.signal)
          [Symbol.asyncIterator]()

        let head: IteratorResult<string>
        try {
          head = await firstChunk(iterator, cfg.firstByteTimeoutMs)
        } catch (e) {
          breaker.recordFailure(Date.now())
          errors.push(`${provider.name}: ${(e as Error).message}`)
          // 先 abort 掐断底层请求，再走迭代器的正常收尾。只做后者的话，
          // 卡在 await fetch() 上的生成器要等那个 await 落地才会执行 return。
          controller.abort()
          void Promise.resolve(iterator.return?.(undefined)).catch(() => {})
          continue
        }

        breaker.recordSuccess()

        return {
          provider: provider.name,
          chunks: (async function* () {
            try {
              if (!head.done && head.value) yield head.value
              for (;;) {
                const next = await iterator.next()
                if (next.done) return
                if (next.value) yield next.value
              }
            } finally {
              // 消费者提前离开（客户端断连）时掐断上游，别让它继续烧 token。
              controller.abort()
            }
          })(),
        }
      }

      throw new Error(`所有翻译后端均不可用 —— ${errors.join('; ')}`)
    },
  }
}

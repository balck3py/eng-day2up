import { CircuitBreaker } from './breaker'
import type { ChatMessage, TranslationProvider, TranslationStream } from './types'

export interface SchedulerOptions {
  /** 身后还有兜底时的首字节超时 —— 短，好尽快降级。总时长不设限：流式响应长度不可控。 */
  firstByteTimeoutMs?: number
  /** 最后一个 provider 的首字节超时（含对冲请求在内的总等待）。没得降级了，宁可多等。 */
  lastFirstByteTimeoutMs?: number
  /** 最后一个 provider 首字节超过这么久还没到，就并发一个相同请求，先到者胜。null 关闭。 */
  hedgeAfterMs?: number | null
  failureThreshold?: number
  cooldownMs?: number
}

export interface Scheduler {
  run(messages: ChatMessage[]): Promise<TranslationStream>
}

const DEFAULTS = {
  firstByteTimeoutMs: 5000,
  lastFirstByteTimeoutMs: 20_000,
  // 实测云端排队时间多在 0.6–4s，偶发 10s+；3s 发对冲只在长尾时才多花一次 token
  hedgeAfterMs: 3000 as number | null,
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000,
}

/** 一次对 provider 的请求：掐断用的 controller、迭代器、以及它的第一个值。 */
interface Attempt {
  controller: AbortController
  iterator: AsyncIterator<string>
  head: Promise<IteratorResult<string>>
}

/** 跳过心跳空串，取第一个真正的文本（或流结束）。 */
async function firstText(it: AsyncIterator<string>): Promise<IteratorResult<string>> {
  for (;;) {
    const r = await it.next()
    if (r.done || r.value) return r
  }
}

/**
 * contentOnly：以第一个正文为「到手」而非第一个字节（含心跳）。
 * 最后一个 provider 用它 —— 云端是聚合平台，请求会被随机派给不同上游，
 * 有的上游不认「关闭思考」参数，只吐心跳不出正文；按正文竞速，对冲才能把它甩开。
 */
function launch(
  provider: TranslationProvider,
  messages: ChatMessage[],
  contentOnly: boolean,
): Attempt {
  const controller = new AbortController()
  const iterator = provider.stream(messages, controller.signal)[Symbol.asyncIterator]()
  return { controller, iterator, head: contentOnly ? firstText(iterator) : iterator.next() }
}

/**
 * 先 abort 掐断底层请求，再走迭代器的正常收尾。只做后者的话，
 * 卡在 await fetch() 上的生成器要等那个 await 落地才会执行 return。
 */
function cancel(a: Attempt) {
  a.controller.abort()
  void Promise.resolve(a.iterator.return?.(undefined)).catch(() => {})
}

/**
 * 在 timeoutMs 内拿到首字节（hedge 开启时是首个正文，见 launch）。hedge 开启时：
 * - 过了 hedgeAfterMs 还没到，并发第二个相同请求，谁先出首字节用谁，另一个掐掉；
 * - 首发请求快速失败（如 502）且第二个还没发，立即补发 —— 相当于重试一次。
 * 最多两个请求；全都失败或总时长超时则拒绝。
 */
function acquire(
  provider: TranslationProvider,
  messages: ChatMessage[],
  timeoutMs: number,
  hedgeAfterMs: number | null,
): Promise<{ attempt: Attempt; head: IteratorResult<string> }> {
  return new Promise((resolve, reject) => {
    const attempts: Attempt[] = []
    const errors: string[] = []
    let settled = false
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (fn: () => void) => {
      settled = true
      clearTimeout(hedgeTimer)
      clearTimeout(deadline)
      fn()
    }

    const fire = () => {
      const a = launch(provider, messages, hedgeAfterMs !== null)
      attempts.push(a)
      a.head.then(
        (head) => {
          if (settled) return cancel(a)
          finish(() => {
            attempts.filter((x) => x !== a).forEach(cancel)
            resolve({ attempt: a, head })
          })
        },
        (e: unknown) => {
          if (settled) return
          errors.push((e as Error).message)
          if (hedgeAfterMs !== null && attempts.length < 2) {
            clearTimeout(hedgeTimer)
            fire()
          } else if (errors.length === attempts.length) {
            finish(() => reject(new Error(errors.join(' / '))))
          }
        },
      )
    }

    const deadline = setTimeout(
      () =>
        finish(() => {
          attempts.forEach(cancel)
          reject(new Error('首字节超时'))
        }),
      timeoutMs,
    )
    fire()
    if (hedgeAfterMs !== null && hedgeAfterMs < timeoutMs) {
      hedgeTimer = setTimeout(() => {
        if (!settled && attempts.length < 2) fire()
      }, hedgeAfterMs)
    }
  })
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

      for (const [i, provider] of providers.entries()) {
        const isLast = i === providers.length - 1
        const breaker = breakers.get(provider.name)!
        // 熔断是为了更快地切到兜底；身后没有兜底时跳过它只会让请求必然失败
        if (!isLast && breaker.isOpen(Date.now())) {
          errors.push(`${provider.name}: 熔断中`)
          continue
        }

        let attempt: Attempt
        let head: IteratorResult<string>
        try {
          ;({ attempt, head } = await acquire(
            provider,
            messages,
            isLast ? cfg.lastFirstByteTimeoutMs : cfg.firstByteTimeoutMs,
            isLast ? cfg.hedgeAfterMs : null,
          ))
        } catch (e) {
          breaker.recordFailure(Date.now())
          errors.push(`${provider.name}: ${(e as Error).message}`)
          continue
        }
        const { controller, iterator } = attempt

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
          cancel: () => controller.abort(),
        }
      }

      throw new Error(`所有翻译后端均不可用 —— ${errors.join('; ')}`)
    },
  }
}

import type { TranslationStream } from './types'

export type QuotaRunResult =
  | { kind: 'ok'; result: TranslationStream }
  | { kind: 'quota' }
  | { kind: 'error'; message: string }

/**
 * 扣配额与调模型同时发起。两者互不依赖，串行时模型要白等一次数据库往返
 * （实测 0.4–0.75s）。代价是超配额那次仍会发出一个模型请求，随即被 cancel 掉 ——
 * 单人自用、每日 200 次的配额下可以接受。
 */
export async function runWithQuota(
  consume: () => Promise<boolean>,
  run: () => Promise<TranslationStream>,
): Promise<QuotaRunResult> {
  const pending = run().then(
    (result) => ({ result }),
    (e: unknown) => ({ error: (e as Error).message }),
  )
  const allowed = await consume()
  const outcome = await pending
  if (!allowed) {
    if ('result' in outcome) outcome.result.cancel()
    return { kind: 'quota' }
  }
  return 'result' in outcome
    ? { kind: 'ok', result: outcome.result }
    : { kind: 'error', message: outcome.error }
}

import { MAX_FAMILIARITY } from './mark'

/** 已掌握词的冷却期：14 天。熟练度满值的词这段时间里不进常规复习。 */
export const MASTERED_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000

/**
 * 这个词还在冷却期里吗 —— 熟练度满值、且距上次复习不满冷却期。
 *
 * 冷却完的满值词照常出：答对还是 5，last_reviewed_at 刷新，自动再冷却一轮；
 * 答错降到 4，下次就是普通词。所以这里不需要另记「冷却到哪天」。
 *
 * 时间戳为空或解析不出来的一律不算冷却 —— 宁可多出一次，也别让脏数据把词藏起来。
 */
export function inCooldown(
  entry: { familiarity: number; lastReviewedAt: string | null },
  now: number,
  cooldownMs: number = MASTERED_COOLDOWN_MS,
): boolean {
  if (entry.familiarity < MAX_FAMILIARITY) return false
  const at = entry.lastReviewedAt ? Date.parse(entry.lastReviewedAt) : NaN
  if (!Number.isFinite(at)) return false
  return now - at < cooldownMs
}

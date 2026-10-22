import type { QuizType } from './quiz'

export const MAX_FAMILIARITY = 5
export const MIN_FAMILIARITY = 0

/** 每个生词至少要拼对几次。地板不是天花板 —— 还清之后照样可能被比例抽中拼写。 */
export const SPELL_QUOTA = 2

/**
 * 认识 +1（封顶 5），不认识 -1（兜底 0）。
 * 达到 4 即视为已掌握，会被难词拆解排除（见 Plan 2 的打分规则）。
 */
export function nextFamiliarity(current: number, known: boolean): number {
  const base = Math.min(Math.max(current, MIN_FAMILIARITY), MAX_FAMILIARITY)
  const next = known ? base + 1 : base - 1
  return Math.min(Math.max(next, MIN_FAMILIARITY), MAX_FAMILIARITY)
}

/**
 * 拼对计数的转移：只有「中译英卡上拼对了」才 +1。
 *
 * 拼错既不加也不清零 —— 拼不出来的词熟练度上不去，欠账也就还不掉，下次出现
 * 还会被拉回来拼，规则自己会收敛，不需要再罚一次。
 *
 * 唯一的清零是「已掌握的词又忘了」（熟练度从满值往下掉）：它重新变成生词，
 * 就该重新欠两次拼写，否则一个忘掉的老词只会走比例随机，再也不强制拼。
 */
export function nextSpellOkCount(
  current: number,
  prevFamiliarity: number,
  known: boolean,
  quizType: QuizType,
): number {
  const base = Math.max(current, 0)
  if (prevFamiliarity >= MAX_FAMILIARITY && !known) return 0
  if (quizType === 'cn2en' && known) return base + 1
  return base
}

/** 这个词还欠着拼写练习吗 —— 已掌握（熟练度满值）的词不欠。 */
export function owesSpelling(familiarity: number, spellOkCount: number): boolean {
  return familiarity < MAX_FAMILIARITY && spellOkCount < SPELL_QUOTA
}

/** 补写判定时，客户端报上来的作答时间最多往前追溯多久 */
export const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000
/** 容忍客户端时钟比服务端快一点 */
const CLOCK_SKEW_MS = 60 * 1000

/**
 * 决定写进 last_reviewed_at 的时间。补写时带上原始作答时间，否则三天前背的词
 * 会被记成「刚背过」。时间不在 [now - 7 天, now + 1 分钟] 内、或解析不出来，
 * 就不信它，用服务端当前时间。
 */
export function resolveReviewedAt(reported: unknown, now: number): string {
  const at = typeof reported === 'string' ? Date.parse(reported) : NaN
  if (Number.isFinite(at) && at <= now + CLOCK_SKEW_MS && at >= now - MAX_BACKDATE_MS) {
    // 比服务端快的那一点钳回 now，别写进一个未来时间
    return new Date(Math.min(at, now)).toISOString()
  }
  return new Date(now).toISOString()
}

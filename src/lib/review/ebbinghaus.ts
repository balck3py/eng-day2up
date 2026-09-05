/** 「刚背过」的时间窗：24 小时。一轮不绑自然日，上午背完下午再背就是下一轮。 */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 按「最近背过没有」把词分成两堆。
 *
 * recent 就是艾宾浩斯意义上该再见一面的那批 —— 复习过、且距今不到一天。
 * 从没复习过的词 lastReviewedAt 是 null，永远落在 rest 里。
 */
export function splitRecent<T extends { lastReviewedAt: string | null }>(
  items: T[],
  now: number,
  windowMs: number = RECENT_WINDOW_MS,
): { recent: T[]; rest: T[] } {
  const recent: T[] = []
  const rest: T[] = []
  for (const item of items) {
    const at = item.lastReviewedAt ? Date.parse(item.lastReviewedAt) : NaN
    // 时间戳解析不出来就当没复习过 —— 宁可多出一次新词，也别把脏数据当成刚背过
    if (Number.isFinite(at) && now - at >= 0 && now - at < windowMs) recent.push(item)
    else rest.push(item)
  }
  return { recent, rest }
}

/**
 * 一张隔一张地交替铺开，谁先用完就把另一边整段接在后面。
 *
 * 巩固词不能只是「混在队列里靠运气撞上」：一轮到了生词目标就收工，撒得太匀
 * 等于一个都见不到。交替能保证它们从第一张就开始出现，又不会把新词全挤到后面。
 */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/** 本地自然日的日期键，如 20260905。用本地时区 —— 用户说的「昨天」是他自己的昨天。 */
function dayKey(ms: number): number {
  const d = new Date(ms)
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/**
 * 从「不是刚背过」的词里挑出上一次复习的那一批：按本地自然日分组，取今天
 * 之前最近的那一天，那天复习过的词全部进 due。
 *
 * 为什么不是简单的「昨天」：中间空一天没背，上一批也得补上，不能因为
 * 日历上不是昨天就漏掉。为什么整批一起出：一轮到生词目标就收工，上一批
 * 只是混在队列里的话，后半截根本轮不到 —— due 会被排在队首且必须过完。
 */
export function splitPrevious<T extends { lastReviewedAt: string | null }>(
  items: T[],
  now: number,
): { due: T[]; older: T[] } {
  const today = dayKey(now)
  let target = 0
  for (const item of items) {
    const at = item.lastReviewedAt ? Date.parse(item.lastReviewedAt) : NaN
    if (!Number.isFinite(at) || at > now) continue
    const key = dayKey(at)
    if (key < today && key > target) target = key
  }
  if (target === 0) return { due: [], older: items }

  const due: T[] = []
  const older: T[] = []
  for (const item of items) {
    const at = item.lastReviewedAt ? Date.parse(item.lastReviewedAt) : NaN
    if (Number.isFinite(at) && at <= now && dayKey(at) === target) due.push(item)
    else older.push(item)
  }
  return { due, older }
}

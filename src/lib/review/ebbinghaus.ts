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

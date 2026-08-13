/**
 * 浏览器本地翻译历史。只记「原文 → 译文」这一对最简信息（单词查词与整段翻译
 * 都记；难词拆解不记），存 localStorage，纯浏览器侧，不落库、不跨设备。
 */
export interface HistoryItem {
  /** 稳定唯一 id，删除时按它定位。不能用时间戳——同一毫秒内多条会撞 id。 */
  id: string
  /** 记录时间（毫秒），仅用于展示与排序 */
  at: number
  source: string
  translation: string
}

const STORAGE_KEY = 'translateHistory'
const MAX_ITEMS = 200

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    // 某些环境没有 crypto.randomUUID，落到下面的兜底
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 把一条新记录并入历史：按 source（去空白、忽略大小写）去重——重复翻译同一段
 * 只保留最新一条并置顶；超出上限则丢弃最旧的。纯函数，便于测试。
 */
export function mergeHistory(
  list: HistoryItem[],
  item: HistoryItem,
  max = MAX_ITEMS,
): HistoryItem[] {
  const norm = (s: string) => s.trim().toLowerCase()
  const key = norm(item.source)
  const deduped = list.filter((h) => norm(h.source) !== key)
  return [item, ...deduped].slice(0, max)
}

export function getHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (h): h is Partial<HistoryItem> =>
          typeof h === 'object' && h !== null &&
          typeof (h as HistoryItem).source === 'string' &&
          typeof (h as HistoryItem).translation === 'string' &&
          typeof (h as HistoryItem).at === 'number',
      )
      // 容忍早期没有 id 的历史数据，缺失时补一个
      .map((h) => ({
        id: typeof h.id === 'string' && h.id ? h.id : genId(),
        at: h.at!,
        source: h.source!,
        translation: h.translation!,
      }))
  } catch {
    return []
  }
}

/** 记一条历史。原文或译文为空则忽略。返回并入后的完整列表。 */
export function addHistory(source: string, translation: string): HistoryItem[] {
  if (typeof window === 'undefined') return []
  const s = source.trim()
  const t = translation.trim()
  if (!s || !t) return getHistory()
  const next = mergeHistory(getHistory(), {
    id: genId(),
    at: Date.now(),
    source: s,
    translation: t,
  })
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 配额满/隐私模式等写入失败：历史是锦上添花，静默即可
  }
  return next
}

export function removeHistory(id: string): HistoryItem[] {
  if (typeof window === 'undefined') return []
  const next = getHistory().filter((h) => h.id !== id)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 同上
  }
  return next
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同上
  }
}

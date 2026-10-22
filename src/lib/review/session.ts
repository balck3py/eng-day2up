import type { QuizType, ReviewCard } from './quiz'
import type { RoundKind } from './leftover'
import { browserStorage, readJson, removeKey, writeJson, type KV } from './storage'

const KEY = 'review-session-v1'

/** 存档超过 3 天就不再提示继续，直接结算 */
export const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000

/**
 * 进行中那一轮的本地存档。只存词 id 不存词条 —— 词条快照会过时（释义补全、
 * 熟练度变化），恢复时按 id 换成单词本里的最新值。
 */
export interface SavedSession {
  v: 1
  kind: RoundKind
  /** 生词收工线；null 表示不设（复习上一轮生词要整批出完） */
  limit: number | null
  mustDo: number
  cursor: number
  cards: { id: string; type: QuizType }[]
  verdicts: Record<number, boolean>
  /** 已经写进熟练度（或进了补写队列）的判定，恢复后不再重复写 */
  marked: Record<number, boolean>
  startedAt: number
}

function isSaved(x: unknown): x is SavedSession {
  const s = x as SavedSession | null
  return (
    !!s &&
    s.v === 1 &&
    Array.isArray(s.cards) &&
    typeof s.cursor === 'number' &&
    typeof s.startedAt === 'number' &&
    typeof s.verdicts === 'object' &&
    typeof s.marked === 'object'
  )
}

export function loadSession(kv: KV | null = browserStorage()): SavedSession | null {
  const raw = readJson(kv, KEY)
  return isSaved(raw) ? raw : null
}

export function saveSession(s: SavedSession, kv: KV | null = browserStorage()): void {
  writeJson(kv, KEY, s)
}

export function clearSession(kv: KV | null = browserStorage()): void {
  removeKey(kv, KEY)
}

export function isExpired(s: SavedSession, now: number): boolean {
  return now - s.startedAt > SESSION_TTL_MS
}

export interface Restored<T> {
  cards: ReviewCard<T>[]
  verdicts: Record<number, boolean>
  marked: Record<number, boolean>
  cursor: number
  mustDo: number
}

/**
 * 按 id 把存档换回最新词条。已从单词本删掉的词连同它下标上的判定一起剔除，
 * 剩下的重新编号 —— 判定是按下标存的，不重编就会错位到别的卡上。
 *
 * cursor 落在被删的卡上时顺延到下一张；整轮都被删光返回 null。
 */
export function restoreSession<T extends { id: string }>(
  s: SavedSession,
  all: T[],
): Restored<T> | null {
  const byId = new Map(all.map((e) => [e.id, e] as const))
  const cards: ReviewCard<T>[] = []
  const verdicts: Record<number, boolean> = {}
  const marked: Record<number, boolean> = {}
  let cursor = 0
  let mustDo = 0
  s.cards.forEach((c, oldIndex) => {
    const item = byId.get(c.id)
    if (!item) return
    const newIndex = cards.length
    cards.push({ item, type: c.type })
    if (oldIndex in s.verdicts) verdicts[newIndex] = s.verdicts[oldIndex]
    if (oldIndex in s.marked) marked[newIndex] = s.marked[oldIndex]
    if (oldIndex < s.cursor) cursor = newIndex + 1
    if (oldIndex < s.mustDo) mustDo = newIndex + 1
  })
  if (cards.length === 0) return null
  return { cards, verdicts, marked, cursor: Math.min(cursor, cards.length - 1), mustDo }
}

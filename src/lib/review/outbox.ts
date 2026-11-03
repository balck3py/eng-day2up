import type { QuizType } from './quiz'
import { browserStorage, memoryStorage, readJson, writeJson, type KV } from './storage'

const KEY = 'review-outbox-v1'
const memory = memoryStorage()
let memoryOnly = false
// 存储被禁用或写满时，当前页面仍能发送请求。
const resilientStorage: KV = {
  getItem(key) {
    if (!memoryOnly) {
      try {
        const value = browserStorage()?.getItem(key) ?? null
        if (value !== null) memory.setItem(key, value)
        else memory.removeItem(key)
        return value
      } catch { memoryOnly = true }
    }
    return memory.getItem(key)
  },
  setItem(key, value) {
    memory.setItem(key, value)
    if (!memoryOnly) {
      try {
        const local = browserStorage()
        if (!local) memoryOnly = true
        else local.setItem(key, value)
      } catch { memoryOnly = true }
    }
  },
  removeItem(key) { memory.removeItem(key); try { browserStorage()?.removeItem(key) } catch {} },
}

/**
 * 写库失败、等着补写的请求。
 *
 * - mark：一次熟练度判定。带上作答时间，补写时服务端拿它当 last_reviewed_at ——
 *   否则三天前背的词会被记成「刚背过」，被当成今天的巩固词。
 * - leftover：一次名单覆盖。同类只留最新一条，旧名单补写了也是被覆盖。
 */
export type OutboxItem =
  | { kind: 'mark'; key: string; id: string; known: boolean; quizType: QuizType; reviewedAt: string }
  | { kind: 'leftover'; key: string; ids: string[] }

export type OutboxDraft =
  | Omit<Extract<OutboxItem, { kind: 'mark' }>, 'key'>
  | Omit<Extract<OutboxItem, { kind: 'leftover' }>, 'key'>

/**
 * 一次发送的结果：
 * ok    成功
 * auth  401，会话过期 —— 留着，等重新登录
 * retry 5xx 或网络异常 —— 留着，下次再试
 * drop  其他 4xx（记录已删、参数不对）—— 重试也不会好，丢掉
 */
export type SendOutcome = 'ok' | 'auth' | 'retry' | 'drop'

export type FetchLike = (input: string, init: RequestInit) => Promise<{ status: number }>

export function classify(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401) return 'auth'
  if (status >= 500) return 'retry'
  return 'drop'
}

/** 把一条请求发出去。commit 直发和补写走同一条路，状态码的判法只有一份。 */
export async function sendItem(item: OutboxDraft & { key?: string }, fetchFn: FetchLike): Promise<SendOutcome> {
  try {
    const res =
      item.kind === 'mark'
        ? await fetchFn('/api/review/mark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: item.id,
              eventId: item.key,
              known: item.known,
              quizType: item.quizType,
              reviewedAt: item.reviewedAt,
            }),
          })
        : await fetchFn('/api/review/leftover', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: item.ids }),
          })
    return classify(res.status)
  } catch {
    return 'retry'
  }
}

export function readOutbox(kv: KV | null = resilientStorage): OutboxItem[] {
  const raw = readJson(kv, KEY)
  return Array.isArray(raw) ? (raw as OutboxItem[]) : []
}

function randomKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function enqueue(draft: OutboxDraft, kv: KV | null = resilientStorage): OutboxItem {
  const item = { ...draft, key: randomKey() } as OutboxItem
  const rest = readOutbox(kv).filter((x) => !(item.kind === 'leftover' && x.kind === 'leftover'))
  writeJson(kv, KEY, [...rest, item])
  return item
}

/** 按 key 删，而不是整体回写 —— 补写途中 commit 可能又入队了新的 */
function removeItem(key: string, kv: KV | null): void {
  writeJson(kv, KEY, readOutbox(kv).filter((x) => x.key !== key))
}

let flushing = false

/**
 * 按入队顺序逐条补写。遇到 401 立刻停 —— 会话没恢复，后面的也必然 401。
 * 同一时刻只跑一个，focus 和 online 事件可能前后脚触发。
 *
 * 返回补写后队列的状态，供页面更新提示。
 */
export async function flushOutbox(
  fetchFn: FetchLike,
  kv: KV | null = resilientStorage,
): Promise<{ remaining: number; authExpired: boolean }> {
  if (flushing) return { remaining: readOutbox(kv).length, authExpired: false }
  flushing = true
  let authExpired = false
  try {
    for (let item = readOutbox(kv)[0]; item; item = readOutbox(kv)[0]) {
      const outcome = await sendItem(item, fetchFn)
      if (outcome === 'auth') {
        authExpired = true
        break
      }
      if (outcome === 'ok' || outcome === 'drop') removeItem(item.key, kv)
      // 前一条未成功时不越过它，避免同一词的新判定先于旧判定落库。
      if (outcome === 'retry') break
    }
  } finally {
    flushing = false
  }
  return { remaining: readOutbox(kv).length, authExpired }
}

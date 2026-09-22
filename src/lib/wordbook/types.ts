import type { Sense } from '@/lib/dict/types'

export interface WordbookEntry {
  id: string
  word: string
  wordKey: string
  sourceContext: string | null
  note: string | null
  reviewCount: number
  familiarity: number
  /** 中译英卡上拼对过几次。见 lib/review/mark.ts 的 SPELL_QUOTA */
  spellOkCount: number
  lastReviewedAt: string | null
  createdAt: string
  /** 关联词库补充的分词性中文释义（词库无此词时为空数组） */
  senses: Sense[]
  /** 关联词库补充的音标（缺失时 null） */
  phonetic: string | null
}

/** 数据库行 → 前端类型。集中在一处，避免每个调用点各写一遍字段映射。 */
export function toEntry(row: Record<string, unknown>): WordbookEntry {
  return {
    id: row.id as string,
    word: row.word as string,
    wordKey: row.word_key as string,
    sourceContext: (row.source_context as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    reviewCount: (row.review_count as number) ?? 0,
    familiarity: (row.familiarity as number) ?? 0,
    spellOkCount: (row.spell_ok_count as number) ?? 0,
    lastReviewedAt: (row.last_reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    senses: [],
    phonetic: null,
  }
}

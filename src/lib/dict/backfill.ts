import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sense } from './types'
import { lookupWord } from './lookup'
import { normalizeWord } from '@/lib/text/normalize'
import { hasChineseMeaning } from './senses'
import { generateEntryFrom } from './ai-entry'
import { buildWordBackfillPrompt } from '@/lib/translate/prompt'

/** 补全结果：释义 + 音标 + 这条释义是从哪一级来的（回给前端展示）。 */
export interface FillResult {
  senses: Sense[]
  phonetic: string | null
  source: 'dict' | 'ai' | 'web'
}

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en'
const WEB_TIMEOUT_MS = 4000

/**
 * 联网取英文释义（dictionaryapi.dev，数据源 Wiktionary，免密钥）。
 * 只取「英文释义」这一段文本，翻成中文的活儿交给模型 —— 这一步单独存在的
 * 意义是给模型一个它自己想不出来的事实来源。失败一律返回空数组。
 */
export async function fetchEnglishDefinitions(word: string): Promise<string[]> {
  try {
    const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const json: unknown = await res.json()
    if (!Array.isArray(json)) return []

    const out: string[] = []
    for (const entry of json) {
      const meanings = (entry as { meanings?: unknown })?.meanings
      if (!Array.isArray(meanings)) continue
      for (const m of meanings) {
        const pos = (m as { partOfSpeech?: unknown })?.partOfSpeech
        const defs = (m as { definitions?: unknown })?.definitions
        if (!Array.isArray(defs)) continue
        for (const d of defs.slice(0, 2)) {
          const text = (d as { definition?: unknown })?.definition
          if (typeof text !== 'string' || !text.trim()) continue
          out.push(typeof pos === 'string' ? `${pos}. ${text.trim()}` : text.trim())
          if (out.length >= 6) return out
        }
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * 把补全到的释义写回 dict_entries（按 word_key）。
 *
 * dict_entries 的 word_key 上只有索引、没有唯一约束，所以不能无脑 insert ——
 * 已存在（比如只有英文释义的那种）要 update，否则同一个词会攒出多行，
 * 之后 lookupWord 取到哪一行全看数据库心情。
 */
export async function saveSenses(
  db: SupabaseClient,
  key: string,
  senses: Sense[],
  phonetic: string | null,
): Promise<void> {
  if (senses.length === 0) return
  const translation = senses.map((s) => (s.pos ? `${s.pos} ${s.meaning}` : s.meaning)).join('\n')
  const { data: existing } = await db
    .from('dict_entries').select('id, phonetic').eq('word_key', key).limit(1).maybeSingle()

  if (existing) {
    const row = existing as { id: number; phonetic: string | null }
    await db
      .from('dict_entries')
      .update({ translation, phonetic: row.phonetic ?? phonetic })
      .eq('id', row.id)
    return
  }
  await db.from('dict_entries').insert({ word: key, translation, phonetic })
}

/**
 * 「不管什么办法都要补齐」的补全链，逐级降级，任一级拿到中文释义即停：
 *
 *   1. 词库（精确 / 词形还原 / 后缀规则）—— 不花钱，先试
 *   2. AI + 原句 —— 补不上的词大多是分词粘连（withsimultaneous）或漏收变形，
 *      给模型原句它才拆得开
 *   3. 联网查英文释义（dictionaryapi.dev）再让模型翻成中文 —— 模型自己
 *      认不出的冷僻词、专有名词靠这一级
 *
 * 三级都空才返回 null。任何一级抛异常都只往下走，不打穿整批补全。
 */
export async function fillWord(
  db: SupabaseClient,
  word: string,
  context: string | null,
): Promise<FillResult | null> {
  const key = normalizeWord(word)
  if (!key) return null

  // 第一级：词库
  try {
    const { detail } = await lookupWord(db, key)
    if (detail.matchedFrom !== 'none' && hasChineseMeaning(detail.senses)) {
      return { senses: detail.senses, phonetic: detail.phonetic, source: 'dict' }
    }
  } catch (e) {
    console.error(`补全查词失败 ${key}:`, (e as Error).message)
  }

  // 第二级：AI（带原句）
  const viaAi = await generateEntryFrom(buildWordBackfillPrompt(key, { context }), key)
  const fromAi = await settle(db, key, viaAi, 'ai')
  if (fromAi) return fromAi

  // 第三级：联网英文释义 → 交给模型翻成中文
  const defs = await fetchEnglishDefinitions(key)
  if (defs.length > 0) {
    const viaWeb = await generateEntryFrom(
      buildWordBackfillPrompt(key, { context, englishDefs: defs }),
      key,
    )
    const fromWeb = await settle(db, key, viaWeb, 'web')
    if (fromWeb) return fromWeb
  }

  return null
}

/**
 * 收下模型给的词条：要求释义里真有中文（只给英文等于没补）。
 * 模型把词纠正成了别的词形（withsimultaneous → simultaneous）时，回查一次词库 ——
 * 命中就用词库那份，比模型现编的更全。
 */
async function settle(
  db: SupabaseClient,
  key: string,
  entry: { word: string; phonetic: string | null; senses: Sense[] } | null,
  source: 'ai' | 'web',
): Promise<FillResult | null> {
  if (!entry || entry.senses.length === 0) return null

  const corrected = normalizeWord(entry.word)
  if (corrected && corrected !== key) {
    try {
      const { detail } = await lookupWord(db, corrected)
      if (detail.matchedFrom !== 'none' && hasChineseMeaning(detail.senses)) {
        return { senses: detail.senses, phonetic: detail.phonetic, source: 'dict' }
      }
    } catch {
      // 回查失败就用模型自己给的那份
    }
  }

  if (!hasChineseMeaning(entry.senses)) return null
  return { senses: entry.senses, phonetic: entry.phonetic, source }
}

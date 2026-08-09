import type { SupabaseClient } from '@supabase/supabase-js'
import { parseTranslation } from '@/lib/dict/senses'
import { stripSuffixCandidates } from '@/lib/dict/inflect'
import type { Sense } from '@/lib/dict/types'
import { tokenize } from './tokenize'
import { selectHardWords, type ScoreInput } from './score'

export interface HardWord {
  /** 命中的原型 */
  word: string
  /** 原文中的形态 */
  surface: string
  phonetic: string | null
  senses: Sense[]
  tags: string[]
}

const DEFAULT_LIMIT = 12

interface EntryRow {
  word: string
  word_key: string
  phonetic: string | null
  translation: string | null
  collins: number | null
  oxford: number | null
  tag: string | null
  bnc: number | null
  frq: number | null
}

const COLS = 'word, word_key, phonetic, translation, collins, oxford, tag, bnc, frq'

/**
 * 从段落中提取难词。全程不调用 LLM，也不调用在线词典 API ——
 * 段落里的难词卡片只要 ECDICT 的释义和保底音标就够了，展开明细才走完整
 * 的 lookupWord。这是控制段落模式延迟的关键。
 *
 * 三次批量查询搞定：词条 → 词形还原 → 用户单词本。
 */
export async function extractHardWords(
  db: SupabaseClient,
  text: string,
  userId: string,
  limit = DEFAULT_LIMIT,
): Promise<HardWord[]> {
  const tokens = tokenize(text)
  if (tokens.length === 0) return []
  const tokenKeys = tokens.map((t) => t.key)

  const familiarity = new Map<string, number>()
  const collectFamiliarity = (rows: unknown) => {
    for (const r of (rows ?? []) as { word_key: string; familiarity: number }[]) {
      familiarity.set(r.word_key, r.familiarity)
    }
  }

  // 第一批：词条命中、词形映射、用户对这些原文形态的熟练度。三者互不依赖，
  // 并行发起省两次往返（Supabase 实例在海外，单次往返约 350ms）。
  // dict_lemma 这里查全部 token 而非只查未命中的，是为了不必等第一条查询回来。
  const [directRes, lemmaRes, savedRes] = await Promise.all([
    db.from('dict_entries').select(COLS).in('word_key', tokenKeys),
    db.from('dict_lemma').select('form, lemma').in('form', tokenKeys),
    db
      .from('wordbook')
      .select('word_key, familiarity')
      .eq('user_id', userId)
      .in('word_key', tokenKeys),
  ])

  const byKey = new Map<string, EntryRow>()
  for (const r of (directRes.data ?? []) as unknown as EntryRow[]) {
    byKey.set(r.word_key, r)
  }
  collectFamiliarity(savedRes.data)

  // 未直接命中的走词形还原
  const missed = tokens.filter((t) => !byKey.has(t.key))
  if (missed.length > 0) {
    const formToLemma = new Map<string, string>()
    for (const r of (lemmaRes.data ?? []) as { form: string; lemma: string }[]) {
      if (!byKey.has(r.form) && !formToLemma.has(r.form)) {
        formToLemma.set(r.form, r.lemma)
      }
    }
    // dict_lemma 也没有的，用后缀规则再猜一批。stripSuffixCandidates 按语言学
    // 可能性降序返回，所以取 [0] 是有意义的，不是随手取第一个。
    for (const t of missed) {
      if (!formToLemma.has(t.key)) {
        const cand = stripSuffixCandidates(t.key)[0]
        if (cand) formToLemma.set(t.key, cand)
      }
    }

    const lemmaKeys = [...new Set(formToLemma.values())].filter((k) => !byKey.has(k))
    if (lemmaKeys.length > 0) {
      // 第二批：原型词条 + 用户对原型的熟练度。收藏时记的是原型，
      // 但段落里出现的往往是变形，两套 key 都得查。
      const [viaLemmaRes, savedLemmaRes] = await Promise.all([
        db.from('dict_entries').select(COLS).in('word_key', lemmaKeys),
        db
          .from('wordbook')
          .select('word_key, familiarity')
          .eq('user_id', userId)
          .in('word_key', lemmaKeys),
      ])
      collectFamiliarity(savedLemmaRes.data)

      const lemmaEntries = new Map<string, EntryRow>()
      for (const r of (viaLemmaRes.data ?? []) as unknown as EntryRow[]) {
        lemmaEntries.set(r.word_key, r)
      }
      for (const [form, lemma] of formToLemma) {
        const hit = lemmaEntries.get(lemma)
        if (hit) byKey.set(form, hit)
      }
    }
  }

  // 4) 打分选取
  const inputs: ScoreInput[] = tokens.map((t) => {
    const entry = byKey.get(t.key) ?? null
    const lemmaKey = entry?.word_key ?? t.key
    return {
      key: t.key,
      index: t.index,
      frq: entry?.frq ?? null,
      bnc: entry?.bnc ?? null,
      oxford: entry?.oxford ?? null,
      collins: entry?.collins ?? null,
      inDict: entry !== null,
      familiarity: familiarity.get(lemmaKey) ?? familiarity.get(t.key) ?? null,
    }
  })

  const surfaceOf = new Map(tokens.map((t) => [t.key, t.surface]))
  return selectHardWords(inputs, limit).map((s) => {
    const entry = byKey.get(s.key) ?? null
    return {
      word: entry?.word ?? s.key,
      surface: surfaceOf.get(s.key) ?? s.key,
      phonetic: entry?.phonetic ?? null,
      senses: parseTranslation(entry?.translation ?? null),
      tags: (entry?.tag ?? '').split(/\s+/).filter(Boolean),
    }
  })
}

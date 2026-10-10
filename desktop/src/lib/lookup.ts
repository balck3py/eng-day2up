import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWord } from './normalize'
import { parseTranslation } from './senses'
import { stripSuffixCandidates } from './inflect'
import type { MatchSource, WordDetail } from './types'

/**
 * 查词降级链（与网页 src/lib/dict/lookup.ts 一致）：精确 → dict_lemma → 后缀规则 → 未命中。
 * 客户端只读：不调 dictionaryapi.dev、不写 dict_cache、不做 AI 兜底。
 * Supabase 在海外（一次往返约 350ms），音标缓存与词条查询能并行就并行。
 */

const ENTRY_COLUMNS = 'word, phonetic, translation, collins, oxford, tag'

interface EntryRow {
  word: string
  phonetic: string | null
  translation: string | null
  collins: number | null
  oxford: number | null
  tag: string | null
}

interface Phonetics {
  us: string | null
  uk: string | null
}

async function findEntries(db: SupabaseClient, keys: string[]): Promise<EntryRow[]> {
  if (keys.length === 0) return []
  const { data } = await db.from('dict_entries').select(ENTRY_COLUMNS).in('word_key', keys)
  return (data ?? []) as EntryRow[]
}

async function findLemmas(db: SupabaseClient, form: string): Promise<string[]> {
  const { data } = await db.from('dict_lemma').select('lemma').eq('form', form)
  return ((data ?? []) as { lemma: string }[]).map((r) => r.lemma)
}

/** 批量读 dict_cache 的美/英音标；found=false 的负缓存视为没有。 */
async function readPhonetics(db: SupabaseClient, keys: string[]): Promise<Map<string, Phonetics>> {
  const out = new Map<string, Phonetics>()
  if (keys.length === 0) return out
  const { data } = await db
    .from('dict_cache')
    .select('word_key, phonetic_us, phonetic_uk, found')
    .in('word_key', keys)
  for (const r of (data ?? []) as {
    word_key: string
    phonetic_us: string | null
    phonetic_uk: string | null
    found: boolean
  }[]) {
    if (r.found) out.set(r.word_key, { us: r.phonetic_us, uk: r.phonetic_uk })
  }
  return out
}

/** 按候选优先级挑第一个命中的行，不依赖数据库返回行序（caring → care 而不是 car）。 */
export function pickInOrder(orderedKeys: string[], rows: EntryRow[]): EntryRow | null {
  const byKey = new Map(rows.map((r) => [r.word.toLowerCase(), r] as const))
  for (const key of orderedKeys) {
    const hit = byKey.get(key)
    if (hit) return hit
  }
  return null
}

function build(
  query: string,
  word: string,
  entry: EntryRow | null,
  matchedFrom: MatchSource,
  phonetics: Map<string, Phonetics>,
): WordDetail {
  const p = phonetics.get(word.toLowerCase())
  return {
    query,
    word: entry?.word ?? word,
    matchedFrom,
    phoneticUs: p?.us ?? null,
    phoneticUk: p?.uk ?? null,
    phonetic: entry?.phonetic ?? null,
    senses: parseTranslation(entry?.translation ?? null),
    tags: (entry?.tag ?? '').split(/\s+/).filter(Boolean),
    collins: entry?.collins ?? null,
    oxford: (entry?.oxford ?? 0) > 0,
  }
}

export async function lookupWord(db: SupabaseClient, raw: string): Promise<WordDetail> {
  const key = normalizeWord(raw)
  const none = new Map<string, Phonetics>()
  if (!key) return build(raw, '', null, 'none', none)

  // 第一轮：精确、词形还原、原词音标三者互不依赖，并行
  const [exact, lemmas, keyPhonetics] = await Promise.all([
    findEntries(db, [key]),
    findLemmas(db, key),
    readPhonetics(db, [key]),
  ])
  if (exact.length > 0) return build(raw, key, exact[0], 'exact', keyPhonetics)

  // 同一 form 可能对应多个 lemma，按字典序作确定性兜底
  if (lemmas.length > 0) {
    const ordered = [...lemmas].sort()
    const [rows, phonetics] = await Promise.all([
      findEntries(db, ordered),
      readPhonetics(db, ordered),
    ])
    const hit = pickInOrder(ordered, rows)
    if (hit) return build(raw, hit.word, hit, 'lemma', phonetics)
  }

  const candidates = stripSuffixCandidates(key)
  if (candidates.length > 0) {
    const [rows, phonetics] = await Promise.all([
      findEntries(db, candidates),
      readPhonetics(db, candidates),
    ])
    const hit = pickInOrder(candidates, rows)
    if (hit) return build(raw, hit.word, hit, 'suffix', phonetics)
  }

  return build(raw, key, null, 'none', keyPhonetics)
}

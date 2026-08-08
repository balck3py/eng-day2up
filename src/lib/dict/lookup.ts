import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWord } from '@/lib/text/normalize'
import { parseTranslation } from './senses'
import { stripSuffixCandidates } from './inflect'
import { getPhonetics } from './dictapi'
import type { MatchSource, WordDetail } from './types'

const ENTRY_COLUMNS = 'word, phonetic, translation, collins, oxford, tag'

interface EntryRow {
  word: string
  phonetic: string | null
  translation: string | null
  collins: number | null
  oxford: number | null
  tag: string | null
}

async function findEntries(
  db: SupabaseClient, keys: string[],
): Promise<EntryRow[]> {
  if (keys.length === 0) return []
  const { data, error } = await db.from('dict_entries').select(ENTRY_COLUMNS).in('word_key', keys)
  if (error) return []
  return (data ?? []) as unknown as EntryRow[]
}

async function findLemmas(db: SupabaseClient, form: string): Promise<string[]> {
  const { data, error } = await db.from('dict_lemma').select('lemma').eq('form', form)
  if (error) return []
  return ((data ?? []) as { lemma: string }[]).map((r) => r.lemma)
}

function build(
  query: string, key: string, entry: EntryRow | null,
  matchedFrom: MatchSource, phonetics: Awaited<ReturnType<typeof getPhonetics>>,
): WordDetail {
  return {
    query,
    word: entry?.word ?? key,
    matchedFrom,
    phonetic: entry?.phonetic ?? null,
    phoneticUs: phonetics.phoneticUs,
    phoneticUk: phonetics.phoneticUk,
    audioUs: phonetics.audioUs,
    audioUk: phonetics.audioUk,
    senses: parseTranslation(entry?.translation ?? null),
    tags: (entry?.tag ?? '').split(/\s+/).filter(Boolean),
    collins: entry?.collins ?? null,
    oxford: (entry?.oxford ?? 0) > 0,
  }
}

/**
 * 四级降级查询：精确 → 词形还原 → 后缀规则 → 未命中。
 * 任一级命中即停；无论结果如何都会补充在线音标。
 */
export async function lookupWord(
  db: SupabaseClient, raw: string,
): Promise<WordDetail> {
  const key = normalizeWord(raw)
  if (!key) {
    // 空键不查库也不调在线 API —— 否则会往 dict_cache 写一条 word_key='' 的垃圾负缓存
    return build(raw, '', null, 'none', {
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  }

  // 第一级：精确命中
  const exact = await findEntries(db, [key])
  if (exact.length > 0) {
    return build(raw, key, exact[0], 'exact', await getPhonetics(db, key))
  }

  // 第二级：dict_lemma 词形还原
  const lemmas = await findLemmas(db, key)
  if (lemmas.length > 0) {
    const viaLemma = await findEntries(db, lemmas)
    if (viaLemma.length > 0) {
      const hit = viaLemma[0]
      return build(raw, hit.word, hit, 'lemma', await getPhonetics(db, hit.word))
    }
  }

  // 第三级：后缀规则兜底
  const candidates = stripSuffixCandidates(key)
  const viaSuffix = await findEntries(db, candidates)
  if (viaSuffix.length > 0) {
    const hit = viaSuffix[0]
    return build(raw, hit.word, hit, 'suffix', await getPhonetics(db, hit.word))
  }

  // 第四级：未命中，仍返回在线音标
  return build(raw, key, null, 'none', await getPhonetics(db, key))
}

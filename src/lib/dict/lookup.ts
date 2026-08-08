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
  const { data } = await db.from('dict_entries').select(ENTRY_COLUMNS).in('word_key', keys)
  return (data ?? []) as unknown as EntryRow[]
}

async function findLemmas(db: SupabaseClient, form: string): Promise<string[]> {
  const { data } = await db.from('dict_lemma').select('lemma').eq('form', form)
  return ((data ?? []) as { lemma: string }[]).map((r) => r.lemma)
}

/**
 * 从一批候选 key（已按调用方期望的优先级排好序）里，选出第一个能在
 * `rows` 里找到匹配行的那个，而不是简单取 `rows[0]`。
 *
 * `dict_entries` 的 `word_key` 是 `lower(word)` 生成列，所以用
 * `entry.word.toLowerCase()` 反查回候选 key 是可靠的。
 *
 * 这存在的意义：一次 `IN` 查询可能同时命中多个真实存在的候选词
 * （例如 caring 的后缀候选 car / care 都是真词），此时 Postgres
 * 不保证返回行序与 IN 列表顺序一致，直接取第一行会让同一输入偶尔
 * 给出不同、且可能错误的答案（caring → car 而不是 care）。按候选
 * 优先级顺序去找，结果才是确定性的。
 */
function pickInOrder(orderedKeys: string[], rows: EntryRow[]): EntryRow | null {
  const byKey = new Map(rows.map((r) => [r.word.toLowerCase(), r] as const))
  for (const key of orderedKeys) {
    const hit = byKey.get(key)
    if (hit) return hit
  }
  return null
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
  // 同一个 form 可能对应多个 lemma（如 saw → see / saw），且没有词性
  // 上下文时无法可靠判断哪个更贴切；这里按字典序排序作为确定性兜底，
  // 保证同一输入每次都得到同一结果，而不是依赖数据库的返回行序。
  const lemmas = await findLemmas(db, key)
  if (lemmas.length > 0) {
    const orderedLemmas = [...lemmas].sort()
    const viaLemma = await findEntries(db, orderedLemmas)
    const hit = pickInOrder(orderedLemmas, viaLemma)
    if (hit) {
      return build(raw, hit.word, hit, 'lemma', await getPhonetics(db, hit.word))
    }
  }

  // 第三级：后缀规则兜底
  // stripSuffixCandidates 按语言学上更可能的原型降序排列（如 caring 的
  // care 排在 car 之前），必须按这个顺序挑赢家，不能取查询返回的第一行。
  const candidates = stripSuffixCandidates(key)
  const viaSuffix = await findEntries(db, candidates)
  const suffixHit = pickInOrder(candidates, viaSuffix)
  if (suffixHit) {
    return build(raw, suffixHit.word, suffixHit, 'suffix', await getPhonetics(db, suffixHit.word))
  }

  // 第四级：未命中，仍返回在线音标
  return build(raw, key, null, 'none', await getPhonetics(db, key))
}

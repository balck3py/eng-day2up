import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWord } from '@/lib/text/normalize'
import { parseTranslation } from './senses'
import { stripSuffixCandidates } from './inflect'
import { readCachedPhonetics } from './dictapi'
import type { MatchSource, PhoneticSet, WordDetail } from './types'

const EMPTY_PHONETICS: PhoneticSet = {
  phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
}

/** lookupWord 的返回值：查询结果 + 需要在响应后台补抓音标的词（无需补抓则为 null）。 */
export interface LookupResult {
  detail: WordDetail
  /** 供调用方传给 after() 里的 refreshPhonetics；命中缓存或空输入时为 null。 */
  refreshPhoneticsKey: string | null
}

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
  matchedFrom: MatchSource, phonetics: PhoneticSet,
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
 * 组装最终结果：只读 dict_cache（一次数据库往返，不等网络），命中就用，
 * 未命中就先用空音标应答，并把 phoneticsKey 报给调用方，由 route.ts 在
 * after() 里补抓、写回缓存。
 */
async function withPhonetics(
  db: SupabaseClient, raw: string, key: string, entry: EntryRow | null,
  matchedFrom: MatchSource, phoneticsKey: string,
): Promise<LookupResult> {
  const cached = await readCachedPhonetics(db, phoneticsKey)
  return {
    detail: build(raw, key, entry, matchedFrom, cached ?? EMPTY_PHONETICS),
    refreshPhoneticsKey: cached ? null : phoneticsKey,
  }
}

/**
 * 四级降级查询：精确 → 词形还原 → 后缀规则 → 未命中。
 * 任一级命中即停；无论结果如何都会尝试补充在线音标（缓存命中则同步返回，
 * 未命中则空音标应答 + 报告需要后台补抓的词）。
 */
export async function lookupWord(
  db: SupabaseClient, raw: string,
): Promise<LookupResult> {
  const key = normalizeWord(raw)
  if (!key) {
    // 空键不查库也不调在线 API —— 否则会往 dict_cache 写一条 word_key='' 的垃圾负缓存
    return {
      detail: build(raw, '', null, 'none', EMPTY_PHONETICS),
      refreshPhoneticsKey: null,
    }
  }

  // 第一级（精确）与第二级（词形还原）互不依赖，并行发起以省一次往返。
  // exact 命中时 lemma 结果直接丢弃；并行只改变何时发起查询，
  // 绝不改变降级优先级 —— exact 仍优先于 lemma，lemma 仍优先于 suffix。
  const [exact, lemmas] = await Promise.all([
    findEntries(db, [key]),
    findLemmas(db, key),
  ])

  // 第一级：精确命中
  if (exact.length > 0) {
    return withPhonetics(db, raw, key, exact[0], 'exact', key)
  }

  // 第二级：dict_lemma 词形还原
  // 同一个 form 可能对应多个 lemma（如 saw → see / saw），且没有词性
  // 上下文时无法可靠判断哪个更贴切；这里按字典序排序作为确定性兜底，
  // 保证同一输入每次都得到同一结果，而不是依赖数据库的返回行序。
  if (lemmas.length > 0) {
    const orderedLemmas = [...lemmas].sort()
    const viaLemma = await findEntries(db, orderedLemmas)
    const hit = pickInOrder(orderedLemmas, viaLemma)
    if (hit) {
      return withPhonetics(db, raw, hit.word, hit, 'lemma', hit.word)
    }
  }

  // 第三级：后缀规则兜底
  // stripSuffixCandidates 按语言学上更可能的原型降序排列（如 caring 的
  // care 排在 car 之前），必须按这个顺序挑赢家，不能取查询返回的第一行。
  const candidates = stripSuffixCandidates(key)
  const viaSuffix = await findEntries(db, candidates)
  const suffixHit = pickInOrder(candidates, viaSuffix)
  if (suffixHit) {
    return withPhonetics(db, raw, suffixHit.word, suffixHit, 'suffix', suffixHit.word)
  }

  // 第四级：未命中，仍尝试返回音标（缓存命中则同步返回，否则后台补抓）
  return withPhonetics(db, raw, key, null, 'none', key)
}

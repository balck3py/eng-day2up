import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhoneticSet } from './types'

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en'
// 只提供音标，媒体 CDN 在用户网络下本就不可用，等 3 秒没有意义；
// 缩短超时只影响 refreshPhonetics 的后台任务，不再阻塞响应。
const FETCH_TIMEOUT_MS = 2000
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000

const EMPTY: PhoneticSet = {
  phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
}

/**
 * 解析 dictionaryapi.dev 响应，按音频文件名的 -us. / -uk. 后缀区分方言。
 * 数据源为 Wiktionary，覆盖不全时优雅降级 —— 绝不编造音标。
 */
export function parseDictApi(json: unknown): PhoneticSet {
  if (!Array.isArray(json) || json.length === 0) return { ...EMPTY }

  const result: PhoneticSet = { ...EMPTY }
  let fallbackText: string | null = null

  for (const entry of json) {
    const phonetics = (entry as { phonetics?: unknown })?.phonetics
    if (!Array.isArray(phonetics)) continue

    for (const p of phonetics) {
      if (typeof p !== 'object' || p === null) continue
      const rec = p as { text?: unknown; audio?: unknown }
      const text = typeof rec.text === 'string' && rec.text ? rec.text : null
      const audio = typeof rec.audio === 'string' ? rec.audio : ''

      if (audio.includes('-us.')) {
        if (result.audioUs === null) result.audioUs = audio
        if (result.phoneticUs === null && text) result.phoneticUs = text
      } else if (audio.includes('-uk.')) {
        if (result.audioUk === null) result.audioUk = audio
        if (result.phoneticUk === null && text) result.phoneticUk = text
      } else if (text && fallbackText === null) {
        fallbackText = text
      }
    }
  }

  if (result.phoneticUs === null) result.phoneticUs = fallbackText
  if (result.phoneticUk === null) result.phoneticUk = fallbackText
  return result
}

/**
 * 只读 dict_cache 里未过期的一行，不发起任何网络请求。
 * 未命中或已过期 TTL 时返回 null。
 */
async function readFreshCache(
  admin: SupabaseClient,
  wordKey: string,
): Promise<PhoneticSet | null> {
  const { data: cached } = await admin
    .from('dict_cache')
    .select('*')
    .eq('word_key', wordKey)
    .maybeSingle()

  if (!cached) return null
  const age = Date.now() - new Date(cached.fetched_at as string).getTime()
  if (age >= CACHE_TTL_MS) return null
  if (!cached.found) return { ...EMPTY }
  return {
    phoneticUs: cached.phonetic_us as string | null,
    phoneticUk: cached.phonetic_uk as string | null,
    audioUs: cached.audio_us as string | null,
    audioUk: cached.audio_uk as string | null,
  }
}

/**
 * 只读 dict_cache，供请求路径同步调用 —— 绝不发网络请求，因此耗时
 * 只有一次数据库往返。未命中（或已过期）时返回 null，调用方应回落到
 * ECDICT 的 phonetic 列，并在响应后用 refreshPhonetics 补抓。
 */
export async function readCachedPhonetics(
  admin: SupabaseClient,
  wordKey: string,
): Promise<PhoneticSet | null> {
  return readFreshCache(admin, wordKey)
}

/**
 * 抓取 dictionaryapi.dev 并写入 dict_cache。不读缓存、不做 TTL 判断——
 * 调用方（getPhonetics 或 refreshPhonetics）负责决定何时需要抓取。
 *
 * 缓存策略上区分两种失败：
 * - API 明确返回 404（词不存在）→ 写 found=false 负缓存，避免反复空请求
 * - 网络错误 / 超时 → 不写缓存，下次重试
 */
async function fetchAndCache(
  admin: SupabaseClient,
  wordKey: string,
): Promise<PhoneticSet> {
  let parsed: PhoneticSet
  let notFound = false
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(wordKey)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 404) {
      notFound = true
      parsed = { ...EMPTY }
    } else if (!res.ok) {
      return { ...EMPTY }   // 5xx 等临时故障，不写缓存
    } else {
      const json: unknown = await res.json()
      parsed = parseDictApi(json)   // 解析纳入 try/catch，任何解析异常都不应打穿整个请求
    }
  } catch {
    return { ...EMPTY }     // 网络错误 / 超时 / 解析异常，不写缓存
  }

  await admin.from('dict_cache').upsert({
    word_key: wordKey,
    phonetic_us: parsed.phoneticUs,
    phonetic_uk: parsed.phoneticUk,
    audio_us: parsed.audioUs,
    audio_uk: parsed.audioUk,
    found: !notFound,
    fetched_at: new Date().toISOString(),
  })

  return parsed
}

/**
 * 供 after() 在响应送出后调用：抓取并写缓存，不返回结果、失败只记日志，
 * 绝不能抛出（serverless 环境下未捕获异常可能影响后续任务生命周期）。
 */
export async function refreshPhonetics(
  admin: SupabaseClient,
  wordKey: string,
): Promise<void> {
  try {
    await fetchAndCache(admin, wordKey)
  } catch (err) {
    console.error(`refreshPhonetics(${wordKey}) 失败`, err)
  }
}

/**
 * 取音标，优先读 dict_cache，未命中则同步抓取。
 *
 * 会阻塞到网络请求返回（未缓存时最多 ${FETCH_TIMEOUT_MS}ms）——
 * 请求路径应改用 readCachedPhonetics + refreshPhonetics 的组合以避免
 * 阻塞响应，这个函数保留给测试和其他非请求路径的调用方使用。
 */
export async function getPhonetics(
  admin: SupabaseClient,
  wordKey: string,
): Promise<PhoneticSet> {
  const cached = await readFreshCache(admin, wordKey)
  if (cached) return cached
  return fetchAndCache(admin, wordKey)
}

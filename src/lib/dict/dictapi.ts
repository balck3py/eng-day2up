import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhoneticSet } from './types'

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en'
const FETCH_TIMEOUT_MS = 3000
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
 * 取音标，优先读 dict_cache。
 *
 * 缓存策略上区分两种失败：
 * - API 明确返回 404（词不存在）→ 写 found=false 负缓存，避免反复空请求
 * - 网络错误 / 超时 → 不写缓存，下次重试
 */
export async function getPhonetics(
  admin: SupabaseClient,
  wordKey: string,
): Promise<PhoneticSet> {
  const { data: cached } = await admin
    .from('dict_cache')
    .select('*')
    .eq('word_key', wordKey)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      if (!cached.found) return { ...EMPTY }
      return {
        phoneticUs: cached.phonetic_us as string | null,
        phoneticUk: cached.phonetic_uk as string | null,
        audioUs: cached.audio_us as string | null,
        audioUk: cached.audio_uk as string | null,
      }
    }
  }

  let json: unknown
  let notFound = false
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(wordKey)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 404) {
      notFound = true
    } else if (!res.ok) {
      return { ...EMPTY }   // 5xx 等临时故障，不写缓存
    } else {
      json = await res.json()
    }
  } catch {
    return { ...EMPTY }     // 网络错误或超时，不写缓存
  }

  const parsed = notFound ? { ...EMPTY } : parseDictApi(json)

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

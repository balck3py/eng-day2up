import { normalizeWord } from '@/lib/text/normalize'
import { isAiFallbackEligible } from './ai-parse'
import { getLocalModelConfig, generateLocalWordEntry } from '@/lib/translate/localModel'
import { getRequestSource, getDeviceConfig, authorizeDeviceRequest } from '@/lib/translate/deviceTranslation'
import type { AiEntry, WordDetail } from './types'

/** 拉取服务端词条；?ai=skip 时服务端不做云端兜底。失败返回 null。 */
async function fetchDetail(word: string, signal?: AbortSignal): Promise<WordDetail | null> {
  try {
    const res = await fetch(`/api/word/${encodeURIComponent(word)}?ai=skip`, { signal })
    if (!res.ok) return null
    return (await res.json()) as WordDetail
  } catch {
    return null
  }
}

/**
 * 浏览器侧查词：默认走服务端 /api/word（含服务端 AI 兜底）。
 * 若配置了本地模型，则让服务端跳过它那套 AI 兜底（?ai=skip），改由浏览器
 * 直连本地模型为未收录词生成词条（含拼写纠正、音标、释义），并回写词库（收录）。
 * 失败返回 null，由调用方展示「查询失败」。
 */
export async function lookupWordClient(word: string, signal?: AbortSignal): Promise<WordDetail | null> {
  const local = getLocalModelConfig()
  const device = !local && getRequestSource() === 'device'

  if (!local && !device) {
    // 无本地模型：直接用服务端（内部已含 AI 兜底），不加 ?ai=skip
    try {
      const res = await fetch(`/api/word/${encodeURIComponent(word)}`, { signal })
      if (!res.ok) return null
      return (await res.json()) as WordDetail
    } catch {
      return null
    }
  }

  // 有本地模型：服务端跳过兜底，未命中时由本地模型接手
  let detail = await fetchDetail(word, signal)
  if (!detail) return null
  if (detail.matchedFrom !== 'none') return detail

  const key = normalizeWord(word)
  if (!isAiFallbackEligible(key)) return detail

  let ai: AiEntry | null
  try {
    const config = local ?? await getDeviceConfig(signal)
    if (device) await authorizeDeviceRequest(signal)
    ai = device ? await generateLocalWordEntry(key, config, signal, true) : await generateLocalWordEntry(key, config, signal)
  } catch { return null }
  if (!ai) return detail

  if (signal?.aborted) return null
  const corrected = ai.word
  // 纠正后的词可能本就在词库里：回查一次，命中就用真实词条
  if (corrected !== key) {
    const retry = await fetchDetail(corrected, signal)
    if (retry && retry.matchedFrom !== 'none') {
      return { ...retry, query: word, correctedFrom: word }
    }
  }

  // 词库没有：用 AI 释义并回写（失败不影响本次展示）
  void fetch('/api/ai-entry', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: corrected, senses: ai.senses, phonetic: ai.phonetic }),
  }).catch(() => {})

  detail = {
    ...detail,
    word: corrected,
    matchedFrom: 'ai',
    correctedFrom: corrected !== key ? word : null,
    senses: ai.senses,
    phonetic: ai.phonetic,
  }
  return detail
}

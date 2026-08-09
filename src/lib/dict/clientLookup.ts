import { normalizeWord } from '@/lib/text/normalize'
import { isAiFallbackEligible } from './ai-parse'
import { getLocalModelConfig, generateLocalWordSenses } from '@/lib/translate/localModel'
import type { WordDetail } from './types'

/**
 * 浏览器侧查词：默认走服务端 /api/word（含服务端 AI 兜底）。
 * 若配置了本地模型，则让服务端跳过它那套 AI 兜底（?ai=skip），改由浏览器
 * 直连本地模型为未收录词生成释义，并回写词库（收录）。
 * 失败返回 null，由调用方展示「查询失败」。
 */
export async function lookupWordClient(word: string): Promise<WordDetail | null> {
  const local = getLocalModelConfig()
  const url = `/api/word/${encodeURIComponent(word)}${local ? '?ai=skip' : ''}`

  let detail: WordDetail
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    detail = (await res.json()) as WordDetail
  } catch {
    return null
  }

  if (local && detail.matchedFrom === 'none') {
    const key = normalizeWord(word)
    if (isAiFallbackEligible(key)) {
      const senses = await generateLocalWordSenses(key, local)
      if (senses && senses.length > 0) {
        detail = { ...detail, word: key, matchedFrom: 'ai', senses }
        // 回写库让这个词被收录，失败不影响本次展示
        void fetch('/api/ai-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: key, senses }),
        }).catch(() => {})
      }
    }
  }
  return detail
}

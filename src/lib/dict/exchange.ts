import type { LemmaPair } from './types'

/** 这些键的值是 word 的变形形式 */
const FORM_KEYS = new Set(['p', 'd', 'i', '3', 's', 'r', 't'])

/**
 * 把 ECDICT 的 exchange 字段展开为 (词形 → 原型) 映射对。
 * 键 `0` 方向相反：此时 word 自身是变形，值才是原型。
 * 键 `1` 只是变形类型说明，忽略。
 */
export function parseExchange(word: string, exchange: string): LemmaPair[] {
  if (!exchange) return []
  const base = word.trim().toLowerCase()
  if (!base) return []

  const out = new Map<string, LemmaPair>()
  for (const part of exchange.split('/')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim().toLowerCase()
    if (!val) continue

    if (FORM_KEYS.has(key)) {
      if (val !== base) out.set(`${val}|${base}`, { form: val, lemma: base })
    } else if (key === '0') {
      if (val !== base) out.set(`${base}|${val}`, { form: base, lemma: val })
    }
  }
  return [...out.values()]
}

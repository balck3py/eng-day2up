import type { Sense } from './types'

/** 行首的词性标记，如 'n.' 'vt.' 'adj.'；只匹配 ASCII 字母 */
const POS_PREFIX_RE = /^([a-z]+\.)\s*(.+)$/i

/**
 * 把 ECDICT 的 translation 字段解析为分词性的释义列表。
 * CSV 中换行被转义为字面的 `\n`，此处同时兼容两种形式。
 */
export function parseTranslation(translation: string | null): Sense[] {
  if (!translation) return []
  return translation
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = POS_PREFIX_RE.exec(line)
      return m
        ? { pos: m[1].toLowerCase(), meaning: m[2].trim() }
        : { pos: '', meaning: line }
    })
}

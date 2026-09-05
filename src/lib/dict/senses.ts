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

/** 是否含中文字符（CJK 统一表意文字）。 */
export function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text)
}

/**
 * 释义里有没有中文。词库里存在但只有英文释义（AI 兜底偶尔会这样）
 * 对复习来说等于没有释义 —— 中译英出不了题，英译中翻过去也看不懂。
 */
export function hasChineseMeaning(senses: Sense[]): boolean {
  return senses.some((s) => hasChinese(s.meaning))
}

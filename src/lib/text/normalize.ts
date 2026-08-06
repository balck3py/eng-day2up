const SINGLE_WORD_RE = /^[a-zA-Z][a-zA-Z'-]*$/

/** 判定输入应走单词模式（true）还是段落模式（false）。 */
export function isSingleWord(raw: string): boolean {
  return SINGLE_WORD_RE.test(raw.trim())
}

/**
 * 规范化为可用于 word_key 匹配的键：
 * 剥掉首尾非字母字符（词内的撇号与连字符保留），再转小写。
 */
export function normalizeWord(raw: string): string {
  return raw
    .trim()
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/[^a-zA-Z]+$/, '')
    .toLowerCase()
}

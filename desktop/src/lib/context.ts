import { isSingleWord } from './normalize'
import { indexOfWord, sentenceAt, sentenceOf } from './sentence'
import type { Selection } from './types'

export const MAX_SELECTION = 5000

export type Mode =
  | { kind: 'empty' }
  | { kind: 'word'; word: string }
  | { kind: 'text'; text: string; truncated: boolean }

/** 选中内容 → 模式。去掉首尾空白和标点后是单个英文词即单词模式（"ubiquitous," → ubiquitous）。 */
export function modeOf(raw: string): Mode {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }
  const core = text.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '')
  if (isSingleWord(core)) return { kind: 'word', word: core }
  return {
    kind: 'text',
    text: text.slice(0, MAX_SELECTION),
    truncated: text.length > MAX_SELECTION,
  }
}

/** surface 在 paragraph 的 [start, start+len) 处是否确实是这个词（UIA 偏移不可靠时用来校验）。 */
function matchesAt(paragraph: string, start: number, surface: string): boolean {
  return paragraph.slice(start, start + surface.length).toLowerCase() === surface.toLowerCase()
}

/**
 * 收藏时写入的 source_context：
 * - 单词模式 + 有段落：按段落 + 偏移取所在句子；
 * - 单词模式 + 无段落（剪贴板路径）：null；
 * - 文本模式点难词：取该词在选中文本里的那次出现，有段落时在段落里扩成完整句子。
 */
export function resolveContext(
  sel: Pick<Selection, 'text' | 'paragraph' | 'offset'>,
  mode: 'word' | 'text',
  surface: string,
): string | null {
  const { paragraph, offset } = sel
  const hasParagraph = paragraph !== null && offset !== null

  if (mode === 'word') {
    if (!hasParagraph) return null
    const start = offset + Math.max(0, indexOfWord(sel.text, surface))
    if (matchesAt(paragraph, start, surface)) {
      return sentenceAt(paragraph, start, start + surface.length)
    }
    return sentenceOf(paragraph, surface)
  }

  const i = indexOfWord(sel.text, surface)
  if (i < 0) return null
  if (hasParagraph && matchesAt(paragraph, offset + i, surface)) {
    return sentenceAt(paragraph, offset + i, offset + i + surface.length)
  }
  return sentenceOf(sel.text, surface)
}

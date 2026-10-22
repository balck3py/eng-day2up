/**
 * 切句：给定文本与选区（或目标词），取出所在句子，最多 500 字。
 * desktop/src/lib/sentence.ts 有一份副本，规则变更时两边同步（见 sentence.vectors.ts）。
 */

export const MAX_SENTENCE = 500

const ABBREVIATIONS = new Set([
  'e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'u.s.', 'u.k.', 'no.', 'fig.',
])
const CLOSERS = `"'”’)]」』）`
const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c)
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

/** `.` 或 `…` 在 i 处是否不应断句：缩写、首字母、省略号后接小写。 */
function suppressed(text: string, i: number): boolean {
  const ellipsis = text[i] === '…' || text.slice(i - 2, i + 1) === '...'
  if (ellipsis) {
    const next = text.slice(i + 1).match(/\S/)?.[0]
    return !!next && /[a-z]/.test(next)
  }
  let j = i
  while (j > 0 && (isLetter(text[j - 1]) || text[j - 1] === '.')) j--
  const token = text.slice(j, i + 1)
  if (ABBREVIATIONS.has(token.toLowerCase())) return true
  // 单个大写字母加点：J. K. Rowling
  return /^[A-Z]\.$/.test(token)
}

/** 所有切分点 p：text[..p) 与 text[p..) 属于不同句子。 */
function cuts(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\n' || c === '\r') {
      out.push(i + 1)
    } else if ('。！？'.includes(c)) {
      let k = i + 1
      while (k < text.length && CLOSERS.includes(text[k])) k++
      out.push(k)
    } else if ('.!?…'.includes(c)) {
      let k = i + 1
      while (k < text.length && CLOSERS.includes(text[k])) k++
      if (!isSpace(text[k])) continue
      if ((c === '.' || c === '…') && suppressed(text, i)) continue
      out.push(k)
    }
  }
  return out
}

/** 返回包含 [start, end) 的句子（去首尾空白，≤ 500 字）；区间非法或结果为空时返回 null。 */
export function sentenceAt(text: string, start: number, end: number): string | null {
  if (start < 0 || end > text.length || start >= end) return null
  let from = 0
  let to = text.length
  for (const p of cuts(text)) {
    if (p <= start) from = p
    else if (p >= end) {
      to = p
      break
    }
  }
  // 去掉首尾空白，同时保持选区坐标
  while (from < start && /\s/.test(text[from])) from++
  while (to > end && /\s/.test(text[to - 1])) to--
  if (to - from <= MAX_SENTENCE) return text.slice(from, to) || null
  return clip(text, from, to, start, end)
}

/** 以选区为中心截取 ≤ 500 字的窗口，被截一侧加 …；必须完整包含选区。 */
function clip(text: string, from: number, to: number, start: number, end: number): string {
  const room = MAX_SENTENCE - 2 // 预留两侧省略号
  const len = end - start
  if (len >= room) return text.slice(start, start + MAX_SENTENCE)
  let left = Math.max(from, start - Math.floor((room - len) / 2))
  const right = Math.min(to, left + room)
  left = Math.max(from, right - room)
  return (left > from ? '…' : '') + text.slice(left, right) + (right < to ? '…' : '')
}

/** 按词边界（前后不是字母、撇号、连字符）、大小写不敏感找 word 第一次出现的下标，找不到返回 -1。 */
export function indexOfWord(text: string, word: string): number {
  if (!word) return -1
  const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const isWordChar = (c: string | undefined) => isLetter(c) || c === "'" || c === '-'
  for (const m of text.matchAll(re)) {
    if (!isWordChar(text[m.index - 1]) && !isWordChar(text[m.index + m[0].length])) return m.index
  }
  return -1
}

/** 找到 surface 第一次出现的位置，返回所在句子；找不到返回 null。 */
export function sentenceOf(text: string, surface: string): string | null {
  const word = surface.trim()
  const i = indexOfWord(text, word)
  return i < 0 ? null : sentenceAt(text, i, i + word.length)
}

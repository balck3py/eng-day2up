/** 与 /api/wordbook 对 source_context 的截断一致 */
const MAX_CONTEXT = 500

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

function clip(s: string): string {
  const t = s.trim()
  return t.length > MAX_CONTEXT ? t.slice(0, MAX_CONTEXT) : t
}

/** 段落文本中 offset 所在的那一句。 */
export function sentenceAt(text: string, offset: number): string {
  for (const seg of segmenter.segment(text)) {
    if (offset >= seg.index && offset < seg.index + seg.segment.length) return clip(seg.segment)
  }
  return clip(text)
}

/** 段落中第一句以整词形式包含 word 的句子；没有则退回整段。 */
export function sentenceContaining(text: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`, 'i')
  for (const seg of segmenter.segment(text)) {
    if (re.test(seg.segment)) return clip(seg.segment)
  }
  return clip(text)
}

/**
 * 段落中与 [start, end) 有交集的所有句子拼起来 —— 选了半句也补成整句。
 * 不截断：它是给 sentenceContaining 再挑句子用的素材，不直接入库。
 */
export function sentencesCovering(text: string, start: number, end: number): string {
  const hit: string[] = []
  for (const seg of segmenter.segment(text)) {
    const segEnd = seg.index + seg.segment.length
    if (seg.index < end && segEnd > start) hit.push(seg.segment)
  }
  return (hit.length ? hit.join('') : text).trim()
}

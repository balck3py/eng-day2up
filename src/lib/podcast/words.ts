import type { Cue } from './types'

export interface WordTiming {
  startOffset: number
  endOffset: number
  startMs: number
  endMs: number
}
export interface AlignedSentence {
  cueId: string
  startMs: number
  endMs: number
  words: readonly WordTiming[]
}
export type WordAlignment = ReadonlyMap<string, AlignedSentence>

/** The same visible text is used for rendering, offsets and alignment. */
export function subtitleText(text: string) {
  const speaker = text.match(/^([^:\n]{1,30}:)\s*/)?.[0] ?? ''
  return { speaker: speaker.trim().replace(/:$/, ''), body: text.slice(speaker.length) }
}

function key(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Offsets always refer to the original visible UTF-16 string, never normalized text. */
export function wordTokens(text: string) {
  return Array.from(text.matchAll(/\S+/gu)).flatMap((match) => {
    const normalized = key(match[0])
    return normalized ? [{ startOffset: match.index, endOffset: match.index + match[0].length, key: normalized }] : []
  })
}

const WINDOW_MS = 1500 // Candidate validation only. Never added to audio positions.
const END_WINDOW_MS = 3000 // Sentence-level ends may include a longer trailing pause.
const MAX_CANDIDATES = 128

/** Full, unique, monotone sentence matches only; a bad sentence cannot shift later ones. */
export function alignWords(sentences: readonly Cue[], source: readonly Cue[]): WordAlignment {
  const result = new Map<string, AlignedSentence>()
  const words = source.map((cue) => {
    const tokens = wordTokens(cue.text)
    return { ...cue, key: tokens.length === 1 ? tokens[0].key : null }
  })
  let consumed = 0
  for (const cue of sentences) {
    const tokens = wordTokens(subtitleText(cue.text).body)
    if (!tokens.length) continue
    let low = consumed, high = words.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (words[mid].startMs < cue.startMs - WINDOW_MS) low = mid + 1
      else high = mid
    }
    let matched = -1, candidates = 0, ambiguous = false
    for (let i = low; i < words.length && words[i].startMs <= cue.startMs + WINDOW_MS; i++) {
      if (++candidates > MAX_CANDIDATES) { ambiguous = true; break }
      if (i + tokens.length > words.length) break
      const last = words[i + tokens.length - 1]
      if (Math.abs(last.endMs - cue.endMs) > END_WINDOW_MS) continue
      const valid = tokens.every((token, j) => {
        const word = words[i + j]
        return token.key === word.key && Number.isFinite(word.startMs) && Number.isFinite(word.endMs) &&
          word.startMs >= 0 && word.endMs > word.startMs &&
          (j === 0 || word.startMs >= words[i + j - 1].endMs)
      })
      if (!valid) continue
      if (matched !== -1) { ambiguous = true; break }
      matched = i
    }
    if (matched === -1 || ambiguous) continue
    const mapped = tokens.map((token, j): WordTiming => ({
      startOffset: token.startOffset, endOffset: token.endOffset,
      startMs: words[matched + j].startMs, endMs: words[matched + j].endMs,
    }))
    result.set(cue.id, { cueId: cue.id, startMs: mapped[0].startMs, endMs: mapped[mapped.length - 1].endMs, words: mapped })
    consumed = matched + tokens.length
  }
  return result
}

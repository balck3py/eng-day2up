import type { Cue } from './types'

function milliseconds(value: string): number {
  const [h, m, s, ms] = value.split(/[:,]/).map(Number)
  return m < 60 && s < 60 ? ((h * 60 + m) * 60 + s) * 1000 + ms : NaN
}

export function parseSrt(source: string): Cue[] {
  return source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)
    .flatMap((block, index) => {
      const lines = block.split('\n')
      const timing = lines.findIndex((line) => line.includes('-->'))
      const match = lines[timing]?.match(/^(\d{2,}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2},\d{3})(?:\s.*)?$/)
      if (!match) return []
      const startMs = milliseconds(match[1]), endMs = milliseconds(match[2])
      const text = lines.slice(timing + 1).join('\n').trim()
      return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && text
        ? [{ id: String(index), startMs, endMs, text }] : []
    }).sort((a, b) => a.startMs - b.startMs)
}

export function pairCues(english: Cue[], chinese: Cue[]): Cue[] {
  const translations = new Map<string, string>()
  for (const cue of chinese) {
    const key = `${cue.startMs}:${cue.endMs}`
    if (!translations.has(key)) translations.set(key, cue.text)
  }
  return english.map((cue) => ({ ...cue, chineseText: translations.get(`${cue.startMs}:${cue.endMs}`) }))
}

export function cueAt(cues: Cue[], timeMs: number): Cue | undefined {
  // Last starting cue wins when intervals overlap. Gaps have no active cue.
  return cues.findLast((cue) => cue.startMs <= timeMs && cue.endMs > timeMs)
}

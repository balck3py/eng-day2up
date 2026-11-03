import { expect, it } from 'vitest'
import { alignWords, subtitleText, wordTokens } from './words'
import type { Cue } from './types'

const cue = (id: string, startMs: number, endMs: number, text: string): Cue => ({ id, startMs, endMs, text })
const sentence = cue('a', 1000, 2500, 'Erinome: Hello dear friends!')
const words = [cue('1', 1100, 1400, 'Hello'), cue('2', 1600, 1900, 'dear'), cue('3', 2300, 2800, 'friends!')]

it('keeps visible text, whitespace, Unicode offsets and punctuation intact', () => {
  const text = 'Erinome:  “Hello”\nLet’s re-read $1.24, 17.5% and Second-hand!'
  const { speaker, body } = subtitleText(text)
  expect(speaker).toBe('Erinome')
  const tokens = wordTokens(body)
  expect(tokens.map((t) => t.key)).toEqual(['hello', "let's", 're-read', '1.24', '17.5', 'and', 'second-hand'])
  expect(tokens.map((t) => body.slice(t.startOffset, t.endOffset))).toEqual(['“Hello”', 'Let’s', 're-read', '$1.24,', '17.5%', 'and', 'Second-hand!'])
  expect(subtitleText('No speaker\nNext line').body).toBe('No speaker\nNext line')
  expect(wordTokens('😀 Hello')[0].startOffset).toBe(3)
})

it('maps complete sentences without mutating original timelines or Chinese pairing', () => {
  const original = Object.freeze({ ...sentence, chineseText: '你好，朋友！' })
  const result = alignWords([original], words).get('a')!
  expect(result.startMs).toBe(1100); expect(result.endMs).toBe(2800)
  expect(result.words[2]).toMatchObject({ startOffset: 11, endOffset: 19, startMs: 2300, endMs: 2800 })
  expect(original).toEqual({ ...sentence, chineseText: '你好，朋友！' })
})

it('accepts words before/after the old sentence boundary and distinguishes repeated words', () => {
  const s = cue('a', 1000, 2000, 'Go go now.')
  const w = [cue('1', 159, 400, 'Go'), cue('2', 1100, 1400, 'go'), cue('3', 2100, 2459, 'now.')]
  const result = alignWords([s], w).get('a')!
  expect(result.startMs).toBe(159); expect(result.endMs).toBe(2459)
  expect(result.words.map((word) => word.startMs)).toEqual([159, 1100, 2100])
})

it('accepts a sentence whose original end includes a longer trailing pause', () => {
  const withPause = { ...sentence, endMs: words.at(-1)!.endMs + 1903 }
  expect(alignWords([withPause], words).get('a')?.endMs).toBe(2800)
})

it.each(['missing', 'extra', 'overlap', 'invalid', 'multi', 'far'])('falls back locally for %s words and resynchronizes the next sentence', (problem) => {
  let w = words.map((word) => ({ ...word }))
  if (problem === 'missing') w.splice(1, 1)
  if (problem === 'extra') w.splice(1, 0, cue('x', 1450, 1500, 'extra'))
  if (problem === 'overlap') w[1].startMs = 1300
  if (problem === 'invalid') w[1].endMs = 1550
  if (problem === 'multi') w[1].text = 'two words'
  if (problem === 'far') w = w.map((c) => ({ ...c, startMs: c.startMs + 2000, endMs: c.endMs + 2000 }))
  const next = cue('b', 8000, 9000, 'Next sentence.')
  const result = alignWords([sentence, next], [...w, cue('n1', 8100, 8400, 'Next'), cue('n2', 8500, 8900, 'sentence.')])
  expect(result.has('a')).toBe(false)
  expect(result.get('b')?.words).toHaveLength(2)
})

it('rejects ambiguous repeated fragments and empty tracks without guessing', () => {
  const yes = cue('yes', 1000, 2000, 'Yes!')
  expect(alignWords([yes], [cue('1', 900, 1100, 'Yes'), cue('2', 1300, 1500, 'Yes!')]).size).toBe(0)
  expect(alignWords([sentence], []).size).toBe(0)
  expect(alignWords([], words).size).toBe(0)
})

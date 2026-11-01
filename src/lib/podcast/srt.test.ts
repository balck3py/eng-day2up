import { it, expect } from 'vitest'
import { parseSrt, pairCues, cueAt } from './srt'
const en = '\uFEFF1\r\n00:00:00,000 --> 00:00:01,872\r\nErinome: Hi!\r\nSecond line.\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nNext.'
it('parses BOM, CRLF, multiline and gaps', () => {
  const cues = parseSrt(en)
  expect(cues).toHaveLength(2)
  expect(cues[0].text).toBe('Erinome: Hi!\nSecond line.')
  expect(cueAt(cues, 1900)).toBeUndefined()
  expect(cueAt(cues, 2000)?.text).toBe('Next.')
})
it('pairs by both timestamps, not numbering, keeps first duplicate', () => {
  const zh = parseSrt('99\n00:00:02,000 --> 00:00:03,000\n下一句\n\n100\n00:00:02,000 --> 00:00:03,000\n重复')
  const paired = pairCues(parseSrt(en), zh)
  expect(paired[0].chineseText).toBeUndefined()
  expect(paired[1].chineseText).toBe('下一句')
  expect(pairCues(parseSrt(en), [{ ...zh[0], endMs: 3001 }])[1].chineseText).toBeUndefined()
})
it('sorts, skips invalid times and chooses latest overlapping start', () => {
  expect(parseSrt('')).toEqual([])
  expect(parseSrt('1\n00:70:00,000 --> 00:71:00,000\nx')).toEqual([])
  expect(parseSrt('1\n00:00:03,000 --> 00:00:02,000\nx')).toEqual([])
  const cues = parseSrt('2\n00:00:01,000 --> 00:00:03,000\nb\n\n1\n00:00:00,000 --> 00:00:02,000\na')
  expect(cueAt(cues, 1500)?.text).toBe('b')
})

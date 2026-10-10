import { describe, it, expect } from 'vitest'
import { sentenceAt, sentenceOf } from './sentence'
import { SENTENCE_VECTORS } from './sentence.vectors'

describe('切句向量', () => {
  for (const v of SENTENCE_VECTORS) {
    it(v.name, () => {
      let got: string | null
      if (v.select !== undefined) {
        const start = v.text.indexOf(v.select)
        expect(start).toBeGreaterThanOrEqual(0)
        got = sentenceAt(v.text, start, start + v.select.length)
      } else {
        got = sentenceOf(v.text, v.surface!)
      }

      if (v.expected === null || typeof v.expected === 'string') {
        expect(got).toBe(v.expected)
        return
      }
      const e = v.expected
      expect(got).not.toBeNull()
      expect(got!.length).toBeLessThanOrEqual(e.maxLength)
      expect(got).toContain(e.contains)
      expect(got!.startsWith('…')).toBe(e.leading)
      expect(got!.endsWith('…')).toBe(e.trailing)
    })
  }
})

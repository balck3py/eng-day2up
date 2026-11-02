import { afterEach, it, expect, vi } from 'vitest'
import { normalizeRate, savedRate, saveRate, RATE_KEY } from './rate'
afterEach(() => vi.unstubAllGlobals())
it('normalizes finite rates and 0.05 steps', () => {
  expect(normalizeRate(0.5)).toBe(0.5); expect(normalizeRate(1.2)).toBe(1.2)
  expect(normalizeRate(0.77)).toBe(0.75); expect(normalizeRate(10)).toBe(1.2)
  expect(normalizeRate(NaN)).toBe(1)
})
it('handles unavailable storage, invalid saved values, and persisted preferences', () => {
  expect(savedRate()).toBe(1); expect(() => saveRate(1)).not.toThrow()
  const storage = { getItem: vi.fn(), setItem: vi.fn() }; vi.stubGlobal('localStorage', storage)
  for (const raw of [null, '', ' ', 'bad', 'NaN', '0.1', '2']) { storage.getItem.mockReturnValue(raw); expect(savedRate()).toBe(1) }
  storage.getItem.mockReturnValue('0.8'); expect(savedRate()).toBe(0.8)
  saveRate(0.8); expect(storage.setItem).toHaveBeenCalledWith(RATE_KEY, '0.8')
})

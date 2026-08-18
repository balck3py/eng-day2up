import { prng } from './prng'

export type ReviewMode = 'sequential' | 'random'

/** 返回新数组，不修改入参。 */
export function orderCards<T>(items: T[], mode: ReviewMode, seed: number): T[] {
  const out = [...items]
  if (mode === 'sequential') return out

  const rand = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

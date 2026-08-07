export const MAX_FAMILIARITY = 5
export const MIN_FAMILIARITY = 0

/**
 * 认识 +1（封顶 5），不认识 -1（兜底 0）。
 * 达到 4 即视为已掌握，会被难词拆解排除（见 Plan 2 的打分规则）。
 */
export function nextFamiliarity(current: number, known: boolean): number {
  const base = Math.min(Math.max(current, MIN_FAMILIARITY), MAX_FAMILIARITY)
  const next = known ? base + 1 : base - 1
  return Math.min(Math.max(next, MIN_FAMILIARITY), MAX_FAMILIARITY)
}

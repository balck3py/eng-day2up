export const RATE_KEY = 'podcastPlaybackRate'
export function normalizeRate(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(1.2, Math.max(0.5, value)) * 10) / 10 : 1
}
export function savedRate(): number {
  try {
    const raw = localStorage.getItem(RATE_KEY)
    const value = raw === null || !raw.trim() ? NaN : Number(raw)
    return value >= 0.5 && value <= 1.2 ? normalizeRate(value) : 1
  } catch { return 1 }
}
export function saveRate(value: number) {
  try { localStorage.setItem(RATE_KEY, String(value)) } catch { /* Private browsing can disable storage. */ }
}

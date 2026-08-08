/** 解析 ALLOWED_EMAILS，返回小写、去空的集合。未配置返回 null（表示不限制）。 */
export function parseAllowlist(raw: string | undefined): Set<string> | null {
  if (!raw) return null
  const entries = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  if (entries.length === 0) return null
  return new Set(entries)
}

/** 判断邮箱是否允许。allowlist 为 null 时一律允许。 */
export function isEmailAllowed(
  email: string | undefined | null,
  allowlist: Set<string> | null,
): boolean {
  if (allowlist === null) return true
  if (!email) return false
  return allowlist.has(email.trim().toLowerCase())
}

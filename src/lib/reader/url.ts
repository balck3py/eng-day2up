const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/

/**
 * 用户粘贴的地址 → 实际去抓的地址。GitHub 的 blob 页是 HTML 外壳，
 * 换成 raw 才是 Markdown 原文。非 http(s) 一律拒绝（返回 null）。
 */
export function toFetchUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const blob = GITHUB_BLOB_RE.exec(url.href)
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`
  return url.href
}

/**
 * 文档里的链接/图片地址按文档自身地址补全。锚点保留，危险协议丢弃。
 */
export function resolveAgainst(href: string, base: string): string {
  if (href.startsWith('#')) return href
  try {
    const url = new URL(href, base)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return ''
    return url.href
  } catch {
    return ''
  }
}

/** 只给路径不给域名时默认去这里取（自己的文档站） */
export const DEFAULT_DOC_HOST = 'qiniu.aiquannei.com'

/** 文档文件扩展名 —— 首段长这样就是文件名而非域名（deep-dive-2.md 不是主机） */
const DOC_EXT_RE = /\.(md|markdown|mdx|txt)$/i

/** 没写协议时，首段是否像个主机名：带点的域名、localhost 或 IP，可带端口 */
function looksLikeHost(segment: string): boolean {
  const host = segment.replace(/:\d+$/, '')
  if (DOC_EXT_RE.test(host)) return false
  return host === 'localhost' || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)
}

const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/

/**
 * 用户粘贴的地址 → 实际去抓的地址。GitHub 的 blob 页是 HTML 外壳，
 * 换成 raw 才是 Markdown 原文。非 http(s) 一律拒绝（返回 null）。
 * 只给路径（podcast/a.md、/a.md）时补上默认文档站。
 */
export function toFetchUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const path = s.replace(/^\/+/, '')
    s = looksLikeHost(path.split('/')[0]) ? `https://${path}` : `https://${DEFAULT_DOC_HOST}/${path}`
  }
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

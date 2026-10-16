import { isIP } from 'node:net'

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

/**
 * 服务端代抓时防 SSRF：解析出的地址落在内网、回环、链路本地、保留段
 * 就拒绝。IPv4 映射的 IPv6（::ffff:a.b.c.d）按其 IPv4 判断。
 */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const n = ipv4ToInt(ip)
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return (n & mask) === (ipv4ToInt(base) & mask)
    })
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isBlockedIp(mapped[1])
    if (lower === '::' || lower === '::1') return true
    // fc00::/7 唯一本地、fe80::/10 链路本地、ff00::/8 组播
    return /^(f[cd]|fe[89ab]|ff)/.test(lower)
  }
  return true
}

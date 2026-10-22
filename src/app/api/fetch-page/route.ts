import { lookup } from 'node:dns/promises'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { toFetchUrl } from '@/lib/reader/url'
import { isBlockedIp } from '@/lib/reader/ssrf'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 10_000

class FetchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** 主机名解析出的任何一个地址落在内网都拒绝。 */
async function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new FetchError('域名解析失败')
  })
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new FetchError('不允许访问内网地址')
  }
}

/** 按字节上限读完响应体，超限即中止。 */
async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new FetchError('文档太大（上限 2MB）')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new FetchError('文档太大（上限 2MB）')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * 服务端代抓第三方 Markdown。浏览器直连会被跨域挡住，所以由这里抓回原文，
 * 渲染在本站页面里（这样划词才能读到选区）。
 *
 * 重定向手动跟随，每一跳都重新校验目标地址，防止被 302 引到内网。
 * 解析与连接之间仍有 DNS 重绑定的理论窗口，单人自用场景下接受。
 */
export async function POST(request: Request) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null
  const start = typeof body?.url === 'string' ? toFetchUrl(body.url) : null
  if (!start) return NextResponse.json({ error: '地址无效，只支持 http(s)' }, { status: 400 })

  try {
    let url = new URL(start)
    for (let hop = 0; ; hop++) {
      await assertPublicHost(url)
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5' },
      })

      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) throw new FetchError('重定向次数过多', 502)
        url = new URL(location, url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new FetchError('重定向到了不支持的协议', 502)
        }
        continue
      }
      if (!res.ok) throw new FetchError(`对方返回 ${res.status}`, 502)

      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) {
        throw new FetchError('这是一个网页，目前只支持 Markdown / 纯文本地址')
      }
      if (type && !/^text\/|markdown|octet-stream/.test(type)) {
        throw new FetchError(`不支持的内容类型：${type.split(';')[0]}`)
      }
      return NextResponse.json({ url: url.href, text: await readLimited(res) })
    }
  } catch (e) {
    if (e instanceof FetchError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    const timeout = e instanceof Error && e.name === 'TimeoutError'
    return NextResponse.json({ error: timeout ? '抓取超时' : '抓取失败' }, { status: 502 })
  }
}

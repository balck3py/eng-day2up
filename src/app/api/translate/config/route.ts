import { createServerSupabase } from '@/lib/supabase/server'
import { isEmailAllowed, parseAllowlist } from '@/lib/auth/allowlist'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'Cross-Origin-Resource-Policy': 'same-origin' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })

async function userFor(request: Request) {
  const origin = request.headers.get('origin')
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '不允许跨站访问翻译配置' }, 403)
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return json({ error: '未登录' }, 401)
  if (!isEmailAllowed(user.email, parseAllowlist(process.env.ALLOWED_EMAILS))) return json({ error: '该账号未获授权使用本站' }, 403)
  return user
}

export async function GET(request: Request) {
  const user = await userFor(request)
  if (user instanceof Response) return user
  const baseUrl = process.env.CLOUD_BASE_URL?.trim()
  const model = process.env.CLOUD_MODEL?.trim()
  const apiKey = process.env.CLOUD_API_KEY?.trim()
  if (!baseUrl || !model || !apiKey) return json({ error: '网站尚未配置可供设备调用的云端模型，请使用 Vercel 模式' }, 503)
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid endpoint')
  } catch { return json({ error: '设备直连需要有效的 HTTPS 模型地址，请使用 Vercel 模式' }, 503) }
  return json({ baseUrl, model, apiKey, disableThinking: process.env.CLOUD_KEEP_THINKING !== '1' })
}

import { createServerSupabase } from '@/lib/supabase/server'
import { isEmailAllowed, parseAllowlist } from '@/lib/auth/allowlist'
import { PodcastError } from './load'

export async function podcastResponse(load: () => Promise<unknown>): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' }
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return Response.json({ error: '未登录' }, { status: 401, headers })
  if (!isEmailAllowed(user.email, parseAllowlist(process.env.ALLOWED_EMAILS))) {
    return Response.json({ error: '该账号未获授权使用本站' }, { status: 403, headers })
  }
  try { return Response.json(await load(), { headers }) }
  catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '节目加载失败' }, {
      status: e instanceof PodcastError ? e.status : 502, headers,
    })
  }
}

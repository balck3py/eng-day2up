import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Settings } from './config'

let cached: { key: string; client: SupabaseClient } | null = null

/**
 * 以登录用户身份直连 Supabase。session 由 supabase-js 存在 WebView2 的 localStorage，
 * 弹窗销毁后数据目录仍在，下次无需重新登录。未配置时返回 null。
 */
export function getDb(s: Settings): SupabaseClient | null {
  const url = s.supabaseUrl.trim()
  const anon = s.supabaseAnonKey.trim()
  if (!url || !anon) return null
  const key = `${url}|${anon}`
  if (cached?.key !== key) {
    cached = {
      key,
      client: createClient(url, anon, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'eng-day2up-desktop-auth' },
      }),
    }
  }
  return cached.client
}

/** 当前登录用户；未登录返回 null。只读本地 session，不发网络请求。 */
export async function currentUser(db: SupabaseClient): Promise<{ id: string; email: string } | null> {
  const { data } = await db.auth.getSession()
  const u = data.session?.user
  return u ? { id: u.id, email: u.email ?? '' } : null
}

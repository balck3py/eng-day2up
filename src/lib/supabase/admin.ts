import { createClient } from '@supabase/supabase-js'

/**
 * service_role 客户端，绕过 RLS。
 * 只能在服务端调用 —— 泄露到浏览器等同于交出整个数据库。
 */
export function createAdminSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 未配置')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false },
  })
}

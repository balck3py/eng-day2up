import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** 带 cookie 会话的服务端客户端。受 RLS 约束。 */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {
            // Server Component 中无法写 cookie，由 middleware 负责刷新
          }
        },
      },
    },
  )
}

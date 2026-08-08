import { NextResponse, after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { lookupWord } from '@/lib/dict/lookup'
import { refreshPhonetics } from '@/lib/dict/dictapi'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  // Next 已经在路由匹配阶段对动态段做过一次 decodeURIComponent
  // （node_modules/next/dist/shared/lib/router/utils/route-matcher.js:17-27），
  // 这里的 word 已是解码后的值。若再解码一次，任何含字面 "%" 的输入
  // （如 "100%"）都会因不构成合法转义序列而抛出未捕获的 URIError，
  // 导致该路由对普通输入 500。此处只需 trim，不再二次解码。
  const { word } = await params
  const decoded = (word ?? '').trim()
  if (!decoded) {
    return NextResponse.json({ error: '缺少查询词' }, { status: 400 })
  }

  // 用 admin 客户端是因为需要写 dict_cache（RLS 只允许登录用户读）
  const db = createAdminSupabase()
  const { detail, refreshPhoneticsKey } = await lookupWord(db, decoded)

  // 音标未缓存时不阻塞响应：查询链路已同步读过 dict_cache 未命中，
  // 这里把抓取丢到响应送出之后执行，写入 dict_cache 供下次查询命中。
  // 用 after() 而不是裸 fire-and-forget，是因为 serverless 环境下
  // 不被等待的 Promise 可能在响应送出后就被回收，抓取任务会中途夭折。
  if (refreshPhoneticsKey) {
    after(() => refreshPhonetics(db, refreshPhoneticsKey))
  }

  return NextResponse.json(detail)
}

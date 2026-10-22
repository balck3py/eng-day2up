import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 一轮的生词数不会到这个量级，只是挡住异常请求 */
const MAX_IDS = 1000

/** 上一轮生词名单。RLS 保证只读得到自己的。 */
export async function GET() {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { data, error } = await db
    .from('review_leftover')
    .select('wordbook_id, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as { wordbook_id: string; created_at: string }[]
  return NextResponse.json({
    ids: rows.map((r) => r.wordbook_id),
    createdAt: rows[0]?.created_at ?? null,
  })
}

/**
 * 整批替换名单。只有常规复习结算时调 —— 「零生词不覆盖」由客户端判断，
 * 这里拒绝空名单作为兜底，数据库函数里还有一层。
 */
export async function PUT(request: Request) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const raw = Array.isArray(body?.ids) ? body.ids : []
  const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
  if (ids.length === 0 || ids.length !== raw.length || ids.length > MAX_IDS) {
    return NextResponse.json({ error: '生词名单无效' }, { status: 400 })
  }

  const { data, error } = await db.rpc('replace_review_leftover', { p_ids: ids })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ saved: data as number })
}

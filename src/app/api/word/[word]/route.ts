import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { lookupWord } from '@/lib/dict/lookup'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const { word } = await params
  const decoded = decodeURIComponent(word ?? '').trim()
  if (!decoded) {
    return NextResponse.json({ error: '缺少查询词' }, { status: 400 })
  }

  // 用 admin 客户端是因为需要写 dict_cache（RLS 只允许登录用户读）
  const db = createAdminSupabase()
  const detail = await lookupWord(db, decoded)
  return NextResponse.json(detail)
}

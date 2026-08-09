import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { nextFamiliarity } from '@/lib/review/mark'

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    known?: unknown
  } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const known = body?.known === true
  if (!id) return NextResponse.json({ error: '缺少记录 id' }, { status: 400 })

  // 先读当前值再算新值。RLS 保证读不到别人的记录。
  const { data: current, error: readErr } = await db
    .from('wordbook')
    .select('review_count, familiarity')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

  const familiarity = nextFamiliarity(current.familiarity as number, known)
  const reviewCount = (current.review_count as number) + 1

  const { error: writeErr } = await db
    .from('wordbook')
    .update({
      familiarity,
      review_count: reviewCount,
      last_reviewed_at: new Date().toISOString(),
      // SM-2 的 due_at / ease_factor / interval_days 第一版不动
    })
    .eq('id', id)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  return NextResponse.json({ familiarity, reviewCount })
}

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { nextFamiliarity, nextSpellOkCount } from '@/lib/review/mark'
import type { QuizType } from '@/lib/review/quiz'

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    known?: unknown
    quizType?: unknown
  } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const known = body?.known === true
  // 只有中译英才计拼写。题型缺失或不认识的值一律当英译中 —— 宁可少记一次，
  // 也别让一个说不清题型的请求把拼写欠账糊掉。
  const quizType: QuizType = body?.quizType === 'cn2en' ? 'cn2en' : 'en2cn'
  if (!id) return NextResponse.json({ error: '缺少记录 id' }, { status: 400 })

  // 先读当前值再算新值。RLS 保证读不到别人的记录。
  const { data: current, error: readErr } = await db
    .from('wordbook')
    .select('review_count, familiarity, spell_ok_count')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

  const prevFamiliarity = current.familiarity as number
  const familiarity = nextFamiliarity(prevFamiliarity, known)
  const reviewCount = (current.review_count as number) + 1
  const spellOkCount = nextSpellOkCount(
    (current.spell_ok_count as number) ?? 0,
    prevFamiliarity,
    known,
    quizType,
  )

  const { error: writeErr } = await db
    .from('wordbook')
    .update({
      familiarity,
      review_count: reviewCount,
      spell_ok_count: spellOkCount,
      last_reviewed_at: new Date().toISOString(),
      // SM-2 的 due_at / ease_factor / interval_days 第一版不动
    })
    .eq('id', id)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  return NextResponse.json({ familiarity, reviewCount, spellOkCount })
}

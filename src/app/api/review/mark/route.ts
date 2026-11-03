import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { resolveReviewedAt } from '@/lib/review/mark'
import type { QuizType } from '@/lib/review/quiz'

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    eventId?: unknown
    known?: unknown
    quizType?: unknown
    reviewedAt?: unknown
  } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const known = body?.known === true
  // 只有中译英才计拼写。题型缺失或不认识的值一律当英译中 —— 宁可少记一次，
  // 也别让一个说不清题型的请求把拼写欠账糊掉。
  const quizType: QuizType = body?.quizType === 'cn2en' ? 'cn2en' : 'en2cn'
  if (!id) return NextResponse.json({ error: '缺少记录 id' }, { status: 400 })

  // 老标签页没有 eventId 时，用原始作答时间构造稳定标识，兼容已有补写。
  const eventId = typeof body?.eventId === 'string'
    ? body.eventId
    : `legacy:${id}:${typeof body?.reviewedAt === 'string' ? body.reviewedAt : Date.now()}:${known}:${quizType}`
  if (!eventId || eventId.length > 200) {
    return NextResponse.json({ error: '复习事件无效' }, { status: 400 })
  }
  const { data, error } = await db.rpc('mark_review', {
    p_id: id, p_event_id: eventId, p_known: known, p_quiz_type: quizType,
    p_reviewed_at: resolveReviewedAt(body?.reviewedAt, Date.now()),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === 'P0002' ? 404 : 500 })
  return NextResponse.json(data)
}

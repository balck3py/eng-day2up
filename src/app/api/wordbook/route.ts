import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { normalizeWord } from '@/lib/text/normalize'
import { toEntry } from '@/lib/wordbook/types'

const COLS =
  'id, word, word_key, source_context, note, review_count, familiarity, last_reviewed_at, created_at'

export async function GET(request: Request) {
  // 用户会话客户端 + RLS 做隔离，不用 admin 绕过。
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''

  // RLS 已保证只能看到自己的记录，这里不需要再加 user_id 条件
  let query = db
    .from('wordbook')
    .select(COLS)
    .order('created_at', { ascending: false })
  if (q) query = query.ilike('word', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    entries: (data ?? []).map((r) => toEntry(r as Record<string, unknown>)),
  })
}

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    word?: unknown
    sourceContext?: unknown
  } | null
  const word = typeof body?.word === 'string' ? body.word.trim() : ''
  const wordKey = normalizeWord(word)
  if (!wordKey) return NextResponse.json({ error: '缺少单词' }, { status: 400 })

  const sourceContext =
    typeof body?.sourceContext === 'string' ? body.sourceContext.slice(0, 500) : null

  // 已收藏时返回既有记录而不是报错 —— 重复收藏对用户来说不是错误
  const { data: existing } = await db
    .from('wordbook')
    .select(COLS)
    .eq('word_key', wordKey)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ entry: toEntry(existing as Record<string, unknown>) })
  }

  const { data, error } = await db
    .from('wordbook')
    .insert({
      user_id: user.id,
      word,
      word_key: wordKey,
      source_context: sourceContext,
    })
    .select(COLS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: toEntry(data as Record<string, unknown>) })
}

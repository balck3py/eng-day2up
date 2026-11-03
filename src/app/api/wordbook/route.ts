import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { normalizeWord } from '@/lib/text/normalize'
import { toEntry, type WordbookEntry } from '@/lib/wordbook/types'
import { parseTranslation } from '@/lib/dict/senses'

const COLS =
  'id, word, word_key, source_context, note, review_count, familiarity, spell_ok_count, last_reviewed_at, created_at'

/**
 * 给单词本条目补上词库里的中文释义与音标，供单词本/复习页做中英对照。
 * dict_entries 对登录用户 RLS 只读，用同一个会话客户端即可，无需 admin。
 * 分批 IN 查询取回，避免逐词请求和过长的 URL 参数。
 */
async function enrich(
  db: Awaited<ReturnType<typeof createServerSupabase>>,
  entries: WordbookEntry[],
): Promise<WordbookEntry[]> {
  const keys = [...new Set(entries.map((e) => e.wordKey).filter(Boolean))]
  if (keys.length === 0) return entries
  const byKey = new Map<string, { translation: string | null; phonetic: string | null }>()
  // 限制 IN 参数长度；词本身也可能超过 PostgREST 单次行数上限。
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await db.from('dict_entries')
      .select('word_key, translation, phonetic').in('word_key', keys.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const row of data ?? []) if (!byKey.has(row.word_key)) byKey.set(row.word_key, row)
  }
  return entries.map((e) => {
    const row = byKey.get(e.wordKey)
    if (!row) return e
    return { ...e, senses: parseTranslation(row.translation), phonetic: row.phonetic }
  })
}

export async function GET(request: Request) {
  // 用户会话客户端 + RLS 做隔离，不用 admin 绕过。
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const q = params.get('q')?.trim() ?? ''
  // ?word=xxx：按 word_key 精确查该词是否已收藏（收藏按钮挂载时用）
  const exact = params.get('word')?.trim() ?? ''

  // 按稳定顺序分页，避免单词本/复习只拿到最近 1000 个词。
  const entries: WordbookEntry[] = []
  for (let from = 0; ; from += 500) {
    let query = db.from('wordbook').select(COLS)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + 499)
    if (exact) query = query.eq('word_key', normalizeWord(exact))
    else if (q) query = query.ilike('word', `%${q}%`)
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    entries.push(...(data ?? []).map((r) => toEntry(r as Record<string, unknown>)))
    if (!data || data.length < 500) break
  }
  try {
    return NextResponse.json({ entries: await enrich(db, entries) })
  } catch {
    return NextResponse.json({ error: '词条释义加载失败' }, { status: 500 })
  }
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

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { buildWordbookEpub, localDay, type EpubWord } from '@/lib/wordbook/epub'

/**
 * 把当前用户的单词本按加入时间正序导出成 EPUB（给水墨屏看）。
 * 会话客户端 + RLS：wordbook 只能读到自己的，dict_entries / dict_cache 登录可读。
 */
export async function GET() {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  // PostgREST 单次最多 1000 行，分页取完
  const rows: { word: string; word_key: string; created_at: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('wordbook')
      .select('word, word_key, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  const keys = [...new Set(rows.map((r) => r.word_key))]
  const dict = new Map<string, { translation: string | null; phonetic: string | null }>()
  const cache = new Map<string, { phonetic_us: string | null; phonetic_uk: string | null }>()
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200)
    const [d, c] = await Promise.all([
      db.from('dict_entries').select('word_key, translation, phonetic').in('word_key', chunk),
      db.from('dict_cache').select('word_key, phonetic_us, phonetic_uk').in('word_key', chunk),
    ])
    for (const r of d.data ?? []) if (!dict.has(r.word_key)) dict.set(r.word_key, r)
    for (const r of c.data ?? []) cache.set(r.word_key, r)
  }

  const words: EpubWord[] = rows.map((r) => {
    const d = dict.get(r.word_key)
    const c = cache.get(r.word_key)
    return {
      word: r.word,
      // 美音优先（和单词本页一致的来源顺序），没有再用 ECDICT、英音
      phonetic: c?.phonetic_us || d?.phonetic || c?.phonetic_uk || null,
      translation: d?.translation ?? null,
      createdAt: r.created_at,
    }
  })

  const now = new Date()
  const book = buildWordbookEpub(words, now, crypto.randomUUID())
  const name = `生词本-${localDay(now.getTime())}.epub`
  return new Response(book as BodyInit, {
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `attachment; filename="wordbook.epub"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}

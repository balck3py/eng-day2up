import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { normalizeWord } from '@/lib/text/normalize'
import { parseTranslation, hasChineseMeaning } from '@/lib/dict/senses'
import { fillWord, saveSenses } from '@/lib/dict/backfill'
import { consumeQuota } from '@/lib/quota'

export const maxDuration = 60

/** 一次请求处理几个词。每个词最多两轮 LLM，攒太多会撞 maxDuration。 */
const BATCH = 4

interface Row {
  word: string
  word_key: string
  source_context: string | null
}

/**
 * 单词本里「没有中文释义」的词批量补全。
 *
 * 一次只补 BATCH 个就返回，由前端拿着 remaining 反复调 —— 词典/AI/联网三级
 * 链路每个词都可能要几秒，一口气补完必然超时。补不动的词前端放进 skip，
 * 下一轮不再重试，避免死循环。
 */
export async function POST(request: Request) {
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { skip?: unknown } | null
  const skip = new Set(
    (Array.isArray(body?.skip) ? body.skip : [])
      .filter((w): w is string => typeof w === 'string')
      .map((w) => normalizeWord(w)),
  )

  // RLS 保证只看得到自己的词
  const { data, error } = await db
    .from('wordbook')
    .select('word, word_key, source_context')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as Row[]

  // 哪些词已经有中文释义了：一次 IN 查询取回词库现状
  const keys = [...new Set(rows.map((r) => r.word_key).filter(Boolean))]
  const dictRows = keys.length
    ? (await db.from('dict_entries').select('word_key, translation').in('word_key', keys)).data
    : []
  const filled = new Set(
    ((dictRows ?? []) as { word_key: string; translation: string | null }[])
      .filter((r) => hasChineseMeaning(parseTranslation(r.translation)))
      .map((r) => r.word_key),
  )

  // 同一个词可能被收藏多次（大小写不同），按 word_key 去重
  const seen = new Set<string>()
  const pending = rows.filter((r) => {
    if (!r.word_key || filled.has(r.word_key) || skip.has(r.word_key) || seen.has(r.word_key)) {
      return false
    }
    seen.add(r.word_key)
    return true
  })

  const batch = pending.slice(0, BATCH)
  if (batch.length === 0) {
    return NextResponse.json({ filled: [], failed: [], remaining: 0 })
  }

  const admin = createAdminSupabase()
  if (!(await consumeQuota(admin, user.id))) {
    return NextResponse.json(
      { filled: [], failed: [], remaining: pending.length, quotaExhausted: true },
      { status: 200 },
    )
  }

  const done: { word: string; source: string }[] = []
  const failed: string[] = []

  await Promise.all(
    batch.map(async (r) => {
      try {
        const result = await fillWord(admin, r.word, r.source_context)
        if (!result) {
          failed.push(r.word)
          return
        }
        await saveSenses(admin, r.word_key, result.senses, result.phonetic)
        done.push({ word: r.word, source: result.source })
      } catch (e) {
        console.error(`补全失败 ${r.word}:`, (e as Error).message)
        failed.push(r.word)
      }
    }),
  )

  return NextResponse.json({
    filled: done,
    failed,
    remaining: pending.length - done.length,
  })
}

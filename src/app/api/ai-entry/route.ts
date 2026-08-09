import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { normalizeWord } from '@/lib/text/normalize'
import { isAiFallbackEligible, saveAiEntry } from '@/lib/dict/ai-entry'
import type { Sense } from '@/lib/dict/types'

const MAX_SENSES = 10
const MAX_MEANING = 200

/**
 * 回写「浏览器本地模型生成的释义」到词库（收录）。
 * 服务端 AI 兜底走 /api/word 内部；这个端点专供本地模型路径（?ai=skip）用。
 *
 * 路径不放在 /api/word/ 下：静态段会遮蔽同级动态路由 /api/word/[word]
 * （见 /api/explain 的同类教训）。
 */
export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    word?: unknown
    senses?: unknown
  } | null

  const key = normalizeWord(typeof body?.word === 'string' ? body.word : '')
  if (!isAiFallbackEligible(key)) {
    return NextResponse.json({ error: '词形不合法' }, { status: 400 })
  }

  // 严格校验 senses 结构，别让客户端往共享词库塞垃圾
  if (!Array.isArray(body?.senses) || body.senses.length === 0) {
    return NextResponse.json({ error: '缺少释义' }, { status: 400 })
  }
  const senses: Sense[] = []
  for (const item of body.senses.slice(0, MAX_SENSES)) {
    if (typeof item !== 'object' || item === null) continue
    const meaning = (item as { meaning?: unknown }).meaning
    const pos = (item as { pos?: unknown }).pos
    if (typeof meaning !== 'string' || !meaning.trim()) continue
    senses.push({
      pos: typeof pos === 'string' ? pos.trim() : '',
      meaning: meaning.trim().slice(0, MAX_MEANING),
    })
  }
  if (senses.length === 0) {
    return NextResponse.json({ error: '释义为空' }, { status: 400 })
  }

  const db = createAdminSupabase()
  // 已存在就不重复写（客户端是在服务端返回 none 后才来写，正常不会撞）
  const { data: existing } = await db
    .from('dict_entries').select('id').eq('word_key', key).maybeSingle()
  if (existing) return NextResponse.json({ ok: true, already: true })

  await saveAiEntry(db, key, senses)
  return NextResponse.json({ ok: true })
}

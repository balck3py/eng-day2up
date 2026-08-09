import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { extractHardWords } from '@/lib/hardwords/extract'

const MAX_TEXT_LENGTH = 20_000

/**
 * 难词提取。**不消耗配额** —— 它不调用任何 LLM，纯数据库查询。
 */
export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!text.trim()) {
    return NextResponse.json({ error: '缺少文本' }, { status: 400 })
  }

  const db = createAdminSupabase()
  const words = await extractHardWords(db, text.slice(0, MAX_TEXT_LENGTH), user.id)
  return NextResponse.json({ words })
}

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { consumeQuota } from '@/lib/quota'
import { buildExplainPrompt } from '@/lib/translate/prompt'
import { getScheduler } from '@/lib/translate/instance'

export const maxDuration = 60

const MAX_CONTEXT_LENGTH = 2000

/**
 * 返回完整 JSON 而非流式 —— 回答只有一句话，流式没有意义，前端也更简单。
 *
 * 路径偏离计划的 `/api/word/explain`：静态段 `explain` 会遮蔽同级的动态路由
 * `/api/word/[word]`，于是「explain」这个词本身就查不了了（命中静态路由，
 * 而它只有 POST，GET 返回 405）。挪出 word 命名空间即可避开。
 */
export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { word?: unknown; context?: unknown }
    | null
  const word = typeof body?.word === 'string' ? body.word.trim() : ''
  const context =
    typeof body?.context === 'string' ? body.context.slice(0, MAX_CONTEXT_LENGTH) : ''
  if (!word || !context.trim()) {
    return NextResponse.json({ error: '缺少单词或上下文' }, { status: 400 })
  }

  const db = createAdminSupabase()
  if (!(await consumeQuota(db, user.id))) {
    return NextResponse.json(
      { error: '已达今日配额上限，明日 0 点重置。' },
      { status: 429 },
    )
  }

  try {
    const result = await getScheduler().run(buildExplainPrompt(word, context))
    let explanation = ''
    for await (const delta of result.chunks) explanation += delta
    return NextResponse.json({
      explanation: explanation.trim(),
      provider: result.provider,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `释义服务不可用：${(e as Error).message}` },
      { status: 503 },
    )
  }
}

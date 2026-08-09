import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { consumeQuota } from '@/lib/quota'
import { buildTranslatePrompt } from '@/lib/translate/prompt'
import { getScheduler } from '@/lib/translate/instance'
import type { Direction } from '@/lib/translate/types'

// 长段落的流式输出可能跑满一分钟；不设的话会被平台默认时限截断。
export const maxDuration = 60

const MAX_TEXT_LENGTH = 20_000

export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; direction?: unknown }
    | null
  const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_TEXT_LENGTH) : ''
  const direction: Direction = body?.direction === 'zh2en' ? 'zh2en' : 'en2zh'
  if (!text.trim()) {
    return NextResponse.json({ error: '缺少文本' }, { status: 400 })
  }

  const db = createAdminSupabase()
  if (!(await consumeQuota(db, user.id))) {
    return NextResponse.json(
      { error: '已达今日翻译配额上限，明日 0 点重置。' },
      { status: 429 },
    )
  }

  let result
  try {
    result = await getScheduler().run(buildTranslatePrompt(text, direction))
  } catch (e) {
    return NextResponse.json(
      { error: `翻译服务不可用：${(e as Error).message}` },
      { status: 503 },
    )
  }

  const encoder = new TextEncoder()
  const send = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of result.chunks) {
          controller.enqueue(send({ type: 'delta', value: delta }))
        }
        controller.enqueue(send({ type: 'done' }))
      } catch (e) {
        // 首字节之后的中断：把已产出的内容留给前端，并明确告知中断
        controller.enqueue(send({ type: 'error', value: (e as Error).message }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Provider': result.provider,
      // 禁止中间层缓冲，否则流式效果失效
      'X-Accel-Buffering': 'no',
    },
  })
}

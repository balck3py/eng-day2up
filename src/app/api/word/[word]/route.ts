import { NextResponse, after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { lookupWord } from '@/lib/dict/lookup'
import { refreshPhonetics } from '@/lib/dict/dictapi'
import { normalizeWord } from '@/lib/text/normalize'
import { consumeQuota } from '@/lib/quota'
import { isAiFallbackEligible, generateEntry, saveAiEntry } from '@/lib/dict/ai-entry'

export const maxDuration = 60

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  // Next 已经在路由匹配阶段对动态段做过一次 decodeURIComponent
  // （node_modules/next/dist/shared/lib/router/utils/route-matcher.js:17-27），
  // 这里的 word 已是解码后的值。若再解码一次，任何含字面 "%" 的输入
  // （如 "100%"）都会因不构成合法转义序列而抛出未捕获的 URIError，
  // 导致该路由对普通输入 500。此处只需 trim，不再二次解码。
  const { word } = await params
  const decoded = (word ?? '').trim()
  if (!decoded) {
    return NextResponse.json({ error: '缺少查询词' }, { status: 400 })
  }

  // 用 admin 客户端是因为需要写 dict_cache / dict_entries（RLS 只允许登录用户读）
  const db = createAdminSupabase()
  const { detail, refreshPhoneticsKey } = await lookupWord(db, decoded)

  // 第五级：词库未命中 → 交给 LLM 生成释义并写回，让这个词从此进词库。
  // 音标不走 AI（继续走既有链路），闸门挡住乱码/超长，配额防刷。
  if (detail.matchedFrom === 'none') {
    const key = normalizeWord(decoded)
    if (isAiFallbackEligible(key) && (await consumeQuota(db, user.id))) {
      const senses = await generateEntry(key)
      if (senses && senses.length > 0) {
        // 写回失败不影响本次返回（saveAiEntry 内部只记日志）
        after(() => saveAiEntry(db, key, senses))
        detail.matchedFrom = 'ai'
        detail.word = key
        detail.senses = senses
      }
    }
  }

  // 音标未缓存时不阻塞响应：查询链路已同步读过 dict_cache 未命中，
  // 这里把抓取丢到响应送出之后执行，写入 dict_cache 供下次查询命中。
  // 用 after() 而不是裸 fire-and-forget，是因为 serverless 环境下
  // 不被等待的 Promise 可能在响应送出后就被回收，抓取任务会中途夭折。
  if (refreshPhoneticsKey) {
    after(() => refreshPhonetics(db, refreshPhoneticsKey))
  }

  return NextResponse.json(detail)
}

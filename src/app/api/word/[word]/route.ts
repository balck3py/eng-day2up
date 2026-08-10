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
  request: Request,
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
  const lookup = await lookupWord(db, decoded)
  let detail = lookup.detail
  let phoneticsRefreshKey = lookup.refreshPhoneticsKey

  // 第五级：词库未命中 → 交给 LLM 生成词条（含拼写纠正、音标、释义）并写回，
  // 让这个词从此进词库。闸门挡住乱码/超长，配额防刷。
  // ?ai=skip：客户端配了本地模型时用它，服务端不再花云端 token 兜底，
  // 改由浏览器直连本地模型生成、再经 /api/ai-entry 回写。
  const skipAi = new URL(request.url).searchParams.get('ai') === 'skip'
  if (detail.matchedFrom === 'none' && !skipAi) {
    const key = normalizeWord(decoded)
    if (isAiFallbackEligible(key) && (await consumeQuota(db, user.id))) {
      const ai = await generateEntry(key)
      if (ai) {
        const corrected = ai.word
        // 纠正后的词可能本就在词库里（如 recieve→receive）：回查一次，
        // 命中就用真实词条（音标/标签/柯林斯更全），不再写 AI 释义。
        const retry = corrected !== key ? await lookupWord(db, corrected) : null
        if (retry && retry.detail.matchedFrom !== 'none') {
          detail = retry.detail
          detail.query = decoded
          detail.correctedFrom = decoded
          phoneticsRefreshKey = retry.refreshPhoneticsKey
        } else {
          // 词库确实没有：用 AI 释义并写回（写回失败只记日志，不影响本次返回）
          after(() => saveAiEntry(db, corrected, ai.senses, ai.phonetic))
          detail.matchedFrom = 'ai'
          detail.word = corrected
          detail.correctedFrom = corrected !== key ? decoded : null
          detail.senses = ai.senses
          detail.phonetic = ai.phonetic
          // 让在线音标链路以纠正后的词为准去补抓、缓存，下次查询即可升级
          phoneticsRefreshKey = corrected
        }
      }
    }
  }

  // 音标未缓存时不阻塞响应：查询链路已同步读过 dict_cache 未命中，
  // 这里把抓取丢到响应送出之后执行，写入 dict_cache 供下次查询命中。
  // 用 after() 而不是裸 fire-and-forget，是因为 serverless 环境下
  // 不被等待的 Promise 可能在响应送出后就被回收，抓取任务会中途夭折。
  if (phoneticsRefreshKey) {
    after(() => refreshPhonetics(db, phoneticsRefreshKey!))
  }

  return NextResponse.json(detail)
}

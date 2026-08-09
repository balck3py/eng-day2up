import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sense } from './types'
import { buildWordFallbackPrompt } from '@/lib/translate/prompt'
import { getScheduler } from '@/lib/translate/instance'
import { parseAiSenses } from './ai-parse'

// 闸门与解析是纯函数，拆到 ai-parse.ts 供客户端（本地模型路径）复用。
export { isAiFallbackEligible, parseAiSenses } from './ai-parse'

/**
 * 让 LLM 为一个词库未收录的词生成释义。失败返回 null，绝不抛异常。
 * 用非流式方式（把 chunks 收集成完整文本再解析）—— 释义是一段 JSON，
 * 边流边解析没有意义。
 */
export async function generateEntry(word: string): Promise<Sense[] | null> {
  try {
    const result = await getScheduler().run(buildWordFallbackPrompt(word))
    let text = ''
    for await (const delta of result.chunks) text += delta
    return parseAiSenses(text)
  } catch (e) {
    console.error('AI 兜底生成失败:', (e as Error).message)
    return null
  }
}

/** 把 senses 序列化回 dict_entries.translation 的格式（parseTranslation 可逆解析）。 */
function serializeSenses(senses: Sense[]): string {
  return senses.map((s) => (s.pos ? `${s.pos} ${s.meaning}` : s.meaning)).join('\n')
}

/**
 * 把 AI 生成的释义写回 dict_entries，让这个词从此变成词库的一部分
 * （下次查同一个词会在第一级精确命中，不再调 LLM）。失败只记日志，不抛异常。
 * phonetic 必须留空 —— AI 不碰音标。
 */
export async function saveAiEntry(
  db: SupabaseClient,
  word: string,
  senses: Sense[],
): Promise<void> {
  if (senses.length === 0) return // 空释义不写库，避免落垃圾负缓存
  const { error } = await db.from('dict_entries').insert({
    word,
    translation: serializeSenses(senses),
    phonetic: null,
  })
  if (error) console.error('AI 词条写回失败:', error.message)
}

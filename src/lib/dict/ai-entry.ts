import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiEntry, Sense } from './types'
import { buildWordFallbackPrompt } from '@/lib/translate/prompt'
import type { ChatMessage } from '@/lib/translate/types'
import { getScheduler } from '@/lib/translate/instance'
import { parseAiEntry } from './ai-parse'

// 闸门与解析是纯函数，拆到 ai-parse.ts 供客户端（本地模型路径）复用。
export { isAiFallbackEligible, parseAiSenses, parseAiEntry } from './ai-parse'

/**
 * 让 LLM 为一个词库未收录的词生成词条（含拼写纠正、音标、释义）。
 * 失败或判定为乱码返回 null，绝不抛异常。用非流式（收集完整文本再解析）——
 * 词条是一段 JSON，边流边解析没有意义。
 */
export async function generateEntry(word: string): Promise<AiEntry | null> {
  return generateEntryFrom(buildWordFallbackPrompt(word), word)
}

/**
 * 同上，但由调用方给 prompt —— 单词本补全要在词本身之外再喂原句、
 * 联网查到的英文释义（见 buildWordBackfillPrompt），解析与容错完全一样。
 */
export async function generateEntryFrom(
  messages: ChatMessage[],
  fallbackKey: string,
): Promise<AiEntry | null> {
  try {
    const result = await getScheduler().run(messages)
    let text = ''
    for await (const delta of result.chunks) text += delta
    const entry = parseAiEntry(text, fallbackKey)
    if (!entry || entry.senses.length === 0) return null
    return entry
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
 * 把 AI 生成的词条写回 dict_entries，让这个词从此变成词库的一部分
 * （下次查同一个词会在第一级精确命中，不再调 LLM）。失败只记日志，不抛异常。
 * phonetic 为 AI 给出的美式音标（可能为 null）；在线音标链路后续仍会覆盖它。
 */
export async function saveAiEntry(
  db: SupabaseClient,
  word: string,
  senses: Sense[],
  phonetic: string | null = null,
): Promise<void> {
  if (senses.length === 0) return // 空释义不写库，避免落垃圾负缓存
  const { error } = await db.from('dict_entries').insert({
    word,
    translation: serializeSenses(senses),
    phonetic,
  })
  if (error) console.error('AI 词条写回失败:', error.message)
}

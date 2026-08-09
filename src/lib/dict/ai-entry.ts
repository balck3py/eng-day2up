import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sense } from './types'
import { buildWordFallbackPrompt } from '@/lib/translate/prompt'
import { getScheduler } from '@/lib/translate/instance'

// 闸门：只有像样的英文单词才值得花 LLM 的钱去兜底。
const MAX_WORD_LENGTH = 32
const WORD_SHAPE_RE = /^[a-z][a-z'-]*$/

/**
 * 判断一个 normalizeWord 后的 key 是否够格走 AI 兜底。
 * 挡住超长输入、纯数字、乱码 —— 正常英文单词不会触犯这些。
 */
export function isAiFallbackEligible(key: string): boolean {
  return key.length > 0 && key.length <= MAX_WORD_LENGTH && WORD_SHAPE_RE.test(key)
}

/**
 * 防御性解析 LLM 返回的释义 JSON。模型可能返回 markdown 围栏、多余前后文、
 * 或结构不符的对象；任何一步失败都返回 null，让调用方降级为「未收录」。
 */
export function parseAiSenses(raw: string): Sense[] | null {
  if (!raw) return null

  // 剥离 ```json ... ``` 或 ``` ... ``` 围栏
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fence) text = fence[1].trim()

  // 容错：取第一个 { 到最后一个 } 之间，挡住围栏外的解释性文字
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  text = text.slice(start, end + 1)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  // 逐字段运行时校验（第三方 JSON，spec 允许，但必须校验）
  if (typeof parsed !== 'object' || parsed === null) return null
  const senses = (parsed as { senses?: unknown }).senses
  if (!Array.isArray(senses)) return null

  const out: Sense[] = []
  for (const item of senses) {
    if (typeof item !== 'object' || item === null) return null
    const pos = (item as { pos?: unknown }).pos
    const meaning = (item as { meaning?: unknown }).meaning
    if (typeof meaning !== 'string') return null
    const trimmed = meaning.trim()
    if (!trimmed) continue // 跳过空释义，但结构本身合法
    out.push({ pos: typeof pos === 'string' ? pos.trim() : '', meaning: trimmed })
  }
  return out
}

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

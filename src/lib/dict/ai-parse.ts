import type { AiEntry, Sense } from './types'
import { normalizeWord } from '@/lib/text/normalize'

// 闸门：只有像样的英文单词才值得花模型的钱去兜底。
const MAX_WORD_LENGTH = 32
const WORD_SHAPE_RE = /^[a-z][a-z'-]*$/

/**
 * 判断一个 normalizeWord 后的 key 是否够格走 AI 兜底。
 * 挡住超长输入、纯数字、乱码 —— 正常英文单词不会触犯这些。
 *
 * 纯函数，无服务端依赖：服务端路由与浏览器本地模型路径共用同一套闸门。
 */
export function isAiFallbackEligible(key: string): boolean {
  return key.length > 0 && key.length <= MAX_WORD_LENGTH && WORD_SHAPE_RE.test(key)
}

/**
 * 防御性解析模型返回的释义 JSON。模型可能返回 markdown 围栏、多余前后文、
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
 * 解析升级版兜底 JSON：{word, phonetic, senses}。在 parseAiSenses 之上再提取
 * 纠正后的词形与音标。解析失败或结构不符返回 null（降级为「未收录」）。
 *
 * - word：模型给的纠正/规范词形，经 normalize + 闸门校验；不合法时回落到 fallbackKey。
 * - phonetic：非空字符串才保留，否则 null。
 * - senses：复用 parseAiSenses 的防御性解析；为空表示模型判定无法给出释义。
 */
export function parseAiEntry(raw: string, fallbackKey: string): AiEntry | null {
  const senses = parseAiSenses(raw)
  if (senses === null) return null

  // 取出 word / phonetic 字段（parseAiSenses 已验证过是可解析对象，这里再解一次
  // 拿完整对象；解析失败不致命，退回只用 senses）
  let obj: Record<string, unknown> = {}
  try {
    let text = raw.trim()
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
    if (fence) text = fence[1].trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>
    }
  } catch {
    // 忽略：word/phonetic 缺失时用回落值
  }

  const rawWord = typeof obj.word === 'string' ? obj.word : ''
  const normalized = normalizeWord(rawWord)
  const word = isAiFallbackEligible(normalized) ? normalized : fallbackKey

  const rawPhon = typeof obj.phonetic === 'string' ? obj.phonetic.trim() : ''
  const phonetic = rawPhon || null

  return { word, phonetic, senses }
}

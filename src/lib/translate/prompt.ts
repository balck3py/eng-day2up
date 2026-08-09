import type { ChatMessage, Direction } from './types'

const TRANSLATE_SYSTEM: Record<Direction, string> = {
  en2zh:
    '你是一个专业翻译。把用户提供的英文翻译成流畅自然的中文。' +
    '只输出译文本身，不要加任何解释、前言、引号或格式标记。保留原文的段落换行。',
  zh2en:
    'You are a professional translator. Translate the user\'s Chinese into fluent, natural English. ' +
    'Output only the translation itself — no explanation, preamble, quotes, or formatting markers. ' +
    'Preserve the original paragraph breaks.',
}

/** 构建整段翻译的 prompt。 */
export function buildTranslatePrompt(text: string, direction: Direction): ChatMessage[] {
  return [
    { role: 'system', content: TRANSLATE_SYSTEM[direction] },
    { role: 'user', content: text },
  ]
}

/**
 * 构建「为词库未收录的词生成释义」的 prompt（第五级 AI 兜底）。
 * 硬性约束：绝不让 LLM 生成音标（IPA 幻觉率高，错音标背下来难纠正）。
 * 输出严格 JSON，非有效英文词时返回空 senses，避免模型硬编。
 */
export function buildWordFallbackPrompt(word: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个英语词典助手。用户会给你一个英文单词，你为它生成简体中文释义。' +
        '只输出 JSON，格式为 {"senses":[{"pos":"词性缩写","meaning":"中文释义"}]}。' +
        'pos 用标准英文词性缩写（n. v. vt. vi. adj. adv. prep. conj. 等），' +
        '无法判断时用空字符串。meaning 用简体中文。' +
        '不要输出音标、例句、词源或任何解释性文字，不要用 markdown 代码块包裹。' +
        '如果这个词不是一个有效的英文单词（拼写错误、乱码、生造词），' +
        '必须返回 {"senses":[]}，不要硬编造释义。',
    },
    { role: 'user', content: word },
  ]
}

/**
 * 构建「这个词在这句话里是什么意思」的 prompt。
 * 明确禁止输出音标 —— 音标只能来自词典层。
 */
export function buildExplainPrompt(word: string, context: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个英语词汇助教。用户会给你一个单词和它所在的句子。' +
        '用一句话（不超过 40 字）说明这个单词在该句中的具体含义。' +
        '简短直接，不要罗列该词的其他义项，不要输出音标，不要重复原句。',
    },
    { role: 'user', content: `单词：${word}\n句子：${context}` },
  ]
}

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

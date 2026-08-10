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
 * 构建「为词库未收录的词生成词条」的 prompt（第五级 AI 兜底）。
 * 要求模型同时：纠正明显拼写错误、给出美式音标、生成分词性中文释义。
 * 覆盖组合词（work-flow）、专有名词、词库漏收的正常词。
 * 只有在完全无法判断/纠正（乱码、随机字母）时才返回空 senses。
 */
export function buildWordFallbackPrompt(word: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个英语词典助手。用户给你一个英文单词（可能拼写有误、是组合词或专有名词）。' +
        '只输出 JSON，格式：' +
        '{"word":"规范/纠正后的英文词","phonetic":"美式音标","senses":[{"pos":"词性缩写","meaning":"中文释义"}]}。' +
        '规则：' +
        '1) 若输入有明显拼写错误（如 immunotherpy、recieve），把 word 设为纠正后的正确拼写并给它的释义；否则 word 原样返回。' +
        '2) phonetic 为该词的美式音标，用国际音标并带斜杠，如 "/ˌɪmjənoʊˈθerəpi/"；实在给不出就用空字符串。' +
        '3) pos 用标准英文词性缩写（n. v. vt. vi. adj. adv. prep. conj. 等），判断不了用空字符串；meaning 用简体中文。' +
        '4) 组合词（如 work-flow）、专有名词也要给出释义。' +
        '5) 仅当输入是无意义乱码、随机字母、无法纠正也无法解释时，才返回 {"word":"","phonetic":"","senses":[]}。' +
        '不要输出例句、词源或任何解释性文字，不要用 markdown 代码块包裹。',
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

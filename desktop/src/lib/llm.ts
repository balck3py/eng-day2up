/**
 * OpenAI 兼容端点的流式调用。逐行解析思路复制自网页 src/lib/translate/stream.ts（不引用）。
 * 请求由调用方传入的 fetch 发出：Tauri 里是 tauri-plugin-http 的 fetch（Rust 代发，绕开 CORS / 混合内容）。
 */

export interface LlmConfig {
  /** 如 http://localhost:11434/v1 */
  baseUrl: string
  model: string
  apiKey?: string
  /** 自定义翻译 system prompt，留空用内置 */
  prompt?: string
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** 解析一行 SSE，只取 delta.content；推理模型的 reasoning_content 被忽略。 */
export function parseSseLine(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const obj = JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] }
    const c = obj.choices?.[0]?.delta?.content
    return typeof c === 'string' && c.length > 0 ? c : null
  } catch {
    return null
  }
}

/** 字节流按行切分，跨块行边界与多字节字符都正确处理；消费者提前退出时取消底层请求。 */
export async function* toLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let drained = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line) yield line
      }
    }
    // 冲刷解码器，否则断在多字节字符中途的尾字节会被丢掉
    buffer += decoder.decode()
    drained = true
    const tail = buffer.replace(/\r$/, '')
    if (tail) yield tail
  } finally {
    if (drained) reader.releaseLock()
    else void reader.cancel().catch(() => {})
  }
}

/** 拼出 /chat/completions。只填了主机（如 http://127.0.0.1:1234）时补上 /v1，ollama / LM Studio 都只认带 /v1 的路径。 */
export function completionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const hasPath = /^[a-z]+:\/\/[^/]+\/./i.test(base)
  return `${base}${hasPath ? '' : '/v1'}/chat/completions`
}

/** 流式对话，逐块产出文本增量。端点非 2xx 时抛错。 */
export async function* streamChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
  const res = await fetchImpl(completionsUrl(cfg.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`翻译端点返回 ${res.status}`)
  for await (const line of toLines(res.body)) {
    const delta = parseSseLine(line)
    if (delta) yield delta
  }
}

const EN2ZH =
  '你是一个专业翻译。把用户提供的英文翻译成流畅自然的中文。' +
  '只输出译文本身，不要加任何解释、前言、引号或格式标记。保留原文的段落换行。'
const ZH2EN =
  "You are a professional translator. Translate the user's Chinese into fluent, natural English. " +
  'Output only the translation itself — no explanation, preamble, quotes, or formatting markers. ' +
  'Preserve the original paragraph breaks.'

/** 翻译 prompt：含中文按中译英，否则英译中；配置了自定义 prompt 时覆盖 system。 */
export function translateMessages(text: string, custom?: string): ChatMessage[] {
  const system = custom?.trim() || (/[一-鿿]/.test(text) ? ZH2EN : EN2ZH)
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]
}

/**
 * 词典未收录时的 AI 释义 prompt。输出格式与 ECDICT translation 一致（每行「词性. 释义」），
 * 直接复用 parseTranslation 解析。禁止音标：音标只能来自词典。
 */
export function defineMessages(word: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个英语词典助手。用户给你一个英文单词，给出它的简体中文释义。' +
        '每行一个义项，格式为「词性缩写 中文释义」，如「n. 缓存」「vt. 缓存；储存」，最多 5 行。' +
        '不要输出音标、例句、词源或任何解释性文字，不要用 markdown。',
    },
    { role: 'user', content: word },
  ]
}

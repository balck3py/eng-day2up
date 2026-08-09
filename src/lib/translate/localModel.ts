import { buildTranslatePrompt } from './prompt'
import type { Direction } from './types'

/**
 * 浏览器侧本地大模型配置。存 localStorage，只兼容 OpenAI 协议。
 * 配置了就由浏览器直连该端点做翻译，覆盖服务端那一套；没配就走服务端。
 */
export interface LocalModelConfig {
  /** OpenAI 兼容的 base_url，如 http://localhost:11434/v1 */
  baseUrl: string
  model: string
  /** 自定义翻译系统提示词；留空则用内置的按方向提示词 */
  prompt?: string
  /** 可选 API Key（本地 ollama 通常不需要，别的端点可能要） */
  apiKey?: string
}

const STORAGE_KEY = 'localModelConfig'

/** 读配置。只有 baseUrl 和 model 都填了才算有效，否则视为未配置（返回 null）。 */
export function getLocalModelConfig(): LocalModelConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as Partial<LocalModelConfig>
    const baseUrl = cfg.baseUrl?.trim()
    const model = cfg.model?.trim()
    if (!baseUrl || !model) return null
    return {
      baseUrl,
      model,
      prompt: cfg.prompt?.trim() || undefined,
      apiKey: cfg.apiKey?.trim() || undefined,
    }
  } catch {
    return null
  }
}

export function saveLocalModelConfig(cfg: LocalModelConfig): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

export function clearLocalModelConfig(): void {
  window.localStorage.removeItem(STORAGE_KEY)
}

/** 拼出 /chat/completions 端点，容忍 base_url 末尾有无斜杠。 */
function completionsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions'
}

/**
 * 浏览器直连本地模型做流式翻译，逐块产出文本增量。
 * 只处理 OpenAI 协议的 `data: {choices:[{delta:{content}}]}` 行。
 *
 * ⚠️ 注意：HTTPS 页面（线上 eng.eugen.uno）直连 http://localhost 会被浏览器
 * 按「混合内容」拦截；本地模型端点还需允许本站来源的 CORS。这两点由使用者
 * 在本地模型侧解决（如 ollama 设 OLLAMA_ORIGINS，或用 https 端点）。
 */
export async function* streamLocalTranslate(
  text: string,
  direction: Direction,
  config: LocalModelConfig,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const messages = buildTranslatePrompt(text, direction)
  // 自定义提示词覆盖内置的 system
  if (config.prompt) messages[0] = { role: 'system', content: config.prompt }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const res = await fetch(completionsUrl(config.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: config.model, messages, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`本地模型返回 ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const evt = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[]
        }
        const delta = evt.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // 单帧解析失败跳过，别毁掉整段译文
      }
    }
  }
}

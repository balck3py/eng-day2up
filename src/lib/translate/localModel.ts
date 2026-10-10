import { buildTranslatePrompt, buildWordFallbackPrompt, buildExplainPrompt } from './prompt'
import type { ChatMessage, Direction } from './types'
import { parseAiEntry } from '@/lib/dict/ai-parse'
import type { AiEntry } from '@/lib/dict/types'

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

type Listener = () => void

const listeners = new Set<Listener>()
/** 缓存的快照。useSyncExternalStore 要求同一状态下返回同一引用，
    而 getLocalModelConfig() 每次都新建对象，直接喂给它会无限重渲染。
    undefined 表示「尚未缓存」，null 是「确实没有配置」这个合法值。 */
let cached: LocalModelConfig | null | undefined = undefined

/** 配置被改动后调用：作废缓存并通知订阅者。 */
function emit(): void {
  cached = undefined
  for (const l of listeners) l()
}

export function subscribeLocalModelConfig(listener: Listener): () => void {
  listeners.add(listener)
  // 同一浏览器的其他标签页改了配置，这边也要跟着刷新
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) emit()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function getLocalModelConfigSnapshot(): LocalModelConfig | null {
  if (cached === undefined) cached = getLocalModelConfig()
  return cached
}

/** 服务端读不到 localStorage，恒为「未配置」。 */
export function getLocalModelConfigServerSnapshot(): LocalModelConfig | null {
  return null
}

export function saveLocalModelConfig(cfg: LocalModelConfig): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  emit()
}

export function clearLocalModelConfig(): void {
  window.localStorage.removeItem(STORAGE_KEY)
  emit()
}

/** 拼出 /chat/completions 端点，容忍 base_url 末尾有无斜杠。 */
function completionsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions'
}

function authHeaders(config: LocalModelConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  return headers
}

/**
 * 非流式调用本地模型，返回完整文本。用于释义/兜底这类一句话结果 ——
 * 边流边拼没有意义。失败抛异常，由调用方降级。
 */
async function chatComplete(
  config: LocalModelConfig,
  messages: ChatMessage[],
): Promise<string> {
  const res = await fetch(completionsUrl(config.baseUrl), {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ model: config.model, messages, stream: false }),
  })
  if (!res.ok) throw new Error(`本地模型返回 ${res.status}`)
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * 用本地模型为词库未收录的词生成词条（含拼写纠正、音标、释义）。
 * 复用服务端同一套 prompt 与防御性解析。失败或判定乱码返回 null，
 * 调用方据此降级为「未收录」。
 */
export async function generateLocalWordEntry(
  word: string,
  config: LocalModelConfig,
): Promise<AiEntry | null> {
  try {
    const entry = parseAiEntry(await chatComplete(config, buildWordFallbackPrompt(word)), word)
    if (!entry || entry.senses.length === 0) return null
    return entry
  } catch {
    return null
  }
}

/** 用本地模型解释某个词在具体句子里的含义（难词卡展开）。失败返回 null。 */
export async function explainLocal(
  word: string,
  context: string,
  config: LocalModelConfig,
): Promise<string | null> {
  try {
    const text = await chatComplete(config, buildExplainPrompt(word, context))
    return text.trim() || null
  } catch {
    return null
  }
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

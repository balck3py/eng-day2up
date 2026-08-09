import { toLines, parseOllamaLine } from './stream'
import type { ChatMessage, TranslationProvider } from './types'

/**
 * 家里自建的 ollama。配置缺失时在构造阶段就抛异常 —— 配置错误应尽早暴露，
 * 而不是等到用户点了翻译才失败。调用方（instance.ts）负责捕获并跳过。
 */
export function createOllamaProvider(): TranslationProvider {
  const base = process.env.OLLAMA_BASE_URL
  const token = process.env.OLLAMA_TOKEN
  const model = process.env.OLLAMA_MODEL
  if (!base || !token || !model) {
    throw new Error('OLLAMA_BASE_URL / OLLAMA_TOKEN / OLLAMA_MODEL 未配置')
  }

  return {
    name: 'ollama',
    async *stream(messages: ChatMessage[], signal?: AbortSignal) {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`ollama 返回 ${res.status}`)
      }
      for await (const line of toLines(res.body)) {
        // 同 cloud.ts：每行都产出，无内容时用空串当心跳，供调度器判首字节。
        yield parseOllamaLine(line) ?? ''
      }
    },
  }
}

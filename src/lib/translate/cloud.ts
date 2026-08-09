import { toLines, parseOpenAiLine } from './stream'
import type { ChatMessage, TranslationProvider } from './types'

/**
 * OpenAI 兼容的云端后端。配置缺失时在构造阶段抛异常，理由同 ollama.ts。
 *
 * 注意：当前配置的模型是推理模型，流的开头会先吐几十块 `delta.reasoning_content`
 * 才出现真正的 `delta.content`。`parseOpenAiLine` 会把它们判为 null 丢弃 ——
 * 所以「首字节」必须以 HTTP body 上读到的第一个块为准，不能以第一个
 * 非空文本增量为准，否则调度器会把健康的后端误判为超时。
 */
export function createCloudProvider(): TranslationProvider {
  const base = process.env.CLOUD_BASE_URL
  const key = process.env.CLOUD_API_KEY
  const model = process.env.CLOUD_MODEL
  if (!base || !key || !model) {
    throw new Error('CLOUD_BASE_URL / CLOUD_API_KEY / CLOUD_MODEL 未配置')
  }

  return {
    name: 'cloud',
    async *stream(messages: ChatMessage[], signal?: AbortSignal) {
      const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`云端返回 ${res.status}`)
      }
      for await (const line of toLines(res.body)) {
        // 每读到一行就产出一次，无文本内容时产出空串作为「连接还活着」的心跳。
        // 调度器据此判定首字节，并负责把空串滤掉不外传。
        yield parseOpenAiLine(line) ?? ''
      }
    },
  }
}

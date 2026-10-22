import { toLines, parseOpenAiLine } from './stream'
import type { ChatMessage, TranslationProvider } from './types'

/**
 * OpenAI 兼容的云端后端。配置缺失时在构造阶段抛异常，理由同 ollama.ts。
 *
 * 注意：当前配置的模型是推理模型。请求里已要求关闭思考，但端点偶尔不理会，
 * 此时流的开头仍会先吐几十块 `delta.reasoning_content`
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

  // 翻译/释义用不着推理。实测 DeepSeek-V4-Flash 每句先吐 600–1300 字思考，
  // 首个译文字要多等 1.4–5.7s；关掉后译文随首字节到达、质量无差别。
  // 不认识该参数的严格端点（如 OpenAI 官方）会报 400，可设 CLOUD_KEEP_THINKING=1 关掉它。
  const thinking =
    process.env.CLOUD_KEEP_THINKING === '1' ? {} : { thinking: { type: 'disabled' } }

  return {
    name: 'cloud',
    async *stream(messages: ChatMessage[], signal?: AbortSignal) {
      const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, stream: true, ...thinking }),
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

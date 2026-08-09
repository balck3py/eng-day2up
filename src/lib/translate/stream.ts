/** 解析 ollama /api/chat 的一行 NDJSON，返回文本增量。 */
export function parseOllamaLine(line: string): string | null {
  if (!line) return null
  try {
    const obj = JSON.parse(line) as { message?: { content?: unknown } }
    const c = obj.message?.content
    return typeof c === 'string' && c.length > 0 ? c : null
  } catch {
    return null
  }
}

/** 解析 OpenAI 兼容接口的一行 SSE，返回文本增量。 */
export function parseOpenAiLine(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const obj = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown } }[]
    }
    const c = obj.choices?.[0]?.delta?.content
    return typeof c === 'string' && c.length > 0 ? c : null
  } catch {
    return null
  }
}

/** 把字节流按换行切成行，正确处理跨块的行边界。空行被丢弃。 */
export async function* toLines(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
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
    // 冲刷解码器：流在多字节字符中途断掉时，尾字节留在 TextDecoder 内部，
    // 不 flush 就会被静默丢弃。
    buffer += decoder.decode()
    drained = true
    const tail = buffer.replace(/\r$/, '')
    if (tail) yield tail
  } finally {
    if (drained) {
      reader.releaseLock()
    } else {
      // 消费者提前 break / 迭代器被 return（调度器降级时就是如此）：
      // 只 releaseLock 会让底层 HTTP 请求继续跑完，必须真的取消。
      void reader.cancel().catch(() => {})
    }
  }
}

import { describe, it, expect, vi } from 'vitest'
import { completionsUrl, parseSseLine, streamChat, toLines, translateMessages, defineMessages } from './llm'

const enc = new TextEncoder()

function streamOf(chunks: Uint8Array[], onCancel = () => {}) {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++])
      else c.close()
    },
    cancel: onCancel,
  })
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`
const delta = (d: Record<string, string>) => sse({ choices: [{ delta: d }] })

describe('parseSseLine', () => {
  it('取 delta.content', () => {
    expect(parseSseLine(delta({ content: '你好' }).trim())).toBe('你好')
  })
  it('忽略 reasoning_content', () => {
    expect(parseSseLine(delta({ reasoning_content: '思考' }).trim())).toBeNull()
  })
  it('[DONE] 与非 data 行返回 null', () => {
    expect(parseSseLine('data: [DONE]')).toBeNull()
    expect(parseSseLine(': keep-alive')).toBeNull()
    expect(parseSseLine('data: {broken')).toBeNull()
  })
})

describe('toLines', () => {
  it('多字节字符跨块截断也能正确拼回', async () => {
    const bytes = enc.encode('第一行\n缓存')
    const cut = bytes.length - 1 // 把「存」的最后一个字节切到下一块
    const lines: string[] = []
    for await (const l of toLines(streamOf([bytes.slice(0, cut), bytes.slice(cut)]))) lines.push(l)
    expect(lines).toEqual(['第一行', '缓存'])
  })

  it('消费者提前退出时取消底层流', async () => {
    const onCancel = vi.fn()
    // 分多块，保证 break 时流还没读完
    const s = streamOf(['a\n', 'b\n', 'c\n'].map((x) => enc.encode(x)), onCancel)
    for await (const l of toLines(s)) {
      if (l === 'a') break
    }
    await Promise.resolve()
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('streamChat', () => {
  const cfg = { baseUrl: 'http://localhost:11434/v1/', model: 'm', apiKey: 'k' }

  it('拼接 content、跳过 reasoning，并带上鉴权头与正确的 URL', async () => {
    const body = delta({ reasoning_content: '嗯' }) + delta({ content: '缓存' }) +
      delta({ content: '过期了' }) + 'data: [DONE]\n\n'
    const fetchImpl = vi.fn(async () => new Response(streamOf([enc.encode(body)])))
    let out = ''
    for await (const d of streamChat(cfg, translateMessages('The cache is stale.'), fetchImpl)) out += d
    expect(out).toBe('缓存过期了')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body as string).stream).toBe(true)
  })

  it('非 2xx 抛错', async () => {
    const fetchImpl = async () => new Response('nope', { status: 502 })
    const it = streamChat(cfg, [], fetchImpl)[Symbol.asyncIterator]()
    await expect(it.next()).rejects.toThrow('502')
  })
})

describe('completionsUrl', () => {
  it('只有主机时补 /v1', () => {
    expect(completionsUrl('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(completionsUrl('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234/v1/chat/completions')
  })
  it('已有路径时原样拼接', () => {
    expect(completionsUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions')
    expect(completionsUrl('https://api.example.com/openai/v1')).toBe('https://api.example.com/openai/v1/chat/completions')
  })
})

describe('prompts', () => {
  it('中文走中译英，自定义 prompt 覆盖 system', () => {
    expect(translateMessages('缓存过期')[0].content).toMatch(/Translate the user's Chinese/)
    expect(translateMessages('stale', '  自定义 ')[0].content).toBe('自定义')
  })
  it('AI 释义 prompt 禁止音标', () => {
    expect(defineMessages('stale')[0].content).toContain('不要输出音标')
  })
})

# Plan 2 · 翻译层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付完整的中英互译能力 —— 单词走词典层，段落走流式 LLM 翻译并自动拆解难词，支持划词查询与上下文释义。

**Architecture:** `TranslationProvider` 抽象出 ollama 与 OpenAI 兼容云端两个实现，调度器以「首字节超时」为判据自动降级并带熔断。难词拆解完全走 SQL 词频计算，零 LLM 调用；上下文释义按需触发，因此段落模式的 LLM 调用次数恒为 1。

**Tech Stack:** 承接 Plan 1 —— TypeScript, Next.js 15 App Router, Supabase, Vitest

**前置条件:** Plan 1 全部 13 个任务已完成，且 `docs/infra/hardening.md` 中记录的 ollama 翻译质量判定为「可用」或「勉强」。

**⚠️ 若 Plan 1 Step 10 判定 ollama 翻译质量「不可用」**，先做这个决策再开工：要么换更大的本地模型重测，要么把 `CloudProvider` 提为主用、`OllamaProvider` 降为可选。本计划的 Provider 抽象两种情况都支持，只需调换 Task 7 调度器中的顺序。

## Global Constraints

- 承接 Plan 1 的全部 Global Constraints（Node 20+、npm、strict TS、Vitest、表名不得改、密钥不得加 `NEXT_PUBLIC_` 前缀、每 Task 必须 commit）
- **难词拆解不得调用 LLM** —— 全部靠 `dict_entries` 的词频列计算
- **段落模式的 LLM 调用次数必须恒为 1**，不随难词数量增长
- 首字节超时固定 **5000ms**；熔断阈值 **连续 3 次失败**，冷却 **5 分钟**
- 流式响应必须真正流式 —— 不得在服务端攒完再一次性返回
- 所有 LLM 调用前必须先过配额检查

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/lib/translate/types.ts` | Provider 接口与共享类型 |
| `src/lib/translate/prompt.ts` | prompt 构建（纯函数） |
| `src/lib/translate/stream.ts` | 两种流式协议的行解析（纯函数）+ 字节流转行 |
| `src/lib/translate/breaker.ts` | 熔断器（纯逻辑，时钟注入） |
| `src/lib/translate/ollama.ts` | `OllamaProvider` |
| `src/lib/translate/cloud.ts` | `CloudProvider` |
| `src/lib/translate/scheduler.ts` | 首字节超时降级调度 |
| `src/lib/quota.ts` | 配额检查 |
| `src/lib/hardwords/tokenize.ts` | 分词与停用词（纯函数） |
| `src/lib/hardwords/score.ts` | 难度打分与选取（纯函数） |
| `src/lib/hardwords/extract.ts` | 难词提取（查库，不调在线 API） |
| `src/app/api/translate/route.ts` | 流式翻译接口 |
| `src/app/api/hard-words/route.ts` | 难词提取接口 |
| `src/app/api/word/explain/route.ts` | 上下文释义接口 |
| `src/components/TranslateResult.tsx` | 段落模式结果区 |
| `src/components/HardWordGrid.tsx` | 难词卡片网格 |
| `src/components/SelectionPopover.tsx` | 划词浮层 |
| `src/app/page.tsx` | 主页（改造） |

**拆分原则：** 协议解析、熔断逻辑、打分算法全部做成不碰 IO 的纯函数，各自独立可测；Provider 只负责发请求和拼装，调度器只负责选择。这样「ollama 挂了会不会正确降级」这类问题可以用假 Provider 完整验证，不需要真的把家里的服务关掉。

---

### Task 1: Provider 类型与 prompt 构建

**Files:**
- Create: `src/lib/translate/types.ts`
- Create: `src/lib/translate/prompt.ts`
- Test: `src/lib/translate/prompt.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Direction = 'en2zh' | 'zh2en'`
  - `type ProviderName = 'ollama' | 'cloud'`
  - `interface ChatMessage { role: 'system' | 'user'; content: string }`
  - `interface TranslationProvider { readonly name: ProviderName; stream(messages: ChatMessage[]): AsyncIterable<string> }`
  - `buildTranslatePrompt(text: string, direction: Direction): ChatMessage[]`
  - `buildExplainPrompt(word: string, context: string): ChatMessage[]`

- [ ] **Step 1: 定义类型**

创建 `src/lib/translate/types.ts`：

```ts
export type Direction = 'en2zh' | 'zh2en'
export type ProviderName = 'ollama' | 'cloud'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/** 翻译后端的统一接口。两个实现共用同一套 prompt 与输出契约。 */
export interface TranslationProvider {
  readonly name: ProviderName
  /** 逐块产出文本增量。抛异常表示该 provider 不可用。 */
  stream(messages: ChatMessage[]): AsyncIterable<string>
}

/** 调度器的产出：已确定 provider，且首字节已到手。 */
export interface TranslationStream {
  provider: ProviderName
  chunks: AsyncIterable<string>
}
```

- [ ] **Step 2: 写失败的测试**

创建 `src/lib/translate/prompt.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildTranslatePrompt, buildExplainPrompt } from './prompt'

describe('buildTranslatePrompt', () => {
  it('英译中：system 指明目标语言为中文', () => {
    const msgs = buildTranslatePrompt('hello', 'en2zh')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('中文')
  })

  it('中译英：system 指明目标语言为英文', () => {
    const msgs = buildTranslatePrompt('你好', 'zh2en')
    expect(msgs[0].content).toContain('English')
  })

  it('要求只输出译文', () => {
    const msgs = buildTranslatePrompt('hello', 'en2zh')
    expect(msgs[0].content).toMatch(/只输出|only output/i)
  })

  it('原文原样放入 user 消息', () => {
    const msgs = buildTranslatePrompt('hello world', 'en2zh')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toBe('hello world')
  })

  it('恰好两条消息', () => {
    expect(buildTranslatePrompt('x', 'en2zh')).toHaveLength(2)
  })

  it('不改动原文中的换行', () => {
    const msgs = buildTranslatePrompt('a\nb', 'en2zh')
    expect(msgs[1].content).toBe('a\nb')
  })
})

describe('buildExplainPrompt', () => {
  it('同时包含目标词与上下文', () => {
    const msgs = buildExplainPrompt('bank', 'He sat by the bank of the river.')
    const all = msgs.map((m) => m.content).join('\n')
    expect(all).toContain('bank')
    expect(all).toContain('He sat by the bank of the river.')
  })

  it('要求简短回答', () => {
    const msgs = buildExplainPrompt('bank', 'ctx')
    expect(msgs[0].content).toMatch(/一句话|简短/)
  })

  it('明确禁止输出音标', () => {
    const msgs = buildExplainPrompt('bank', 'ctx')
    expect(msgs[0].content).toContain('音标')
  })

  it('恰好两条消息', () => {
    expect(buildExplainPrompt('x', 'y')).toHaveLength(2)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -- src/lib/translate/prompt.test.ts
```

预期：FAIL，`Failed to resolve import "./prompt"`

- [ ] **Step 4: 实现**

创建 `src/lib/translate/prompt.ts`：

```ts
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
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -- src/lib/translate/prompt.test.ts
```

预期：10 个测试全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/translate/types.ts src/lib/translate/prompt.ts src/lib/translate/prompt.test.ts
git commit -m "feat: 翻译层类型定义与 prompt 构建"
```

---

### Task 2: 流式协议解析

两个后端的流式格式不同：

- **ollama** `/api/chat` 返回 NDJSON，每行一个完整 JSON：
  `{"message":{"role":"assistant","content":"你"},"done":false}`
- **OpenAI 兼容** 返回 SSE：
  `data: {"choices":[{"delta":{"content":"你"}}]}`，结束标记为 `data: [DONE]`

把「按行解析」做成纯函数，「字节流转行」单独一个 generator，这样解析逻辑可以完全脱离网络测试。

**Files:**
- Create: `src/lib/translate/stream.ts`
- Test: `src/lib/translate/stream.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `parseOllamaLine(line: string): string | null` —— 返回文本增量；`null` 表示该行无内容或是结束标记
  - `parseOpenAiLine(line: string): string | null` —— 同上
  - `toLines(body: ReadableStream<Uint8Array>): AsyncIterable<string>` —— 字节流按 `\n` 切行，处理跨块边界

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/translate/stream.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseOllamaLine, parseOpenAiLine, toLines } from './stream'

describe('parseOllamaLine', () => {
  it('提取 message.content', () => {
    expect(parseOllamaLine('{"message":{"content":"你"},"done":false}')).toBe('你')
  })
  it('done 行无内容时返回 null', () => {
    expect(parseOllamaLine('{"done":true}')).toBeNull()
  })
  it('content 为空串时返回 null', () => {
    expect(parseOllamaLine('{"message":{"content":""},"done":false}')).toBeNull()
  })
  it('空行返回 null', () => {
    expect(parseOllamaLine('')).toBeNull()
  })
  it('非法 JSON 返回 null 而不抛异常', () => {
    expect(parseOllamaLine('{broken')).toBeNull()
  })
  it('缺少 message 字段返回 null', () => {
    expect(parseOllamaLine('{"done":false}')).toBeNull()
  })
  it('保留内容中的空格', () => {
    expect(parseOllamaLine('{"message":{"content":" world"}}')).toBe(' world')
  })
})

describe('parseOpenAiLine', () => {
  it('提取 delta.content', () => {
    expect(parseOpenAiLine('data: {"choices":[{"delta":{"content":"你"}}]}')).toBe('你')
  })
  it('[DONE] 返回 null', () => {
    expect(parseOpenAiLine('data: [DONE]')).toBeNull()
  })
  it('不带 data 前缀的行返回 null', () => {
    expect(parseOpenAiLine('{"choices":[]}')).toBeNull()
  })
  it('空 choices 返回 null', () => {
    expect(parseOpenAiLine('data: {"choices":[]}')).toBeNull()
  })
  it('delta 无 content（如首帧只有 role）返回 null', () => {
    expect(parseOpenAiLine('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull()
  })
  it('非法 JSON 返回 null 而不抛异常', () => {
    expect(parseOpenAiLine('data: {broken')).toBeNull()
  })
  it('容忍 data: 后没有空格', () => {
    expect(parseOpenAiLine('data:{"choices":[{"delta":{"content":"x"}}]}')).toBe('x')
  })
  it('空行返回 null', () => {
    expect(parseOpenAiLine('')).toBeNull()
  })
})

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(enc.encode(c)))
      controller.close()
    },
  })
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const v of it) out.push(v)
  return out
}

describe('toLines', () => {
  it('按换行切分', async () => {
    expect(await collect(toLines(streamOf('a\nb\nc')))).toEqual(['a', 'b', 'c'])
  })
  it('处理跨块的行边界', async () => {
    expect(await collect(toLines(streamOf('he', 'llo\nwor', 'ld')))).toEqual(['hello', 'world'])
  })
  it('产出末尾没有换行的最后一行', async () => {
    expect(await collect(toLines(streamOf('only')))).toEqual(['only'])
  })
  it('丢弃空行', async () => {
    expect(await collect(toLines(streamOf('a\n\n\nb')))).toEqual(['a', 'b'])
  })
  it('去掉行尾的回车符', async () => {
    expect(await collect(toLines(streamOf('a\r\nb')))).toEqual(['a', 'b'])
  })
  it('空流产出空数组', async () => {
    expect(await collect(toLines(streamOf()))).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/translate/stream.test.ts
```

预期：FAIL，`Failed to resolve import "./stream"`

- [ ] **Step 3: 实现**

创建 `src/lib/translate/stream.ts`：

```ts
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
    const tail = buffer.replace(/\r$/, '')
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/translate/stream.test.ts
```

预期：21 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/translate/stream.ts src/lib/translate/stream.test.ts
git commit -m "feat: ollama NDJSON 与 OpenAI SSE 流式解析"
```

---

### Task 3: 熔断器

时钟通过参数注入，因此可以在测试里精确控制时间推进，不需要 `sleep`。

**Files:**
- Create: `src/lib/translate/breaker.ts`
- Test: `src/lib/translate/breaker.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `class CircuitBreaker`，构造参数 `(threshold: number, cooldownMs: number)`，方法：
  - `isOpen(now: number): boolean`
  - `recordSuccess(): void`
  - `recordFailure(now: number): void`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/translate/breaker.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from './breaker'

const T = 1_000_000   // 任意基准时刻

describe('CircuitBreaker', () => {
  it('初始为闭合状态', () => {
    expect(new CircuitBreaker(3, 5000).isOpen(T)).toBe(false)
  })

  it('未达阈值不熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T)
    b.recordFailure(T)
    expect(b.isOpen(T)).toBe(false)
  })

  it('达到阈值后熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    expect(b.isOpen(T)).toBe(true)
  })

  it('冷却期内保持熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    expect(b.isOpen(T + 4999)).toBe(true)
  })

  it('冷却期满后恢复', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    expect(b.isOpen(T + 5000)).toBe(false)
  })

  it('成功后失败计数清零', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T)
    b.recordSuccess()
    b.recordFailure(T)
    expect(b.isOpen(T)).toBe(false)
  })

  it('成功后立即解除熔断', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    b.recordSuccess()
    expect(b.isOpen(T)).toBe(false)
  })

  it('冷却期满后再次失败需重新累积到阈值', () => {
    const b = new CircuitBreaker(3, 5000)
    b.recordFailure(T); b.recordFailure(T); b.recordFailure(T)
    const after = T + 5000
    expect(b.isOpen(after)).toBe(false)
    b.recordFailure(after)
    expect(b.isOpen(after)).toBe(false)   // 计数已在恢复时清零
  })

  it('阈值为 1 时单次失败即熔断', () => {
    const b = new CircuitBreaker(1, 5000)
    b.recordFailure(T)
    expect(b.isOpen(T)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/translate/breaker.test.ts
```

预期：FAIL，`Failed to resolve import "./breaker"`

- [ ] **Step 3: 实现**

创建 `src/lib/translate/breaker.ts`：

```ts
/**
 * 连续失败达到阈值即熔断，冷却期满自动恢复并清零计数。
 * 时钟通过参数注入，便于测试。
 *
 * 注意：Vercel 的无状态函数实例之间不共享该状态，各实例独立维护。
 * 最坏情况是每个新实例多试探一次 ollama，可接受。
 */
export class CircuitBreaker {
  private failures = 0
  private openUntil = 0

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  isOpen(now: number): boolean {
    if (this.openUntil === 0) return false
    if (now >= this.openUntil) {
      // 冷却期满，恢复并清零
      this.openUntil = 0
      this.failures = 0
      return false
    }
    return true
  }

  recordSuccess(): void {
    this.failures = 0
    this.openUntil = 0
  }

  recordFailure(now: number): void {
    this.failures += 1
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.cooldownMs
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/translate/breaker.test.ts
```

预期：9 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/translate/breaker.ts src/lib/translate/breaker.test.ts
git commit -m "feat: 翻译后端熔断器"
```

---

### Task 4: 两个 Provider 实现

**Files:**
- Create: `src/lib/translate/ollama.ts`
- Create: `src/lib/translate/cloud.ts`

**Interfaces:**
- Consumes: `TranslationProvider` / `ChatMessage`（Task 1）、`toLines` / `parseOllamaLine` / `parseOpenAiLine`（Task 2）
- Produces:
  - `createOllamaProvider(): TranslationProvider`
  - `createCloudProvider(): TranslationProvider`

两者都在环境变量缺失时**在构造阶段抛异常**，而不是等到请求时才失败 —— 配置错误应当尽早暴露。

- [ ] **Step 1: 实现 OllamaProvider**

创建 `src/lib/translate/ollama.ts`：

```ts
import { toLines, parseOllamaLine } from './stream'
import type { ChatMessage, TranslationProvider } from './types'

export function createOllamaProvider(): TranslationProvider {
  const base = process.env.OLLAMA_BASE_URL
  const token = process.env.OLLAMA_TOKEN
  const model = process.env.OLLAMA_MODEL
  if (!base || !token || !model) {
    throw new Error('OLLAMA_BASE_URL / OLLAMA_TOKEN / OLLAMA_MODEL 未配置')
  }

  return {
    name: 'ollama',
    async *stream(messages: ChatMessage[]) {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
      })
      if (!res.ok || !res.body) {
        throw new Error(`ollama 返回 ${res.status}`)
      }
      for await (const line of toLines(res.body)) {
        const delta = parseOllamaLine(line)
        if (delta) yield delta
      }
    },
  }
}
```

- [ ] **Step 2: 实现 CloudProvider**

创建 `src/lib/translate/cloud.ts`：

```ts
import { toLines, parseOpenAiLine } from './stream'
import type { ChatMessage, TranslationProvider } from './types'

export function createCloudProvider(): TranslationProvider {
  const base = process.env.CLOUD_BASE_URL
  const key = process.env.CLOUD_API_KEY
  const model = process.env.CLOUD_MODEL
  if (!base || !key || !model) {
    throw new Error('CLOUD_BASE_URL / CLOUD_API_KEY / CLOUD_MODEL 未配置')
  }

  return {
    name: 'cloud',
    async *stream(messages: ChatMessage[]) {
      const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
      })
      if (!res.ok || !res.body) {
        throw new Error(`云端返回 ${res.status}`)
      }
      for await (const line of toLines(res.body)) {
        const delta = parseOpenAiLine(line)
        if (delta) yield delta
      }
    },
  }
}
```

- [ ] **Step 3: 手动连通性验证**

创建临时脚本 `scripts/check-providers.ts`：

```ts
import 'dotenv/config'
import { createOllamaProvider } from '../src/lib/translate/ollama'
import { createCloudProvider } from '../src/lib/translate/cloud'
import { buildTranslatePrompt } from '../src/lib/translate/prompt'

const msgs = buildTranslatePrompt(
  'The committee deferred the decision pending further review.', 'en2zh')

for (const make of [createOllamaProvider, createCloudProvider]) {
  try {
    const p = make()
    process.stdout.write(`\n[${p.name}] `)
    const t0 = Date.now()
    let first = true
    for await (const chunk of p.stream(msgs)) {
      if (first) { process.stdout.write(`首字节 ${Date.now() - t0}ms\n`); first = false }
      process.stdout.write(chunk)
    }
    process.stdout.write('\n')
  } catch (e) {
    console.error(`\n失败: ${(e as Error).message}`)
  }
}
```

在 `.env.local` 填好六个变量后运行：

```bash
npx tsx scripts/check-providers.ts
```

预期：两个 provider 都输出中文译文，并打印各自的首字节耗时。

**记录 ollama 的首字节耗时** —— 若经常超过 3 秒，说明 5 秒的超时阈值余量偏小，需在 Task 5 中调大。

验证完毕后删除该脚本。

- [ ] **Step 4: Commit**

```bash
git add src/lib/translate/ollama.ts src/lib/translate/cloud.ts
git commit -m "feat: ollama 与 OpenAI 兼容云端 Provider 实现"
```

---

### Task 5: 降级调度器

核心判据是**首字节超时**而非总超时 —— 流式响应的总时长不可控，但「隧道通不通」在首字节就能判定。

调度器先取到第一个数据块再返回，因此 `provider` 字段在返回时已确定，可以直接写入响应头。

**Files:**
- Create: `src/lib/translate/scheduler.ts`
- Test: `src/lib/translate/scheduler.test.ts`

**Interfaces:**
- Consumes: `TranslationProvider` / `TranslationStream` / `ChatMessage`（Task 1）、`CircuitBreaker`（Task 3）
- Produces:
  - `createScheduler(providers: TranslationProvider[], opts?): Scheduler`
  - `Scheduler.run(messages: ChatMessage[]): Promise<TranslationStream>` —— 全部 provider 都失败时抛异常

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/translate/scheduler.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { createScheduler } from './scheduler'
import type { ChatMessage, ProviderName, TranslationProvider } from './types'

const MSGS: ChatMessage[] = [{ role: 'user', content: 'x' }]

function okProvider(name: ProviderName, chunks: string[]): TranslationProvider {
  return {
    name,
    async *stream() { for (const c of chunks) yield c },
  }
}

function failProvider(name: ProviderName): TranslationProvider {
  return {
    name,
    // eslint-disable-next-line require-yield
    async *stream() { throw new Error(`${name} 挂了`) },
  }
}

/** 首字节前挂起 delayMs 的 provider */
function slowProvider(name: ProviderName, delayMs: number): TranslationProvider {
  return {
    name,
    async *stream() {
      await new Promise((r) => setTimeout(r, delayMs))
      yield 'late'
    },
  }
}

async function drain(it: AsyncIterable<string>): Promise<string> {
  let s = ''
  for await (const c of it) s += c
  return s
}

describe('createScheduler', () => {
  it('首选可用时直接使用它', async () => {
    const s = createScheduler([okProvider('ollama', ['你', '好']), failProvider('cloud')])
    const r = await s.run(MSGS)
    expect(r.provider).toBe('ollama')
    expect(await drain(r.chunks)).toBe('你好')
  })

  it('首选抛异常时降级到次选', async () => {
    const s = createScheduler([failProvider('ollama'), okProvider('cloud', ['fall', 'back'])])
    const r = await s.run(MSGS)
    expect(r.provider).toBe('cloud')
    expect(await drain(r.chunks)).toBe('fallback')
  })

  it('首字节超时时降级', async () => {
    const s = createScheduler(
      [slowProvider('ollama', 200), okProvider('cloud', ['ok'])],
      { firstByteTimeoutMs: 50 },
    )
    const r = await s.run(MSGS)
    expect(r.provider).toBe('cloud')
  })

  it('降级后不丢首字节', async () => {
    const s = createScheduler([failProvider('ollama'), okProvider('cloud', ['A', 'B', 'C'])])
    const r = await s.run(MSGS)
    expect(await drain(r.chunks)).toBe('ABC')
  })

  it('全部失败时抛异常', async () => {
    const s = createScheduler([failProvider('ollama'), failProvider('cloud')])
    await expect(s.run(MSGS)).rejects.toThrow()
  })

  it('连续失败达阈值后跳过该 provider 不再试探', async () => {
    const ollama = failProvider('ollama')
    const spy = vi.spyOn(ollama, 'stream')
    const s = createScheduler([ollama, okProvider('cloud', ['x'])], {
      failureThreshold: 2, cooldownMs: 60_000,
    })
    await s.run(MSGS)   // 第 1 次失败
    await s.run(MSGS)   // 第 2 次失败 → 熔断
    await s.run(MSGS)   // 熔断中，应跳过
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('成功一次后失败计数清零', async () => {
    let shouldFail = true
    const flaky: TranslationProvider = {
      name: 'ollama',
      async *stream() {
        if (shouldFail) throw new Error('boom')
        yield 'ok'
      },
    }
    const s = createScheduler([flaky, okProvider('cloud', ['c'])], {
      failureThreshold: 2, cooldownMs: 60_000,
    })
    await s.run(MSGS)              // 失败 1
    shouldFail = false
    expect((await s.run(MSGS)).provider).toBe('ollama')   // 成功，清零
    shouldFail = true
    await s.run(MSGS)              // 失败 1（不是 2）
    shouldFail = false
    expect((await s.run(MSGS)).provider).toBe('ollama')   // 未熔断
  })

  it('只有一个 provider 且可用时正常工作', async () => {
    const s = createScheduler([okProvider('cloud', ['solo'])])
    expect((await s.run(MSGS)).provider).toBe('cloud')
  })

  it('首字节之后的错误不触发降级（已开始输出）', async () => {
    const midFail: TranslationProvider = {
      name: 'ollama',
      async *stream() {
        yield 'start'
        throw new Error('中途断流')
      },
    }
    const s = createScheduler([midFail, okProvider('cloud', ['never'])])
    const r = await s.run(MSGS)
    expect(r.provider).toBe('ollama')
    await expect(drain(r.chunks)).rejects.toThrow('中途断流')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/translate/scheduler.test.ts
```

预期：FAIL，`Failed to resolve import "./scheduler"`

- [ ] **Step 3: 实现**

创建 `src/lib/translate/scheduler.ts`：

```ts
import { CircuitBreaker } from './breaker'
import type { ChatMessage, TranslationProvider, TranslationStream } from './types'

export interface SchedulerOptions {
  /** 首字节超时。总时长不设限 —— 流式响应长度不可控。 */
  firstByteTimeoutMs?: number
  failureThreshold?: number
  cooldownMs?: number
}

export interface Scheduler {
  run(messages: ChatMessage[]): Promise<TranslationStream>
}

const DEFAULTS = {
  firstByteTimeoutMs: 5000,
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000,
}

/** 在 timeoutMs 内取迭代器的第一个值，超时则拒绝。 */
async function firstChunk(
  it: AsyncIterator<string>, timeoutMs: number,
): Promise<IteratorResult<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('首字节超时')), timeoutMs)
  })
  try {
    return await Promise.race([it.next(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 按顺序尝试各 provider，以首字节是否按时到达为判据决定是否降级。
 * 首字节到手后才返回，因此 TranslationStream.provider 一定是最终生效的那个。
 * 首字节之后的错误不再降级 —— 此时已经有内容输出给用户了。
 */
export function createScheduler(
  providers: TranslationProvider[], opts: SchedulerOptions = {},
): Scheduler {
  const cfg = { ...DEFAULTS, ...opts }
  const breakers = new Map<string, CircuitBreaker>(
    providers.map((p) => [p.name, new CircuitBreaker(cfg.failureThreshold, cfg.cooldownMs)]),
  )

  return {
    async run(messages) {
      const errors: string[] = []

      for (const provider of providers) {
        const breaker = breakers.get(provider.name)!
        if (breaker.isOpen(Date.now())) {
          errors.push(`${provider.name}: 熔断中`)
          continue
        }

        const iterator = provider.stream(messages)[Symbol.asyncIterator]()
        let head: IteratorResult<string>
        try {
          head = await firstChunk(iterator, cfg.firstByteTimeoutMs)
        } catch (e) {
          breaker.recordFailure(Date.now())
          errors.push(`${provider.name}: ${(e as Error).message}`)
          void iterator.return?.(undefined)
          continue
        }

        breaker.recordSuccess()

        return {
          provider: provider.name,
          chunks: (async function* () {
            if (!head.done) yield head.value
            for (;;) {
              const next = await iterator.next()
              if (next.done) return
              yield next.value
            }
          })(),
        }
      }

      throw new Error(`所有翻译后端均不可用 —— ${errors.join('; ')}`)
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/translate/scheduler.test.ts
```

预期：9 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/translate/scheduler.ts src/lib/translate/scheduler.test.ts
git commit -m "feat: 首字节超时降级调度器"
```

---

### Task 6: 配额检查

**Files:**
- Create: `src/lib/quota.ts`

**Interfaces:**
- Consumes: Plan 1 Task 3 建立的 RPC `increment_usage(p_user uuid, p_limit int) returns boolean`
- Produces: `consumeQuota(db: SupabaseClient, userId: string): Promise<boolean>` —— `true` 表示未超额、可以继续

- [ ] **Step 1: 实现**

创建 `src/lib/quota.ts`：

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_QUOTA = 200

/**
 * 原子递增当日用量并判断是否超额。
 * 返回 true 表示可以继续；false 表示已超出每日配额。
 *
 * RPC 调用失败时返回 true（放行）—— 配额是防滥用手段，
 * 不应因为计数表的故障而让正常用户完全不能用。
 */
export async function consumeQuota(
  db: SupabaseClient, userId: string,
): Promise<boolean> {
  const limit = Number.parseInt(process.env.DAILY_QUOTA ?? '', 10) || DEFAULT_QUOTA
  const { data, error } = await db.rpc('increment_usage', {
    p_user: userId,
    p_limit: limit,
  })
  if (error) {
    console.error('配额检查失败，放行:', error.message)
    return true
  }
  return data === true
}
```

- [ ] **Step 2: 手动验证 RPC**

在 Supabase SQL Editor 中，用一个真实的 user id 运行三次：

```sql
select increment_usage('<你的 user uuid>'::uuid, 2);
select increment_usage('<你的 user uuid>'::uuid, 2);
select increment_usage('<你的 user uuid>'::uuid, 2);
```

预期：依次返回 `true`、`true`、`false`。

清理测试数据：

```sql
delete from usage_counter where user_id = '<你的 user uuid>'::uuid;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/quota.ts
git commit -m "feat: 每日翻译配额检查"
```

---

### Task 7: 分词与难度打分

难词判定完全靠词频数据，**不调用 LLM**。

打分规则：

| 条件 | 分值 |
|---|---|
| 不在 `dict_entries` 中（生僻/专业词） | 1000（最高） |
| 在词库中 | `min(词频排名 / 50, 500)`，排名取 `frq` 与 `bnc` 中较小的非零值；两者皆无按 20000 计 |
| 牛津核心词 | −100 |
| 柯林斯 ≥ 4 星 | −80 |
| 柯林斯 = 3 星 | −40 |
| 已收藏且 `familiarity ≥ 4` | 排除（返回 −1） |
| 已收藏且 `familiarity < 4` | +200（提权靠前） |

**Files:**
- Create: `src/lib/hardwords/tokenize.ts`
- Create: `src/lib/hardwords/score.ts`
- Test: `src/lib/hardwords/tokenize.test.ts`
- Test: `src/lib/hardwords/score.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `tokenize(text: string): { surface: string; key: string; index: number }[]` —— 已去停用词，`index` 为在原文中的出现序号
  - `interface ScoreInput { key: string; index: number; frq: number | null; bnc: number | null; oxford: number | null; collins: number | null; inDict: boolean; familiarity: number | null }`
  - `scoreWord(input: ScoreInput): number` —— 返回 −1 表示应排除
  - `selectHardWords(inputs: ScoreInput[], limit: number): ScoreInput[]` —— 取分值最高的 limit 个，再按 `index` 升序返回

- [ ] **Step 1: 写分词的失败测试**

创建 `src/lib/hardwords/tokenize.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { tokenize } from './tokenize'

describe('tokenize', () => {
  it('切出英文单词并小写化', () => {
    expect(tokenize('Hello World').map((t) => t.key)).toEqual(['hello', 'world'])
  })
  it('保留原始形态', () => {
    expect(tokenize('Hello')[0].surface).toBe('Hello')
  })
  it('剔除停用词', () => {
    expect(tokenize('the committee of a review').map((t) => t.key))
      .toEqual(['committee', 'review'])
  })
  it('忽略标点', () => {
    expect(tokenize('deferred, pending.').map((t) => t.key))
      .toEqual(['deferred', 'pending'])
  })
  it('忽略中文', () => {
    expect(tokenize('委员会 deferred 决定').map((t) => t.key)).toEqual(['deferred'])
  })
  it('忽略纯数字', () => {
    expect(tokenize('2024 review').map((t) => t.key)).toEqual(['review'])
  })
  it('保留词内连字符', () => {
    expect(tokenize('well-known').map((t) => t.key)).toEqual(['well-known'])
  })
  it('剔除单字母词', () => {
    expect(tokenize('a b committee').map((t) => t.key)).toEqual(['committee'])
  })
  it('同一个词重复出现只保留首次', () => {
    const out = tokenize('review the review again')
    expect(out.filter((t) => t.key === 'review')).toHaveLength(1)
  })
  it('index 反映出现顺序', () => {
    const out = tokenize('alpha beta gamma')
    expect(out.map((t) => t.index)).toEqual([0, 1, 2])
  })
  it('空文本返回空数组', () => {
    expect(tokenize('')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- src/lib/hardwords/tokenize.test.ts
```

预期：FAIL，`Failed to resolve import "./tokenize"`

- [ ] **Step 3: 实现分词**

创建 `src/lib/hardwords/tokenize.ts`：

```ts
/** 高频功能词，不作为难词候选。 */
export const STOP_WORDS: ReadonlySet<string> = new Set(`
a an the and or but if then than that this these those there here
i you he she it we they me him her us them my your his its our their
is am are was were be been being do does did done have has had having
will would shall should can could may might must
of in on at to for from by with without into onto over under about
as so not no nor too very just only also even still yet
what which who whom whose when where why how
one two three first next last other some any each every all both
up down out off again more most much many few less least own same
`.trim().split(/\s+/))

const TOKEN_RE = /[a-zA-Z][a-zA-Z'-]*/g

/**
 * 切出英文单词，去停用词与单字母词，同词只保留首次出现。
 * index 是去重后的出现序号，用于最终按原文顺序还原排列。
 */
export function tokenize(text: string): { surface: string; key: string; index: number }[] {
  const seen = new Set<string>()
  const out: { surface: string; key: string; index: number }[] = []

  for (const m of text.matchAll(TOKEN_RE)) {
    const surface = m[0]
    const key = surface.toLowerCase()
    if (key.length < 2) continue
    if (STOP_WORDS.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ surface, key, index: out.length })
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npm test -- src/lib/hardwords/tokenize.test.ts
```

预期：11 个测试全部 PASS

- [ ] **Step 5: 写打分的失败测试**

创建 `src/lib/hardwords/score.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { scoreWord, selectHardWords } from './score'
import type { ScoreInput } from './score'

function input(o: Partial<ScoreInput> = {}): ScoreInput {
  return {
    key: 'w', index: 0, frq: null, bnc: null, oxford: null,
    collins: null, inDict: true, familiarity: null, ...o,
  }
}

describe('scoreWord', () => {
  it('不在词库中的词得最高分', () => {
    expect(scoreWord(input({ inDict: false }))).toBe(1000)
  })
  it('词频排名越靠后分越高', () => {
    const common = scoreWord(input({ frq: 500 }))
    const rare = scoreWord(input({ frq: 20000 }))
    expect(rare).toBeGreaterThan(common)
  })
  it('词频得分有上限 500', () => {
    expect(scoreWord(input({ frq: 999999 }))).toBeLessThanOrEqual(500)
  })
  it('frq 与 bnc 取较小者（更常见者）', () => {
    expect(scoreWord(input({ frq: 30000, bnc: 500 })))
      .toBe(scoreWord(input({ frq: 500 })))
  })
  it('两者皆无时按 20000 计', () => {
    expect(scoreWord(input())).toBe(scoreWord(input({ frq: 20000 })))
  })
  it('牛津核心词降分', () => {
    expect(scoreWord(input({ frq: 20000, oxford: 1 })))
      .toBe(scoreWord(input({ frq: 20000 })) - 100)
  })
  it('柯林斯 5 星降 80 分', () => {
    expect(scoreWord(input({ frq: 20000, collins: 5 })))
      .toBe(scoreWord(input({ frq: 20000 })) - 80)
  })
  it('柯林斯 3 星降 40 分', () => {
    expect(scoreWord(input({ frq: 20000, collins: 3 })))
      .toBe(scoreWord(input({ frq: 20000 })) - 40)
  })
  it('已掌握的词返回 -1（排除）', () => {
    expect(scoreWord(input({ familiarity: 4 }))).toBe(-1)
    expect(scoreWord(input({ familiarity: 5 }))).toBe(-1)
  })
  it('已收藏未掌握的词提权 200', () => {
    expect(scoreWord(input({ frq: 20000, familiarity: 1 })))
      .toBe(scoreWord(input({ frq: 20000 })) + 200)
  })
  it('不在词库但已掌握，仍然排除', () => {
    expect(scoreWord(input({ inDict: false, familiarity: 5 }))).toBe(-1)
  })
})

describe('selectHardWords', () => {
  it('取分值最高的前 N 个', () => {
    const items = [
      input({ key: 'easy', index: 0, frq: 100 }),
      input({ key: 'hard', index: 1, inDict: false }),
      input({ key: 'mid', index: 2, frq: 30000 }),
    ]
    expect(selectHardWords(items, 2).map((i) => i.key)).toEqual(['hard', 'mid'])
  })
  it('结果按原文出现顺序排列', () => {
    const items = [
      input({ key: 'mid', index: 0, frq: 30000 }),
      input({ key: 'easy', index: 1, frq: 100 }),
      input({ key: 'hard', index: 2, inDict: false }),
    ]
    expect(selectHardWords(items, 2).map((i) => i.key)).toEqual(['mid', 'hard'])
  })
  it('排除已掌握的词', () => {
    const items = [
      input({ key: 'known', index: 0, inDict: false, familiarity: 5 }),
      input({ key: 'new', index: 1, frq: 30000 }),
    ]
    expect(selectHardWords(items, 5).map((i) => i.key)).toEqual(['new'])
  })
  it('候选不足时返回全部', () => {
    expect(selectHardWords([input({ frq: 30000 })], 12)).toHaveLength(1)
  })
  it('空输入返回空数组', () => {
    expect(selectHardWords([], 12)).toEqual([])
  })
  it('limit 为 0 时返回空数组', () => {
    expect(selectHardWords([input({ inDict: false })], 0)).toEqual([])
  })
})
```

- [ ] **Step 6: 运行确认失败**

```bash
npm test -- src/lib/hardwords/score.test.ts
```

预期：FAIL，`Failed to resolve import "./score"`

- [ ] **Step 7: 实现打分**

创建 `src/lib/hardwords/score.ts`：

```ts
export interface ScoreInput {
  key: string
  /** 在原文中的出现序号 */
  index: number
  frq: number | null
  bnc: number | null
  oxford: number | null
  collins: number | null
  /** 是否在 dict_entries 中 */
  inDict: boolean
  /** 用户单词本中的熟练度；null 表示未收藏 */
  familiarity: number | null
}

const NOT_IN_DICT_SCORE = 1000
const UNKNOWN_RANK = 20000
const RANK_DIVISOR = 50
const RANK_CAP = 500
const MASTERED_THRESHOLD = 4
const SAVED_BOOST = 200

/**
 * 计算难度分。返回 -1 表示应当排除（用户已掌握）。
 * 全程只用词频数据与用户熟练度，不调用 LLM。
 */
export function scoreWord(input: ScoreInput): number {
  if (input.familiarity !== null && input.familiarity >= MASTERED_THRESHOLD) {
    return -1
  }

  let score: number
  if (!input.inDict) {
    score = NOT_IN_DICT_SCORE
  } else {
    const ranks = [input.frq, input.bnc].filter(
      (r): r is number => typeof r === 'number' && r > 0,
    )
    const rank = ranks.length > 0 ? Math.min(...ranks) : UNKNOWN_RANK
    score = Math.min(rank / RANK_DIVISOR, RANK_CAP)

    if ((input.oxford ?? 0) > 0) score -= 100
    if ((input.collins ?? 0) >= 4) score -= 80
    else if (input.collins === 3) score -= 40
  }

  if (input.familiarity !== null) score += SAVED_BOOST
  return score
}

/** 取分值最高的 limit 个，再按原文出现顺序返回。 */
export function selectHardWords(inputs: ScoreInput[], limit: number): ScoreInput[] {
  return inputs
    .map((i) => ({ item: i, score: scoreWord(i) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.item.index - b.item.index)
    .map((s) => s.item)
}
```

- [ ] **Step 8: 运行确认通过**

```bash
npm test -- src/lib/hardwords/score.test.ts
```

预期：17 个测试全部 PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/hardwords/
git commit -m "feat: 分词、停用词与难词打分算法"
```

---

### Task 8: 难词提取服务

把分词、词形还原、查库、打分串起来。**只查 `dict_entries`，不调用 dictionaryapi.dev** —— 段落里的难词卡片只需要 ECDICT 的释义和保底音标，展开明细时才走完整的 `lookupWord`。这是控制段落模式延迟的关键。

**Files:**
- Create: `src/lib/hardwords/extract.ts`
- Create: `src/app/api/hard-words/route.ts`

**Interfaces:**
- Consumes: `tokenize`（Task 7）、`selectHardWords` / `ScoreInput`（Task 7）、`stripSuffixCandidates`（Plan 1 Task 9）、`parseTranslation`（Plan 1 Task 7）
- Produces:
  - `interface HardWord { word: string; surface: string; phonetic: string | null; senses: Sense[]; tags: string[] }`
  - `extractHardWords(db: SupabaseClient, text: string, userId: string, limit?: number): Promise<HardWord[]>`
  - `POST /api/hard-words`，body `{ text: string }` → `{ words: HardWord[] }`

- [ ] **Step 1: 实现提取服务**

创建 `src/lib/hardwords/extract.ts`：

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseTranslation } from '@/lib/dict/senses'
import { stripSuffixCandidates } from '@/lib/dict/inflect'
import type { Sense } from '@/lib/dict/types'
import { tokenize } from './tokenize'
import { selectHardWords, type ScoreInput } from './score'

export interface HardWord {
  /** 命中的原型 */
  word: string
  /** 原文中的形态 */
  surface: string
  phonetic: string | null
  senses: Sense[]
  tags: string[]
}

const DEFAULT_LIMIT = 12

interface EntryRow {
  word: string
  word_key: string
  phonetic: string | null
  translation: string | null
  collins: number | null
  oxford: number | null
  tag: string | null
  bnc: number | null
  frq: number | null
}

/**
 * 从段落中提取难词。全程不调用 LLM，也不调用在线词典 API。
 * 三次批量查询搞定：词条 → 词形还原 → 用户单词本。
 */
export async function extractHardWords(
  db: SupabaseClient, text: string, userId: string, limit = DEFAULT_LIMIT,
): Promise<HardWord[]> {
  const tokens = tokenize(text)
  if (tokens.length === 0) return []

  const cols = 'word, word_key, phonetic, translation, collins, oxford, tag, bnc, frq'

  // 1) 直接命中
  const { data: direct } = await db
    .from('dict_entries').select(cols).in('word_key', tokens.map((t) => t.key))
  const byKey = new Map<string, EntryRow>()
  for (const r of (direct ?? []) as unknown as EntryRow[]) byKey.set(r.word_key, r)

  // 2) 未命中的走词形还原
  const missed = tokens.filter((t) => !byKey.has(t.key))
  if (missed.length > 0) {
    const { data: lemmaRows } = await db
      .from('dict_lemma').select('form, lemma').in('form', missed.map((t) => t.key))

    const formToLemma = new Map<string, string>()
    for (const r of (lemmaRows ?? []) as { form: string; lemma: string }[]) {
      if (!formToLemma.has(r.form)) formToLemma.set(r.form, r.lemma)
    }
    // dict_lemma 也没有的，用后缀规则再猜一批
    for (const t of missed) {
      if (!formToLemma.has(t.key)) {
        const cand = stripSuffixCandidates(t.key)[0]
        if (cand) formToLemma.set(t.key, cand)
      }
    }

    const lemmaKeys = [...new Set(formToLemma.values())].filter((k) => !byKey.has(k))
    if (lemmaKeys.length > 0) {
      const { data: viaLemma } = await db
        .from('dict_entries').select(cols).in('word_key', lemmaKeys)
      const lemmaEntries = new Map<string, EntryRow>()
      for (const r of (viaLemma ?? []) as unknown as EntryRow[]) {
        lemmaEntries.set(r.word_key, r)
      }
      for (const [form, lemma] of formToLemma) {
        const hit = lemmaEntries.get(lemma)
        if (hit) byKey.set(form, hit)
      }
    }
  }

  // 3) 用户单词本熟练度
  const { data: saved } = await db
    .from('wordbook').select('word_key, familiarity')
    .eq('user_id', userId).in('word_key', [...new Set([
      ...tokens.map((t) => t.key),
      ...[...byKey.values()].map((e) => e.word_key),
    ])])
  const familiarity = new Map<string, number>()
  for (const r of (saved ?? []) as { word_key: string; familiarity: number }[]) {
    familiarity.set(r.word_key, r.familiarity)
  }

  // 4) 打分选取
  const inputs: ScoreInput[] = tokens.map((t) => {
    const entry = byKey.get(t.key) ?? null
    const famKey = entry?.word_key ?? t.key
    return {
      key: t.key,
      index: t.index,
      frq: entry?.frq ?? null,
      bnc: entry?.bnc ?? null,
      oxford: entry?.oxford ?? null,
      collins: entry?.collins ?? null,
      inDict: entry !== null,
      familiarity: familiarity.get(famKey) ?? familiarity.get(t.key) ?? null,
    }
  })

  const surfaceOf = new Map(tokens.map((t) => [t.key, t.surface]))
  return selectHardWords(inputs, limit).map((s) => {
    const entry = byKey.get(s.key) ?? null
    return {
      word: entry?.word ?? s.key,
      surface: surfaceOf.get(s.key) ?? s.key,
      phonetic: entry?.phonetic ?? null,
      senses: parseTranslation(entry?.translation ?? null),
      tags: (entry?.tag ?? '').split(/\s+/).filter(Boolean),
    }
  })
}
```

- [ ] **Step 2: 实现接口**

创建 `src/app/api/hard-words/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { extractHardWords } from '@/lib/hardwords/extract'

const MAX_TEXT_LENGTH = 20_000

export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!text.trim()) {
    return NextResponse.json({ error: '缺少文本' }, { status: 400 })
  }

  const db = createAdminSupabase()
  const words = await extractHardWords(db, text.slice(0, MAX_TEXT_LENGTH), user.id)
  return NextResponse.json({ words })
}
```

注意：该接口**不消耗配额** —— 它不调用任何 LLM，纯数据库查询。

- [ ] **Step 3: 手动验证**

```bash
npm run dev
```

在浏览器已登录的标签页中，打开控制台运行：

```js
await (await fetch('/api/hard-words', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text:
    'The committee deferred the decision pending further review of the ' +
    'unprecedented anomalies discovered in the quarterly reconciliation.' }),
})).json()
```

逐项检查：
1. 返回 `words` 数组，长度 ≤ 12
2. 包含 `unprecedented`、`reconciliation`、`anomalies` 这类难词
3. **不**包含 `the`、`of`、`in` 这类停用词
4. `anomalies` 的 `word` 字段应是 `anomaly`（词形还原生效），`surface` 是 `anomalies`
5. 每个词都有 `senses`（除非确实不在词库中）
6. 数组顺序与原文出现顺序一致

- [ ] **Step 4: 验证个性化生效**

在 Supabase SQL Editor 中手动插一条已掌握的记录：

```sql
insert into wordbook (user_id, word, word_key, familiarity)
values ('<你的 user uuid>'::uuid, 'unprecedented', 'unprecedented', 5);
```

重新运行 Step 3 的请求。

预期：`unprecedented` **不再出现**在结果中。

清理：

```sql
delete from wordbook where word_key = 'unprecedented';
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/hardwords/extract.ts src/app/api/hard-words
git commit -m "feat: 难词提取服务与接口"
```

---

### Task 9: 流式翻译接口

**Files:**
- Create: `src/app/api/translate/route.ts`

**Interfaces:**
- Consumes: `createScheduler`（Task 5）、两个 Provider（Task 4）、`buildTranslatePrompt`（Task 1）、`consumeQuota`（Task 6）
- Produces: `POST /api/translate`，body `{ text: string; direction: Direction }`
  - 成功 → `200`，`Content-Type: text/event-stream`，响应头 `X-Provider: ollama | cloud`
  - 事件格式：`data: {"type":"delta","value":"..."}`，结束为 `data: {"type":"done"}`，中途出错为 `data: {"type":"error","value":"..."}`
  - `401` 未登录 / `400` 参数错误 / `429` 超配额 / `503` 所有后端不可用

- [ ] **Step 1: 实现路由**

创建 `src/app/api/translate/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { consumeQuota } from '@/lib/quota'
import { buildTranslatePrompt } from '@/lib/translate/prompt'
import { createOllamaProvider } from '@/lib/translate/ollama'
import { createCloudProvider } from '@/lib/translate/cloud'
import { createScheduler, type Scheduler } from '@/lib/translate/scheduler'
import type { Direction, TranslationProvider } from '@/lib/translate/types'

export const runtime = 'nodejs'

const MAX_TEXT_LENGTH = 20_000

/**
 * 模块级单例 —— 熔断状态需要跨请求保留。
 * 同一个 Vercel 函数实例内的请求共享它；实例之间不共享，可接受。
 */
let scheduler: Scheduler | null = null

function getScheduler(): Scheduler {
  if (scheduler) return scheduler
  const providers: TranslationProvider[] = []
  // 顺序即优先级：ollama 主用，云端兜底
  for (const make of [createOllamaProvider, createCloudProvider]) {
    try {
      providers.push(make())
    } catch (e) {
      console.warn('provider 未配置，跳过:', (e as Error).message)
    }
  }
  if (providers.length === 0) throw new Error('没有可用的翻译后端配置')
  scheduler = createScheduler(providers)
  return scheduler
}

export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    { text?: unknown; direction?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_TEXT_LENGTH) : ''
  const direction = body?.direction === 'zh2en' ? 'zh2en' : 'en2zh'
  if (!text.trim()) {
    return NextResponse.json({ error: '缺少文本' }, { status: 400 })
  }

  const db = createAdminSupabase()
  if (!(await consumeQuota(db, user.id))) {
    return NextResponse.json(
      { error: '已达今日翻译配额上限，明日 0 点重置。' },
      { status: 429 },
    )
  }

  let result
  try {
    result = await getScheduler().run(
      buildTranslatePrompt(text, direction as Direction),
    )
  } catch (e) {
    return NextResponse.json(
      { error: `翻译服务不可用：${(e as Error).message}` },
      { status: 503 },
    )
  }

  const encoder = new TextEncoder()
  const send = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of result.chunks) {
          controller.enqueue(send({ type: 'delta', value: delta }))
        }
        controller.enqueue(send({ type: 'done' }))
      } catch (e) {
        // 首字节之后的中断：把已产出的内容留给前端，并明确告知中断
        controller.enqueue(send({ type: 'error', value: (e as Error).message }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Provider': result.provider,
      // 禁止中间层缓冲，否则流式效果失效
      'X-Accel-Buffering': 'no',
    },
  })
}
```

- [ ] **Step 2: 验证流式与 provider 标记**

```bash
npm run dev
```

在已登录的浏览器标签页控制台运行：

```js
const res = await fetch('/api/translate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ direction: 'en2zh', text:
    'The committee deferred the decision pending further review.' }),
})
console.log('provider =', res.headers.get('X-Provider'))
const reader = res.body.getReader(), dec = new TextDecoder()
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  console.log(dec.decode(value))
}
```

逐项检查：
1. `X-Provider` 为 `ollama`
2. 输出**逐块打印**，而不是最后一次性全出
3. 最后一条是 `{"type":"done"}`

- [ ] **Step 3: 验证降级**

把家里的 frpc 或 ollama 停掉，重跑 Step 2。

预期：仍然返回译文，但 `X-Provider` 变为 `cloud`，且从发起到首字节的延迟不超过约 6 秒（5 秒首字节超时 + 云端首字节）。

再连续请求 3 次后第 4 次请求，观察服务端日志：第 4 次应当**直接走云端不再试探 ollama**（熔断生效）。

验证完毕后恢复 ollama 与 frpc。

- [ ] **Step 4: 验证配额**

临时把 `.env.local` 中的 `DAILY_QUOTA` 改为 `2`，重启 dev server，连续请求 3 次。

预期：第 3 次返回 `429`，body 含「已达今日翻译配额上限」。

清理并改回 200：

```sql
delete from usage_counter where user_id = '<你的 user uuid>'::uuid;
```

- [ ] **Step 5: 并发压力实测（spec 第 14 节的最后一项风险）**

这一项验证「家宽上行带宽与单机推理并发能力」。把 `DAILY_QUOTA` 临时调到 `1000`，然后在已登录的浏览器控制台运行：

```js
const text = 'The committee deferred the decision pending further review of the ' +
             'unprecedented anomalies discovered in the quarterly reconciliation.'

async function once(i) {
  const t0 = performance.now()
  const res = await fetch('/api/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, direction: 'en2zh' }),
  })
  const provider = res.headers.get('X-Provider')
  const reader = res.body.getReader()
  let firstByte = null
  for (;;) {
    const { done } = await reader.read()
    if (firstByte === null) firstByte = performance.now() - t0
    if (done) break
  }
  return { i, provider, firstByte: Math.round(firstByte), total: Math.round(performance.now() - t0) }
}

// 依次测 1 / 3 / 5 路并发
for (const n of [1, 3, 5]) {
  const rs = await Promise.all(Array.from({ length: n }, (_, i) => once(i)))
  const fb = rs.map((r) => r.firstByte)
  console.log(`并发 ${n}：首字节 ${Math.min(...fb)}–${Math.max(...fb)}ms，` +
              `provider = ${[...new Set(rs.map((r) => r.provider))].join('/')}`)
}
```

把三行输出记入 `docs/infra/hardening.md` 的「并发能力实测」一节。

**判定标准**：若 5 路并发下出现 `cloud`，说明本机推理排队已导致首字节超过 5 秒阈值，降级被触发。这不是 bug —— 降级正是为此设计的。但如果**并发 3 就开始降级**，说明本机模型对这个用量偏重，应考虑换更小的模型，或把 `firstByteTimeoutMs` 调大（代价是 ollama 真挂时用户要多等）。

测完把 `DAILY_QUOTA` 改回 `200` 并清理计数：

```sql
delete from usage_counter where user_id = '<你的 user uuid>'::uuid;
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/translate docs/infra/hardening.md
git commit -m "feat: 流式翻译接口，含降级与配额"
```

---

### Task 10: 上下文释义接口

**Files:**
- Create: `src/app/api/word/explain/route.ts`

**Interfaces:**
- Consumes: `buildExplainPrompt`（Task 1）、调度器（Task 5）、`consumeQuota`（Task 6）
- Produces: `POST /api/word/explain`，body `{ word: string; context: string }` → `{ explanation: string; provider: ProviderName }`

这个接口返回完整 JSON 而非流式 —— 回答只有一句话，流式没有意义，而且前端逻辑更简单。

- [ ] **Step 1: 抽出共享的调度器工厂**

Task 9 把 `getScheduler()` 写在了路由文件里，现在有第二个消费者，移到共享模块。

创建 `src/lib/translate/instance.ts`：

```ts
import { createOllamaProvider } from './ollama'
import { createCloudProvider } from './cloud'
import { createScheduler, type Scheduler } from './scheduler'
import type { TranslationProvider } from './types'

/**
 * 进程内单例 —— 熔断状态需要跨请求保留。
 * 同一个 Vercel 函数实例内共享；实例之间不共享，可接受。
 */
let instance: Scheduler | null = null

export function getScheduler(): Scheduler {
  if (instance) return instance
  const providers: TranslationProvider[] = []
  // 顺序即优先级：ollama 主用，云端兜底
  for (const make of [createOllamaProvider, createCloudProvider]) {
    try {
      providers.push(make())
    } catch (e) {
      console.warn('provider 未配置，跳过:', (e as Error).message)
    }
  }
  if (providers.length === 0) throw new Error('没有可用的翻译后端配置')
  instance = createScheduler(providers)
  return instance
}
```

修改 `src/app/api/translate/route.ts`：删除文件内的 `scheduler` 变量与 `getScheduler` 函数以及 `createOllamaProvider` / `createCloudProvider` / `createScheduler` / `TranslationProvider` 的 import，改为：

```ts
import { getScheduler } from '@/lib/translate/instance'
```

其余代码不变。

- [ ] **Step 2: 实现释义接口**

创建 `src/app/api/word/explain/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { consumeQuota } from '@/lib/quota'
import { buildExplainPrompt } from '@/lib/translate/prompt'
import { getScheduler } from '@/lib/translate/instance'

const MAX_CONTEXT_LENGTH = 2000

export async function POST(request: Request) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    { word?: unknown; context?: unknown } | null
  const word = typeof body?.word === 'string' ? body.word.trim() : ''
  const context = typeof body?.context === 'string'
    ? body.context.slice(0, MAX_CONTEXT_LENGTH) : ''
  if (!word || !context.trim()) {
    return NextResponse.json({ error: '缺少单词或上下文' }, { status: 400 })
  }

  const db = createAdminSupabase()
  if (!(await consumeQuota(db, user.id))) {
    return NextResponse.json(
      { error: '已达今日配额上限，明日 0 点重置。' },
      { status: 429 },
    )
  }

  try {
    const result = await getScheduler().run(buildExplainPrompt(word, context))
    let explanation = ''
    for await (const delta of result.chunks) explanation += delta
    return NextResponse.json({
      explanation: explanation.trim(),
      provider: result.provider,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `释义服务不可用：${(e as Error).message}` },
      { status: 503 },
    )
  }
}
```

- [ ] **Step 3: 手动验证**

在已登录的浏览器控制台运行：

```js
await (await fetch('/api/word/explain', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ word: 'bank', context: 'He sat by the bank of the river.' }),
})).json()
```

预期：`explanation` 说的是「河岸」而非「银行」，长度在一句话以内。

再试一次金融义：

```js
await (await fetch('/api/word/explain', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ word: 'bank', context: 'She deposited the check at the bank.' }),
})).json()
```

预期：这次说的是「银行」。两次结果不同即证明上下文确实生效。

- [ ] **Step 4: 运行完整测试套件**

```bash
npm test && npm run build
```

预期：全部通过，构建无错误。

- [ ] **Step 5: Commit**

```bash
git add src/lib/translate/instance.ts src/app/api/translate/route.ts src/app/api/word/explain
git commit -m "feat: 上下文释义接口，调度器提取为共享单例"
```

---

### Task 11: 段落模式前端

段落译文与难词拆解**并行发起**，互不阻塞 —— 难词卡片走纯数据库查询，通常比 LLM 译文先到。

**Files:**
- Create: `src/components/HardWordGrid.tsx`
- Create: `src/components/TranslateResult.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `POST /api/translate`（Task 9）、`POST /api/hard-words`（Task 8）、`POST /api/word/explain`（Task 10）、`GET /api/word/:word`（Plan 1 Task 12）、`<WordCard />`（Plan 1 Task 13）
- Produces: 完整可用的主页

- [ ] **Step 1: 实现难词卡片网格**

创建 `src/components/HardWordGrid.tsx`：

```tsx
'use client'

import { useState } from 'react'
import type { HardWord } from '@/lib/hardwords/extract'

function Card({ hw, context }: { hw: HardWord; context: string }) {
  const [open, setOpen] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    // 上下文释义按需触发：只有展开且尚未取过时才调 LLM
    if (!next || explanation !== null || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/word/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: hw.word, context }),
      })
      const data = await res.json()
      setExplanation(res.ok ? data.explanation : `（${data.error}）`)
    } catch {
      setExplanation('（释义获取失败）')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded border p-3">
      <button type="button" onClick={() => void toggle()} className="w-full text-left">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{hw.word}</span>
          {hw.phonetic && (
            <span className="font-mono text-xs text-neutral-500">{hw.phonetic}</span>
          )}
        </div>
        {hw.senses.length > 0 ? (
          <p className="mt-1 line-clamp-2 text-sm text-neutral-700">
            {hw.senses.map((s) => `${s.pos} ${s.meaning}`).join('；')}
          </p>
        ) : (
          <p className="mt-1 text-sm text-neutral-500">词典未收录</p>
        )}
      </button>

      {open && (
        <div className="mt-2 border-t pt-2 text-sm">
          {busy && <p className="text-neutral-500">正在分析在本句中的含义…</p>}
          {explanation && <p>{explanation}</p>}
        </div>
      )}
    </li>
  )
}

export function HardWordGrid({
  words, context,
}: { words: HardWord[]; context: string }) {
  if (words.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-neutral-600">
        难词（{words.length}）· 点击查看在本文中的含义
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {words.map((hw) => (
          <Card key={hw.word} hw={hw} context={context} />
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: 实现段落结果区**

创建 `src/components/TranslateResult.tsx`：

```tsx
'use client'

import { HardWordGrid } from './HardWordGrid'
import type { HardWord } from '@/lib/hardwords/extract'
import type { ProviderName } from '@/lib/translate/types'

export function TranslateResult({
  source, translation, provider, hardWords, streaming, error,
}: {
  source: string
  translation: string
  provider: ProviderName | null
  hardWords: HardWord[]
  streaming: boolean
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-medium text-neutral-600">译文</h3>
          {provider && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
              {provider}
            </span>
          )}
          {streaming && <span className="text-xs text-neutral-400">生成中…</span>}
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{translation}</p>
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
      </section>

      <HardWordGrid words={hardWords} context={source} />
    </div>
  )
}
```

- [ ] **Step 3: 改造主页**

替换 `src/app/page.tsx` 的全部内容：

```tsx
'use client'

import { useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from '@/components/WordCard'
import { TranslateResult } from '@/components/TranslateResult'
import type { WordDetail } from '@/lib/dict/types'
import type { HardWord } from '@/lib/hardwords/extract'
import type { Direction, ProviderName } from '@/lib/translate/types'

export default function HomePage() {
  const [input, setInput] = useState('')
  const [direction, setDirection] = useState<Direction>('en2zh')
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [translation, setTranslation] = useState('')
  const [provider, setProvider] = useState<ProviderName | null>(null)
  const [hardWords, setHardWords] = useState<HardWord[]>([])
  const [source, setSource] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setDetail(null); setTranslation(''); setProvider(null)
    setHardWords([]); setError(null)
  }

  async function submit() {
    const text = input.trim()
    if (!text || busy) return
    reset()
    setBusy(true)
    try {
      if (isSingleWord(text) && direction === 'en2zh') {
        await lookupSingleWord(text)
      } else {
        await translateText(text)
      }
    } finally {
      setBusy(false)
      setStreaming(false)
    }
  }

  async function lookupSingleWord(text: string) {
    const res = await fetch(`/api/word/${encodeURIComponent(text)}`)
    if (!res.ok) {
      setError(res.status === 401 ? '登录已过期，请重新登录。' : '查询失败，请重试。')
      return
    }
    setDetail((await res.json()) as WordDetail)
  }

  async function translateText(text: string) {
    setSource(text)
    setStreaming(true)

    // 难词拆解与译文并行发起 —— 前者走数据库，通常先到。
    // 中译英不拆难词：难词拆解只对英文源文本有意义。
    const hardWordsPromise = direction === 'zh2en'
      ? Promise.resolve()
      : fetch('/api/hard-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
          .then((r) => (r.ok ? r.json() : { words: [] }))
          .then((d: { words: HardWord[] }) => setHardWords(d.words))
          .catch(() => setHardWords([]))

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, direction }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: '翻译失败' }))
        setError(data.error ?? '翻译失败')
        return
      }
      setProvider(res.headers.get('X-Provider') as ProviderName | null)

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
          const evt = JSON.parse(line.slice(5).trim()) as
            { type: string; value?: string }
          if (evt.type === 'delta') setTranslation((t) => t + (evt.value ?? ''))
          else if (evt.type === 'error') setError(`响应中断：${evt.value}`)
        }
      }
    } catch {
      setError('网络错误，已保留部分译文。')
    } finally {
      setStreaming(false)
      await hardWordsPromise
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">翻译 · 单词本</h1>
        <button
          type="button"
          onClick={() => setDirection(direction === 'en2zh' ? 'zh2en' : 'en2zh')}
          className="rounded border px-3 py-1 text-sm"
        >
          {direction === 'en2zh' ? '英 → 中' : '中 → 英'}  ⇄
        </button>
      </header>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        rows={5}
        placeholder="输入单词或段落…"
        className="w-full rounded border p-3"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="self-end rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? '处理中…' : '翻译  ⌘↵'}
      </button>

      {error && !translation && <p className="text-sm text-red-600">{error}</p>}
      {detail && <WordCard detail={detail} />}
      {(translation || hardWords.length > 0) && (
        <TranslateResult
          source={source}
          translation={translation}
          provider={provider}
          hardWords={hardWords}
          streaming={streaming}
          error={error}
        />
      )}
    </main>
  )
}
```

- [ ] **Step 4: 手动验证**

```bash
npm run dev
```

逐项检查：

1. 输入 `apple` → 显示单词卡片（与 Plan 1 一致）
2. 输入一段英文（例如 `The committee deferred the decision pending further review of the unprecedented anomalies discovered in the quarterly reconciliation.`）→
   - 译文**逐字出现**
   - 难词卡片**先于或与译文同时**出现
   - 角落显示 `ollama` 标记
3. 点击某个难词卡片 → 展开，显示「正在分析在本句中的含义…」，随后出现一句话释义
4. 再次点击同一卡片折叠，再展开 → **不重复请求**（释义已缓存在组件状态里）
5. 切到「中 → 英」，输入中文段落 → 正常翻译，且**不显示难词卡片**，Network 面板中也**没有** `/api/hard-words` 请求

- [ ] **Step 5: 构建与测试**

```bash
npm test && npm run build
```

预期：全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/HardWordGrid.tsx src/components/TranslateResult.tsx src/app/page.tsx
git commit -m "feat: 段落翻译界面与难词卡片"
```

---

### Task 12: 划词浮层

在原文或译文区域选中单个英文单词时弹出词详情。

**Files:**
- Create: `src/components/SelectionPopover.tsx`
- Modify: `src/components/TranslateResult.tsx`

**Interfaces:**
- Consumes: `isSingleWord`（Plan 1 Task 2）、`GET /api/word/:word`（Plan 1 Task 12）、`<WordCard />`（Plan 1 Task 13）
- Produces: `<SelectionPopover />` —— 包裹任意内容，监听其中的文本选择

- [ ] **Step 1: 实现浮层组件**

创建 `src/components/SelectionPopover.tsx`：

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from './WordCard'
import type { WordDetail } from '@/lib/dict/types'

export function SelectionPopover({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onMouseUp() {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''

      // 只对「选区落在本组件内」且「是单个英文词」的情况响应
      if (!text || !isSingleWord(text) || !sel?.rangeCount) return
      const range = sel.getRangeAt(0)
      if (!hostRef.current?.contains(range.commonAncestorContainer)) return

      const rect = range.getBoundingClientRect()
      setPos({ x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 6 })
      setDetail(null)
      setBusy(true)

      void fetch(`/api/word/${encodeURIComponent(text)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: WordDetail | null) => setDetail(d))
        .catch(() => setDetail(null))
        .finally(() => setBusy(false))
    }

    function onMouseDown(e: MouseEvent) {
      // 点在浮层外面就关闭
      const target = e.target as HTMLElement
      if (!target.closest('[data-selection-popover]')) setPos(null)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [])

  return (
    <div ref={hostRef} className="relative">
      {children}
      {pos && (
        <div
          data-selection-popover
          style={{ position: 'absolute', left: pos.x, top: pos.y }}
          className="z-50 w-80 rounded-lg border bg-white shadow-lg"
        >
          {busy && <p className="p-4 text-sm text-neutral-500">查询中…</p>}
          {!busy && detail && <WordCard detail={detail} />}
          {!busy && !detail && (
            <p className="p-4 text-sm text-neutral-500">查询失败</p>
          )}
        </div>
      )}
    </div>
  )
}
```

⚠️ 浮层用 `position: absolute` 定位在 `hostRef` 这个 `relative` 容器内，但坐标算的是页面坐标（含 `scrollX/Y`）。若发现浮层位置有偏移，把容器的 `relative` 去掉并改用 `position: fixed` + 不加 `scrollX/Y` 的视口坐标。

- [ ] **Step 2: 在结果区启用划词**

修改 `src/components/TranslateResult.tsx`，把原文与译文一起包进浮层。在文件顶部加入 import：

```tsx
import { SelectionPopover } from './SelectionPopover'
```

然后把 `return` 中最外层 `<div className="flex flex-col gap-5">` 的**整个内容**用 `<SelectionPopover>` 包裹，并在译文段落上方加入原文展示：

```tsx
  return (
    <SelectionPopover>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-sm font-medium text-neutral-600">原文</h3>
          <p className="whitespace-pre-wrap leading-relaxed text-neutral-700">{source}</p>
        </section>

        <section>
          {/* ...原有的译文 section 内容保持不变... */}
        </section>

        <HardWordGrid words={hardWords} context={source} />
      </div>
    </SelectionPopover>
  )
```

- [ ] **Step 3: 手动验证**

```bash
npm run dev
```

逐项检查：

1. 翻译一段英文后，在**原文**区域双击选中某个单词 → 弹出词卡，含音标与释义
2. 在**译文**区域选中中文 → **不弹**（`isSingleWord` 对中文返回 false）
3. 选中多个词（如 `the committee`）→ **不弹**
4. 点击浮层外任意处 → 浮层关闭
5. 点击浮层内部（例如 🔊 按钮）→ 浮层**不关闭**，且能播放发音
6. 页面滚动后再选词 → 浮层出现在选中词的正下方，位置正确

若第 6 点位置不对，按 Step 1 末尾的说明改用 `position: fixed`。

- [ ] **Step 4: 构建与测试**

```bash
npm test && npm run build
```

预期：全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/SelectionPopover.tsx src/components/TranslateResult.tsx
git commit -m "feat: 划词查询浮层"
```

---

## Plan 2 完成标准

- [ ] `npm test` 全部通过（新增约 66 个测试）
- [ ] `npm run build` 无错误
- [ ] 单词模式：输入 `apple` 显示完整词卡
- [ ] 段落模式：译文流式逐字出现，难词卡片并行且通常先到
- [ ] 难词卡片点击展开显示上下文释义，重复展开不重复请求
- [ ] 中译英正常工作且不显示难词卡片
- [ ] 划词在原文区弹出词卡，选中中文或多词不弹
- [ ] 停掉 ollama 后仍能翻译，`X-Provider` 变为 `cloud`
- [ ] 连续失败 3 次后熔断，第 4 次直接走云端
- [ ] 超出配额返回 429 且提示明确
- [ ] **段落模式的 LLM 调用次数为 1**（在 Network 面板确认：只有一个 `/api/translate` 请求，无额外 LLM 调用，除非手动展开难词）

## 移交给 Plan 3 的产物

| 产物 | 位置 |
|---|---|
| 完整单词详情 | `GET /api/word/:word` → `WordDetail` |
| 难词提取 | `extractHardWords()`、`HardWord` 类型 |
| 单词卡片组件 | `<WordCard />` |
| 划词浮层 | `<SelectionPopover />` |
| 配额检查 | `consumeQuota()` |
| 调度器单例 | `getScheduler()` |
| 空的 `wordbook` 表与 RLS | Plan 3 实现写入 |

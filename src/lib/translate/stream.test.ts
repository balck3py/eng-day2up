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

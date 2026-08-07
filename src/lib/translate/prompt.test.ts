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

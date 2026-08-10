import { describe, it, expect } from 'vitest'
import { parseAiSenses, isAiFallbackEligible, parseAiEntry } from './ai-entry'

describe('parseAiSenses', () => {
  it('解析正常 JSON', () => {
    expect(parseAiSenses('{"senses":[{"pos":"n.","meaning":"本体论"}]}')).toEqual([
      { pos: 'n.', meaning: '本体论' },
    ])
  })

  it('剥离 ```json 围栏', () => {
    const raw = '```json\n{"senses":[{"pos":"adj.","meaning":"空前的"}]}\n```'
    expect(parseAiSenses(raw)).toEqual([{ pos: 'adj.', meaning: '空前的' }])
  })

  it('剥离无语言标记的 ``` 围栏', () => {
    const raw = '```\n{"senses":[{"pos":"","meaning":"测试"}]}\n```'
    expect(parseAiSenses(raw)).toEqual([{ pos: '', meaning: '测试' }])
  })

  it('容忍 JSON 前后的解释性文字', () => {
    const raw = '好的，这是结果：{"senses":[{"pos":"v.","meaning":"运行"}]} 希望有用'
    expect(parseAiSenses(raw)).toEqual([{ pos: 'v.', meaning: '运行' }])
  })

  it('非法 JSON 返回 null', () => {
    expect(parseAiSenses('{senses: not json}')).toBeNull()
  })

  it('结构不符（senses 不是数组）返回 null', () => {
    expect(parseAiSenses('{"senses":"nope"}')).toBeNull()
  })

  it('meaning 缺失返回 null', () => {
    expect(parseAiSenses('{"senses":[{"pos":"n."}]}')).toBeNull()
  })

  it('空 senses 返回空数组（合法：不是有效英文词）', () => {
    expect(parseAiSenses('{"senses":[]}')).toEqual([])
  })

  it('缺少 pos 时补空串', () => {
    expect(parseAiSenses('{"senses":[{"meaning":"某义"}]}')).toEqual([
      { pos: '', meaning: '某义' },
    ])
  })

  it('跳过空 meaning 但保留合法结构', () => {
    const raw = '{"senses":[{"pos":"n.","meaning":"  "},{"pos":"v.","meaning":"做"}]}'
    expect(parseAiSenses(raw)).toEqual([{ pos: 'v.', meaning: '做' }])
  })

  it('空字符串返回 null', () => {
    expect(parseAiSenses('')).toBeNull()
  })
})

describe('parseAiEntry', () => {
  it('提取 word / phonetic / senses', () => {
    const raw =
      '{"word":"immunotherapy","phonetic":"/ˌɪmjənoʊˈθerəpi/","senses":[{"pos":"n.","meaning":"免疫疗法"}]}'
    expect(parseAiEntry(raw, 'immunotherpy')).toEqual({
      word: 'immunotherapy',
      phonetic: '/ˌɪmjənoʊˈθerəpi/',
      senses: [{ pos: 'n.', meaning: '免疫疗法' }],
    })
  })

  it('word 缺失/不合法时回落到 fallbackKey', () => {
    const raw = '{"senses":[{"pos":"n.","meaning":"工作流"}]}'
    expect(parseAiEntry(raw, 'work-flow')).toEqual({
      word: 'work-flow',
      phonetic: null,
      senses: [{ pos: 'n.', meaning: '工作流' }],
    })
  })

  it('phonetic 为空串时归一为 null', () => {
    const raw = '{"word":"workflow","phonetic":"","senses":[{"pos":"n.","meaning":"工作流"}]}'
    expect(parseAiEntry(raw, 'workflow')?.phonetic).toBeNull()
  })

  it('对 word 做 normalize（去首尾非字母 + 小写）', () => {
    const raw = '{"word":"Receive.","phonetic":"/rɪˈsiːv/","senses":[{"pos":"vt.","meaning":"收到"}]}'
    expect(parseAiEntry(raw, 'recieve')?.word).toBe('receive')
  })

  it('乱码：空 senses 时返回 word=fallback、senses=[]（由调用方据长度降级）', () => {
    const raw = '{"word":"","phonetic":"","senses":[]}'
    expect(parseAiEntry(raw, 'zzzz')).toEqual({ word: 'zzzz', phonetic: null, senses: [] })
  })

  it('非法 JSON 返回 null', () => {
    expect(parseAiEntry('not json at all', 'x')).toBeNull()
  })
})

describe('isAiFallbackEligible', () => {
  it('放行普通英文单词', () => {
    expect(isAiFallbackEligible('ontology')).toBe(true)
    expect(isAiFallbackEligible('enshittification')).toBe(true)
  })

  it('放行含撇号/连字符的词', () => {
    expect(isAiFallbackEligible("don't")).toBe(true)
    expect(isAiFallbackEligible('e-mail')).toBe(true)
  })

  it('挡住超长输入', () => {
    expect(isAiFallbackEligible('a'.repeat(33))).toBe(false)
  })

  it('挡住空字符串', () => {
    expect(isAiFallbackEligible('')).toBe(false)
  })

  it('挡住纯数字与乱码', () => {
    expect(isAiFallbackEligible('12345')).toBe(false)
    expect(isAiFallbackEligible('1abc')).toBe(false)
  })

  it('挡住首字符非字母', () => {
    expect(isAiFallbackEligible("'tis")).toBe(false)
  })
})

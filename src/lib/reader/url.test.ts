import { describe, expect, it } from 'vitest'
import { resolveAgainst, toFetchUrl } from './url'

describe('toFetchUrl', () => {
  it('GitHub blob 链接转成 raw', () => {
    expect(toFetchUrl('https://github.com/vercel/next.js/blob/canary/README.md')).toBe(
      'https://raw.githubusercontent.com/vercel/next.js/canary/README.md',
    )
  })

  it('其他 http(s) 链接原样返回（去掉首尾空白）', () => {
    expect(toFetchUrl('  https://example.com/a.md ')).toBe('https://example.com/a.md')
  })

  it('缺协议时补 https', () => {
    expect(toFetchUrl('example.com/a.md')).toBe('https://example.com/a.md')
  })

  it('非 http(s) 协议拒绝', () => {
    expect(toFetchUrl('file:///etc/passwd')).toBeNull()
    expect(toFetchUrl('javascript:alert(1)')).toBeNull()
    expect(toFetchUrl('')).toBeNull()
  })
})

describe('resolveAgainst', () => {
  const base = 'https://raw.githubusercontent.com/o/r/main/docs/guide.md'

  it('相对路径按文档地址补全', () => {
    expect(resolveAgainst('img/a.png', base)).toBe(
      'https://raw.githubusercontent.com/o/r/main/docs/img/a.png',
    )
    expect(resolveAgainst('../x.md', base)).toBe('https://raw.githubusercontent.com/o/r/main/x.md')
  })

  it('绝对地址与锚点保持不变', () => {
    expect(resolveAgainst('https://a.com/b', base)).toBe('https://a.com/b')
    expect(resolveAgainst('#section', base)).toBe('#section')
  })

  it('危险协议丢弃', () => {
    expect(resolveAgainst('javascript:alert(1)', base)).toBe('')
  })
})

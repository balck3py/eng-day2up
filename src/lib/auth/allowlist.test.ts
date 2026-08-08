import { describe, it, expect } from 'vitest'
import { parseAllowlist, isEmailAllowed } from './allowlist'

describe('parseAllowlist', () => {
  it('正常多条', () => {
    expect(parseAllowlist('a@x.com,b@y.com')).toEqual(new Set(['a@x.com', 'b@y.com']))
  })
  it('单条', () => {
    expect(parseAllowlist('a@x.com')).toEqual(new Set(['a@x.com']))
  })
  it('大小写混合，统一转小写', () => {
    expect(parseAllowlist('Foo@Bar.COM')).toEqual(new Set(['foo@bar.com']))
  })
  it('条目带空格，被 trim', () => {
    expect(parseAllowlist(' a@x.com , b@y.com ')).toEqual(new Set(['a@x.com', 'b@y.com']))
  })
  it('空条目被过滤', () => {
    expect(parseAllowlist('a@x.com, ,b@y.com')).toEqual(new Set(['a@x.com', 'b@y.com']))
  })
  it('未配置（undefined）返回 null', () => {
    expect(parseAllowlist(undefined)).toBeNull()
  })
  it('空字符串返回 null', () => {
    expect(parseAllowlist('')).toBeNull()
  })
  it('全是空白也返回 null', () => {
    expect(parseAllowlist('   ')).toBeNull()
  })
})

describe('isEmailAllowed', () => {
  it('allowlist 为 null 时一律允许', () => {
    expect(isEmailAllowed('anyone@example.com', null)).toBe(true)
  })
  it('email 为 null 时，allowlist 非 null 则拒绝', () => {
    expect(isEmailAllowed(null, new Set(['a@x.com']))).toBe(false)
  })
  it('email 为 undefined 时，allowlist 非 null 则拒绝', () => {
    expect(isEmailAllowed(undefined, new Set(['a@x.com']))).toBe(false)
  })
  it('email 大小写不同仍匹配', () => {
    expect(isEmailAllowed('A@X.com', new Set(['a@x.com']))).toBe(true)
  })
  it('不在名单内则拒绝', () => {
    expect(isEmailAllowed('c@z.com', new Set(['a@x.com', 'b@y.com']))).toBe(false)
  })
  it('在名单内则允许', () => {
    expect(isEmailAllowed('b@y.com', new Set(['a@x.com', 'b@y.com']))).toBe(true)
  })
})

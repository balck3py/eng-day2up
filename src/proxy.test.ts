import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// 整个 @supabase/ssr 都 mock 掉：proxy.ts 只从它拿两样东西——getUser() 的
// 结果，以及 signOut() 触发 cookies.setAll() 写清除型 cookie 的副作用。
// 后者是真实库内部 removeItem() 的行为（见 allowlist 任务报告里对
// node_modules/@supabase/ssr/dist/main/cookies.js 的读码结论：removeItem
// 会以 maxAge: 0 调用 setAll），这里用同样的形状模拟，这样才能验证
// proxy.ts 自己那段「把 response 上的清除 cookie 搬到最终返回对象上」的
// carryCookies 逻辑是否真的生效。
const { getUserMock, signOutMock, createServerClientMock } = vi.hoisted(() => {
  const getUserMock = vi.fn()
  const signOutMock = vi.fn()
  const createServerClientMock = vi.fn()
  return { getUserMock, signOutMock, createServerClientMock }
})

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}))

import { proxy } from './proxy'

const ORIGINAL_ALLOWED_EMAILS = process.env.ALLOWED_EMAILS

function makeRequest(url: string) {
  return new NextRequest(new Request(url))
}

beforeEach(() => {
  getUserMock.mockReset()
  signOutMock.mockReset()
  createServerClientMock.mockReset()
  process.env.ALLOWED_EMAILS = 'allowed@x.com'

  createServerClientMock.mockImplementation((_url: string, _key: string, options: {
    cookies: { setAll: (list: unknown[]) => void }
  }) => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock.mockImplementation(async () => {
        options.cookies.setAll([
          { name: 'sb-test-auth-token', value: '', options: { maxAge: 0, path: '/' } },
        ])
        return { error: null }
      }),
    },
  }))
})

afterEach(() => {
  process.env.ALLOWED_EMAILS = ORIGINAL_ALLOWED_EMAILS
})

describe('proxy：白名单放行', () => {
  it('白名单内邮箱正常放行，不触发 signOut', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'allowed@x.com' } } })
    const res = await proxy(makeRequest('http://localhost/api/word/apple'))
    // NextResponse.next() 会打上 x-middleware-next 标记，用它区分「放行」
    // 和「其实是个 200 的 JSON 响应」，比裸看 status 更准确。
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(signOutMock).not.toHaveBeenCalled()
  })
})

describe('proxy：白名单外用户被拒', () => {
  it('/api/* 返回 403，且响应带清除型 cookie', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'outsider@x.com' } } })
    const res = await proxy(makeRequest('http://localhost/api/word/apple'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: '该账号未获授权使用本站' })
    expect(signOutMock).toHaveBeenCalledTimes(1)

    const cookie = res.cookies.get('sb-test-auth-token')
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
  })

  it('页面路径重定向到 /login?denied=1，且响应带清除型 cookie', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'outsider@x.com' } } })
    const res = await proxy(makeRequest('http://localhost/'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login?denied=1')
    expect(signOutMock).toHaveBeenCalledTimes(1)

    const cookie = res.cookies.get('sb-test-auth-token')
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
  })
})

describe('proxy：未登录（无 user）', () => {
  it('/api/* 返回 401，不调用 signOut（没有会话可清）', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await proxy(makeRequest('http://localhost/api/word/apple'))
    expect(res.status).toBe(401)
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('页面路径重定向到 /login（不带 denied=1）', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await proxy(makeRequest('http://localhost/'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login')
  })
})

describe('proxy：PUBLIC_API_PATHS 精确匹配 /api/auth/signup', () => {
  // 用未登录状态做探针：命中 PUBLIC_API_PATHS 应该直接放行（x-middleware-next），
  // 没命中则应该 401——用这个差异反推路径匹配是不是精确匹配而非前缀匹配。
  // 这是历史上真实出过 bug 的地方（前缀匹配导致的鉴权绕过），必须锁住。
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: null } })
  })

  it('/api/auth/signup 本身放行', async () => {
    const res = await proxy(makeRequest('http://localhost/api/auth/signup'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('/api/auth/signupfoo 不放行（不是前缀匹配）', async () => {
    const res = await proxy(makeRequest('http://localhost/api/auth/signupfoo'))
    expect(res.status).toBe(401)
  })

  it('/api/word/apple 不放行', async () => {
    const res = await proxy(makeRequest('http://localhost/api/word/apple'))
    expect(res.status).toBe(401)
  })

  it('带尾部斜杠的 /api/auth/signup/ 不放行', async () => {
    const res = await proxy(makeRequest('http://localhost/api/auth/signup/'))
    expect(res.status).toBe(401)
  })
})

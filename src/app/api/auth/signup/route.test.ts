import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { createUserMock, createAdminMock } = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  createAdminMock: vi.fn(() => ({ auth: { admin: { createUser: createUserMock } } })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: createAdminMock,
}))

import { POST } from './route'

function req(body: unknown) {
  return new Request('http://x/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const ORIGINAL_ENV = process.env.ALLOWED_EMAILS

beforeEach(() => {
  createUserMock.mockReset()
  createAdminMock.mockClear()
  process.env.ALLOWED_EMAILS = 'a@x.com, b@y.com'
})

afterEach(() => {
  process.env.ALLOWED_EMAILS = ORIGINAL_ENV
})

describe('POST /api/auth/signup', () => {
  it('400 当 email 缺失', async () => {
    const res = await POST(req({ password: '123456' }))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('400 当 email 格式不正确', async () => {
    const res = await POST(req({ email: 'not-an-email', password: '123456' }))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('400 当密码短于 6 位', async () => {
    const res = await POST(req({ email: 'a@x.com', password: '123' }))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('403 当邮箱不在白名单，且不调用 createUser', async () => {
    const res = await POST(req({ email: 'evil@z.com', password: '123456' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('该邮箱未获授权，请联系管理员开通。')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('200 当邮箱在白名单，成功创建（email_confirm: true）', async () => {
    createUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null })
    const res = await POST(req({ email: 'A@X.com', password: '123456' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(createUserMock).toHaveBeenCalledWith({
      email: 'a@x.com',
      password: '123456',
      email_confirm: true,
    })
  })

  it('409 当邮箱已注册（code: email_exists），只透出「已注册去登录」', async () => {
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered', status: 422, code: 'email_exists' },
    })
    const res = await POST(req({ email: 'a@x.com', password: '123456' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('该邮箱已注册，请直接登录。')
  })

  it('422 但 code 不是 email_exists 时，不当成「已注册」，走通用错误分支', async () => {
    // 比如后台配置了更严格的密码策略导致的校验失败，也是 422，但不该被
    // 误判成「邮箱已注册」——那会把用户导向错误的下一步（去登录，而不是
    // 换个密码重试）。
    createUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Password is too weak', status: 422, code: 'weak_password' },
    })
    const res = await POST(req({ email: 'a@x.com', password: '123456' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('注册失败，请稍后重试。')
  })

  it('未配置 ALLOWED_EMAILS（undefined）时 fail closed：503，且不调用 createUser', async () => {
    delete process.env.ALLOWED_EMAILS
    const res = await POST(req({ email: 'anyone@z.com', password: '123456' }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('注册功能未配置，请联系管理员。')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('ALLOWED_EMAILS 为空字符串时同样 fail closed：503，且不调用 createUser', async () => {
    process.env.ALLOWED_EMAILS = ''
    const res = await POST(req({ email: 'anyone@z.com', password: '123456' }))
    expect(res.status).toBe(503)
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

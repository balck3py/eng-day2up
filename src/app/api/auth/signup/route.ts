import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { parseAllowlist, isEmailAllowed } from '@/lib/auth/allowlist'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 服务端注册路由。取代客户端直连 Supabase 的 signUp —— 这样才能在
 * 白名单校验后用 service_role 创建用户，而不是让任何人绕过前端直接
 * 打 Supabase 的 /auth/v1/signup。
 *
 * 必须在 src/proxy.ts 的 PUBLIC_API_PATHS 里精确放行（不能是前缀放行整个
 * /api/*），否则未登录用户访问不到这个路由。
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: '邮箱和密码为必填项' }, { status: 400 })
  }

  // 邮箱大小写不敏感（见 allowlist 的判定逻辑），统一转小写后再做后续所有
  // 校验与建号，避免同一邮箱因大小写不同被判定成两个账号。
  const trimmedEmail = email.trim().toLowerCase()
  if (!EMAIL_RE.test(trimmedEmail)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
  }
  // 与登录页密码输入框的 minLength={6} 保持一致
  if (password.length < 6) {
    return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 })
  }

  const allowlist = parseAllowlist(process.env.ALLOWED_EMAILS)
  if (!isEmailAllowed(trimmedEmail, allowlist)) {
    return NextResponse.json(
      { error: '该邮箱未获授权，请联系管理员开通。' },
      { status: 403 },
    )
  }

  const admin = createAdminSupabase()
  const { error } = await admin.auth.admin.createUser({
    email: trimmedEmail,
    password,
    // 白名单本身已经是授权凭据，不需要再走邮箱验证；且当前 Supabase 项目
    // 开着邮箱确认，不带这个参数的话用户注册完根本登不进去。
    email_confirm: true,
  })

  if (error) {
    // Supabase 对重复邮箱的错误码是 email_exists（HTTP 422）。只把「已注册，
    // 去登录」这一件事告诉用户，不透出其他内部错误信息。
    if (error.code === 'email_exists' || error.status === 422) {
      return NextResponse.json(
        { error: '该邮箱已注册，请直接登录。' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: '注册失败，请稍后重试。' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

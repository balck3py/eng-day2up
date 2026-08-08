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
  // 故意跟 src/proxy.ts 不对称：那边未配置 ALLOWED_EMAILS 时是「不限制」
  // （fail open），因为那是已经在跑的应用的兜底，漏配一次不该把所有人锁
  // 在门外。这条路由不同——它是用 service_role 建号、不要求验证邮箱所有权
  // 的端点，一旦意外 fail open 就等于给了任何人一个「无限速、自动确认
  // 邮箱」的开户接口，比它取代的客户端 signUp（好歹要求收到验证邮件）还
  // 危险。所以这里反过来：未配置白名单 = 全部拒绝，而不是不限制。
  // 不要为了「统一」两边的行为把这条改成 fail open——那会重新打开这个洞。
  if (allowlist === null) {
    return NextResponse.json(
      { error: '注册功能未配置，请联系管理员。' },
      { status: 503 },
    )
  }
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
    // 只认 email_exists 这个明确的错误码。之前还兜底判断 status === 422，
    // 但 422 也会被其他校验失败复用（比如后台配置了更严格的密码策略），
    // 那种情况下告诉用户「已注册，去登录」是错的、会误导人——应该走下面
    // 的通用错误分支。
    if (error.code === 'email_exists') {
      return NextResponse.json(
        { error: '该邮箱已注册，请直接登录。' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: '注册失败，请稍后重试。' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

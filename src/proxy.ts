import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { parseAllowlist, isEmailAllowed } from '@/lib/auth/allowlist'

const PUBLIC_PATHS = ['/login', '/auth']
// 精确匹配（不是前缀），避免改动时不小心放开整个 /api/*
const PUBLIC_API_PATHS = ['/api/auth/signup']

/** 把 response（signOut 后已带清除型 Set-Cookie）上的所有 cookie 复制到 target 上。 */
function carryCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie))
  return to
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic =
    PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/')) ||
    PUBLIC_API_PATHS.includes(path)

  if (isPublic) {
    return response
  }

  const isApi = path.startsWith('/api/')

  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 未配置 ALLOWED_EMAILS 时 parseAllowlist 返回 null，isEmailAllowed 对 null
  // 一律放行——这里是故意 fail open：这是已经在跑的应用的会话层兜底，某次
  // 部署漏配这个变量不该把所有人（包括管理员自己）锁在门外。
  // src/app/api/auth/signup/route.ts 故意反过来 fail closed（未配置 = 拒绝
  // 一切注册），因为那条路由是用 service_role 建号、不验证邮箱所有权的端点，
  // fail open 在那边等于开了个无限速自动开户口子。两边不对称是有意为之，
  // 改的时候不要为了「统一」把其中一边掰成另一边的样子。
  const allowlist = parseAllowlist(process.env.ALLOWED_EMAILS)
  if (!isEmailAllowed(user.email, allowlist)) {
    // 邮箱不在白名单：视同未登录，且必须清掉会话 cookie，否则会陷入
    // 「登录成功 → 被踢回登录页 → 还带着旧 cookie → 再被踢」的死循环。
    // signOut() 会通过上面的 setAll 闭包重建 response 并写入清除型 cookie，
    // 但下面无论走 JSON 还是 redirect 分支都会创建全新的 NextResponse 实例，
    // 所以要显式把 response 上已经清除的 cookie 搬到最终返回的对象上。
    await supabase.auth.signOut()
    if (isApi) {
      return carryCookies(
        response,
        NextResponse.json({ error: '该账号未获授权使用本站' }, { status: 403 }),
      )
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('denied', '1')
    return carryCookies(response, NextResponse.redirect(url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|mp3)$).*)'],
}

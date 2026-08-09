'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'

const LINKS = [
  { href: '/', label: '翻译' },
  { href: '/wordbook', label: '单词本' },
]

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()

  // 登录页没有会话，也不该出现导航
  if (pathname.startsWith('/login')) return null

  async function signOut() {
    await createBrowserSupabase().auth.signOut()
    // 整页跳转，和登录页保持一致：让 cookie 与会话拦截彻底刷新
    window.location.href = '/login'
  }

  return (
    <nav className="border-b border-rule bg-card">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-5 px-5 py-3 sm:px-6">
        <span className="font-semibold tracking-[-0.01em] text-ink">译</span>
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'text-sm font-medium text-ink'
                  : 'text-sm text-ink-2 transition-colors hover:text-ink'
              }
            >
              {l.label}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-auto text-sm text-ink-3 transition-colors hover:text-ink"
        >
          登出
        </button>
      </div>
    </nav>
  )
}

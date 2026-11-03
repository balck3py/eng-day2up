'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { clearDeviceConfig } from '@/lib/translate/deviceTranslation'

const LINKS = [
  { href: '/', label: '翻译' },
  { href: '/history', label: '历史' },
  { href: '/wordbook', label: '单词本' },
  { href: '/podcast', label: '播客' },
  { href: '/reader', label: '加载第三方网站' },
  { href: '/settings', label: '设置' },
]

export function NavBar() {
  const pathname = usePathname()

  // 登录页没有会话，也不该出现导航
  if (pathname.startsWith('/login')) return null

  async function signOut() {
    clearDeviceConfig()
    await createBrowserSupabase().auth.signOut()
    // 整页跳转，和登录页保持一致：让 cookie 与会话拦截彻底刷新
    window.location.href = '/login'
  }

  return (
    <nav className="border-b border-rule bg-card">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-x-3 sm:gap-x-5 px-5 py-3 sm:px-6">
        {/* 窄屏放不下全部入口，品牌字先让位 */}
        <span className="hidden font-semibold tracking-[-0.01em] text-ink sm:inline">译</span>
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap py-1 sm:gap-5">
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
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-auto shrink-0 text-sm text-ink-3 transition-colors hover:text-ink"
        >
          登出
        </button>
      </div>
    </nav>
  )
}

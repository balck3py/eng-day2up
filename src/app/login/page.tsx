'use client'

import { useState, useSyncExternalStore } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'

// 不用 useSearchParams：它要求外层套 <Suspense>，否则会在 `next build`
// 静态生成阶段直接报错（missing-suspense-with-csr-bailout）。用
// useSyncExternalStore 直接读 window.location 更简单：它内置了
// server/client 快照不一致时的正确处理（先渲染 getServerSnapshot 的
// false，hydrate 完成后再同步成真实值），比在 effect 里 setState
// 更符合 react-hooks/set-state-in-effect 规则，也不会有 hydration 警告。
const noopSubscribe = () => () => {}
function getDeniedSnapshot() {
  return new URLSearchParams(window.location.search).get('denied') === '1'
}
function getDeniedServerSnapshot() {
  return false
}

export default function LoginPage() {
  // 配合下面登录成功后改用整页跳转（而不是 router.push）：每次落到这个
  // 页面都是一次全新的 mount/hydrate，这个 snapshot 读取才靠得住。
  const denied = useSyncExternalStore(noopSubscribe, getDeniedSnapshot, getDeniedServerSnapshot)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<string | null>(null)
  const [messageKind, setMessageKind] = useState<'error' | 'success'>('error')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)

    if (mode === 'signin') {
      const supabase = createBrowserSupabase()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setBusy(false)
      if (error) {
        setMessageKind('error')
        setMessage(error.message)
        return
      }
      // 整页跳转而非 router.push：会话层拦截（proxy.ts）可能判定这个邮箱
      // 不在白名单从而把请求重定向回 /login?denied=1。用整页导航能让
      // 那次重定向走真正的 HTTP 跳转（浏览器地址栏、cookie、页面状态
      // 三者一起刷新），而不是客户端路由的原地跳转——后者会保留这个
      // LoginPage 组件实例，导致上面读取 ?denied=1 的 effect 不会重跑。
      window.location.href = '/'
      return
    }

    // 注册不再走客户端 signUp（那条链路直连 Supabase，绕过了我们的白名单校验），
    // 改走服务端路由：由服务端用 service_role 校验白名单后再建号。
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        setMessageKind('error')
        setMessage(body.error ?? '注册失败，请重试。')
        return
      }
      setMessageKind('success')
      setMessage('注册成功，可以直接登录了。')
      setMode('signin')
    } catch {
      setMessageKind('error')
      setMessage('网络错误，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-ink">
        {mode === 'signin' ? '登录' : '注册'}
      </h1>

      {denied && (
        <p className="rounded-[10px] border border-seal/30 bg-seal/10 px-3 py-2 text-sm text-seal">
          该账号未获授权使用本站。
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email" required value={email} placeholder="邮箱"
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <input
          type="password" required minLength={6} value={password} placeholder="密码"
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <button
          type="submit" disabled={busy}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册'}
        </button>
      </form>
      {message && (
        <p className={`text-sm ${messageKind === 'error' ? 'text-seal' : 'text-jade'}`}>
          {message}
        </p>
      )}
      <button
        type="button"
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null) }}
        className="text-sm underline"
      >
        {mode === 'signin' ? '还没有账号？去注册' : '已有账号？去登录'}
      </button>
    </main>
  )
}

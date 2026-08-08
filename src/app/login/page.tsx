'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const supabase = createBrowserSupabase()
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    if (mode === 'signup') {
      setMessage('注册成功，请查收邮件完成验证后再登录。')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">
        {mode === 'signin' ? '登录' : '注册'}
      </h1>
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
      {message && <p className="text-sm text-red-600">{message}</p>}
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

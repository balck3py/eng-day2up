import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSettings, type Settings } from '../lib/config'
import { currentUser, getDb } from '../lib/db'
import { hidePopup, onSelection, openSettings } from '../lib/bridge'
import { modeOf } from '../lib/context'
import type { Selection } from '../lib/types'
import { Notice } from '../ui'
import { WordView } from './WordView'
import { TextView } from './TextView'

export interface Ready {
  settings: Settings
  db: SupabaseClient
  userId: string
}

type Env = 'loading' | 'unconfigured' | 'logged-out' | Ready

async function readEnv(): Promise<Env> {
  const settings = await loadSettings()
  const db = getDb(settings)
  if (!db) return 'unconfigured'
  const user = await currentUser(db)
  return user ? { settings, db, userId: user.id } : 'logged-out'
}

/**
 * 弹窗状态机：读取中 → 未配置/未登录引导 → 无选区提示 → 单词模式 / 文本模式。
 * 每次触发都重读设置，弹窗存活期间在设置页登录或改配置也能立刻生效。
 */
export function Popup() {
  const [env, setEnv] = useState<Env>('loading')
  const [sel, setSel] = useState<Selection | null>(null)

  const accept = useCallback((s: Selection) => {
    setSel((prev) => (prev && prev.seq >= s.seq ? prev : s))
    void readEnv().then(setEnv)
  }, [])

  useEffect(() => {
    let unlisten = () => {}
    void onSelection(accept).then((u) => (unlisten = u))
    if (!isTauri()) void readEnv().then(setEnv)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void hidePopup()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unlisten()
      window.removeEventListener('keydown', onKey)
    }
  }, [accept])

  return (
    <div className="flex h-screen flex-col overflow-hidden border border-rule bg-card">
      <header
        data-tauri-drag-region
        className="flex h-7 shrink-0 items-center justify-end gap-2 border-b border-rule px-2"
      >
        <button type="button" onClick={() => void openSettings()} className="text-[0.75rem] text-ink-3 hover:text-ink">
          设置
        </button>
        <button type="button" aria-label="关闭" onClick={() => void hidePopup()} className="text-ink-3 hover:text-ink">
          ×
        </button>
      </header>
      {!isTauri() && <DevTrigger onFire={accept} />}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Body env={env} sel={sel} />
      </main>
    </div>
  )
}

function Body({ env, sel }: { env: Env; sel: Selection | null }) {
  if (env === 'loading' || !sel) return <Notice>读取中…</Notice>
  if (env === 'unconfigured' || env === 'logged-out') {
    return (
      <div className="p-4">
        <p className="text-[0.9375rem] text-ink-2">请先在设置中连接 Supabase 并登录。</p>
        <button
          type="button"
          onClick={() => void openSettings()}
          className="mt-3 rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card"
        >
          打开设置
        </button>
      </div>
    )
  }
  const mode = modeOf(sel.text)
  if (mode.kind === 'empty') return <Notice>未读取到选中内容。</Notice>
  if (mode.kind === 'word') return <WordView key={sel.seq} env={env} sel={sel} word={mode.word} />
  return <TextView key={sel.seq} env={env} sel={sel} text={mode.text} truncated={mode.truncated} />
}

/** 浏览器开发模式：没有 Rust 主进程，手动模拟一次 selection 事件。 */
function DevTrigger({ onFire }: { onFire: (s: Selection) => void }) {
  const [text, setText] = useState('pragmatic')
  const [paragraph, setParagraph] = useState('First point. The approach is pragmatic and fast. Done.')
  const [seq, setSeq] = useState(1)
  function fire() {
    const p = paragraph.trim() ? paragraph : null
    const offset = p ? p.indexOf(text) : -1
    onFire({ seq, text, paragraph: offset >= 0 ? p : null, offset: offset >= 0 ? offset : null, source: p ? 'uia' : 'clipboard' })
    setSeq(seq + 1)
  }
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-rule bg-paper p-2 text-[0.75rem]">
      <span className="text-ink-3">开发模式：模拟选区（段落留空 = 剪贴板路径）</span>
      <textarea aria-label="选中文本" value={text} onChange={(e) => setText(e.target.value)} rows={2} className="rounded border border-rule bg-card p-1" />
      <textarea aria-label="所在段落" value={paragraph} onChange={(e) => setParagraph(e.target.value)} rows={2} className="rounded border border-rule bg-card p-1" />
      <button type="button" onClick={fire} className="self-start rounded bg-ink px-2 py-1 text-card">
        模拟触发
      </button>
    </div>
  )
}

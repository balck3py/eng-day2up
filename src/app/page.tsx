'use client'

import { useId, useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from '@/components/WordCard'
import type { WordDetail } from '@/lib/dict/types'

export default function HomePage() {
  const inputId = useId()
  const [input, setInput] = useState('')
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const text = input.trim()
    if (!text) return

    setDetail(null)
    setNotice(null)

    if (!isSingleWord(text)) {
      setNotice('段落翻译将在下一阶段提供，当前只支持查单个英文单词。')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/word/${encodeURIComponent(text)}`)
      if (!res.ok) {
        setNotice(
          res.status === 401 ? '登录已过期，请重新登录。' : '查询失败，请重试。',
        )
        return
      }
      setDetail((await res.json()) as WordDetail)
    } catch {
      setNotice('网络错误，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">翻译 · 单词本</h1>

      <div className="flex flex-col gap-3">
        <label htmlFor={inputId} className="sr-only">
          英文单词
        </label>
        <textarea
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
          rows={3}
          placeholder="输入一个英文单词…"
          className="w-full rounded-[10px] border border-rule bg-card p-3 text-ink placeholder:text-ink-3 focus:border-focus"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[0.8125rem] text-ink-3">⌘Enter 提交</p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
          >
            {busy ? '查询中…' : '查询'}
          </button>
        </div>
      </div>

      {notice && <p className="text-sm text-ink-2">{notice}</p>}
      {detail && <WordCard detail={detail} />}
    </main>
  )
}

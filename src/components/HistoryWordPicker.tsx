'use client'

import { useState } from 'react'
import { tokenize } from '@/lib/hardwords/tokenize'

interface Candidate {
  surface: string
  key: string
}

/**
 * 段落历史记录的「挑词」面板：把这段原文里的词全部列为候选，让用户自己挑
 * 哪些进单词本。
 *
 * 刻意**不**走难词提取 —— 那套按词频/掌握度筛出来的词未必是用户想要的。
 * 这里只做分词去重（tokenize 会滤掉停用词和单字母），难易由用户自己判断。
 *
 * 已在单词本里的词标出来且不可选，避免重复收藏时看不出哪些是新的。
 */
export function HistoryWordPicker({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [inBook, setInBook] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function expand() {
    setOpen(true)
    if (candidates.length > 0) return // 拆过一次就不再重复请求
    setLoading(true)
    setError(null)
    setCandidates(tokenize(text).map((t) => ({ surface: t.surface, key: t.key })))
    try {
      // 一次拉全量单词本建索引，而不是逐词查 —— 一段话几十个词，逐词查是几十个请求
      const res = await fetch('/api/wordbook')
      if (!res.ok) throw new Error()
      const d = (await res.json()) as { entries: { wordKey: string }[] }
      setInBook(new Set(d.entries.map((e) => e.wordKey)))
    } catch {
      setError('读不到单词本，下面的「已收藏」标记可能不准')
    } finally {
      setLoading(false)
    }
  }

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectable = candidates.filter((c) => !inBook.has(c.key))

  function selectAll() {
    setPicked(new Set(selectable.map((c) => c.key)))
  }

  async function saveSelected() {
    if (picked.size === 0 || saving) return
    setSaving(true)
    setError(null)
    const done = new Set(inBook)
    let failed = 0
    for (const c of candidates) {
      if (!picked.has(c.key)) continue
      try {
        const res = await fetch('/api/wordbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 带上原文，单词本里就能看到这个词当初出现在哪句话里
          body: JSON.stringify({ word: c.surface, sourceContext: text.slice(0, 500) }),
        })
        if (res.ok) done.add(c.key)
        else failed++
      } catch {
        failed++
      }
    }
    setInBook(done)
    setPicked(new Set())
    setSaving(false)
    if (failed > 0) setError(`有 ${failed} 个词没存进去，可以再点一次重试`)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void expand()}
        className="self-start text-sm text-ink-3 transition-colors hover:text-ink"
      >
        挑词收藏
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-rule bg-paper px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[0.8125rem] text-ink-2">
          {loading ? '拆词中…' : `${candidates.length} 个词 · 可选 ${selectable.length}`}
        </span>
        {selectable.length > 0 && (
          <>
            <button
              type="button"
              onClick={selectAll}
              className="text-[0.8125rem] text-ink-3 hover:text-ink"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="text-[0.8125rem] text-ink-3 hover:text-ink"
            >
              清空
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-[0.8125rem] text-ink-3 hover:text-ink"
        >
          收起
        </button>
      </div>

      {error && <p className="text-[0.8125rem] text-seal">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {candidates.map((c) => {
          const already = inBook.has(c.key)
          if (already) {
            return (
              <span
                key={c.key}
                data-testid={`picker-saved-${c.key}`}
                className="rounded-[8px] border border-rule px-2 py-1 font-mono text-[0.8125rem] text-ink-3"
                title="已在单词本里"
              >
                {c.surface} <span className="text-jade">✓</span>
              </span>
            )
          }
          const on = picked.has(c.key)
          return (
            <button
              key={c.key}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={c.surface}
              onClick={() => toggle(c.key)}
              className={`rounded-[8px] border px-2 py-1 font-mono text-[0.8125rem] transition-colors ${
                on
                  ? 'border-ink bg-ink text-card'
                  : 'border-rule text-ink-2 hover:border-ink hover:text-ink'
              }`}
            >
              {c.surface}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void saveSelected()}
        disabled={picked.size === 0 || saving}
        className="self-start rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
      >
        {saving ? '保存中…' : `收藏选中的 ${picked.size} 个词`}
      </button>
    </div>
  )
}

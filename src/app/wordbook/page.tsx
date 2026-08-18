'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { AudioButton } from '@/components/AudioButton'
import { lookupWordClient } from '@/lib/dict/clientLookup'

export default function WordbookPage() {
  const searchId = useId()
  const [entries, setEntries] = useState<WordbookEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wordbook?q=${encodeURIComponent(q)}`)
      if (!res.ok) {
        setError('加载失败，请重试。')
        return
      }
      const data = (await res.json()) as { entries: WordbookEntry[] }
      setEntries(data.entries)
    } catch {
      setError('网络错误，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(query), 250) // 输入防抖
    return () => clearTimeout(t)
  }, [query, load])

  // 没有中文释义的词：每次打开单词本都尝试查词/AI 兜底补全，并写回词库（补全存储），
  // 下次打开即命中、无需再查。attempted 防止同一次挂载内对同一个词重复发起。
  const attempted = useRef<Set<string>>(new Set())
  const [resolving, setResolving] = useState<Set<string>>(new Set())
  const toggleResolving = (key: string, on: boolean) =>
    setResolving((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  useEffect(() => {
    const pending = entries.filter(
      (e) => e.senses.length === 0 && !attempted.current.has(e.wordKey),
    )
    if (pending.length === 0) return
    let alive = true
    for (const e of pending) {
      attempted.current.add(e.wordKey)
      toggleResolving(e.wordKey, true)
      void (async () => {
        try {
          const d = await lookupWordClient(e.word)
          if (!alive || !d || d.senses.length === 0) return
          const phonetic = d.phonetic ?? d.phoneticUs ?? d.phoneticUk ?? null
          setEntries((list) =>
            list.map((x) =>
              x.id === e.id ? { ...x, senses: d.senses, phonetic: phonetic ?? x.phonetic } : x,
            ),
          )
          // 补全存储：把释义写回词库（按该词 word_key），下次打开直接命中
          void fetch('/api/ai-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: e.word, senses: d.senses, phonetic }),
          }).catch(() => {})
        } finally {
          if (alive) toggleResolving(e.wordKey, false)
        }
      })()
    }
    return () => {
      alive = false
    }
  }, [entries])

  async function remove(id: string) {
    const res = await fetch(`/api/wordbook/${id}`, { method: 'DELETE' })
    if (res.ok) setEntries((list) => list.filter((e) => e.id !== id))
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <label htmlFor={searchId} className="sr-only">
          搜索单词
        </label>
        <input
          id={searchId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词…"
          className="flex-1 rounded-[10px] border border-rule bg-card px-3 py-2 text-ink placeholder:text-ink-3 focus:border-focus"
        />
        <Link
          href="/review"
          className="shrink-0 rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card"
        >
          开始复习
        </Link>
      </div>

      {loading && <p className="text-[0.9375rem] text-ink-3">加载中…</p>}
      {error && <p className="text-[0.9375rem] text-seal">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-[0.9375rem] text-ink-3">
          {query ? '没有匹配的单词。' : '单词本还是空的 —— 去翻译页收藏几个词吧。'}
        </p>
      )}

      {entries.length > 0 && (
        <ul className="flex flex-col divide-y divide-rule rounded-[10px] border border-rule bg-card">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[1.0625rem] font-medium text-ink">{e.word}</span>
                  {e.phonetic && (
                    <span className="font-mono text-[0.8125rem] text-ink-2">{e.phonetic}</span>
                  )}
                  <AudioButton word={e.word} />
                  <span className="font-mono text-[0.75rem] text-ink-3">
                    熟练度 {e.familiarity}/5 · 复习 {e.reviewCount} 次
                  </span>
                </div>
                {e.senses.length > 0 ? (
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {e.senses.slice(0, 4).map((s, i) => (
                      <li key={i} className="text-[0.9375rem] leading-[1.6] text-ink">
                        {s.pos && (
                          <span className="mr-1.5 font-mono text-[0.8125rem] text-ink-2">
                            {s.pos}
                          </span>
                        )}
                        {s.meaning}
                      </li>
                    ))}
                  </ul>
                ) : resolving.has(e.wordKey) ? (
                  <p className="mt-1 text-[0.8125rem] text-ink-3">释义补全中…</p>
                ) : (
                  <p className="mt-1 text-[0.8125rem] text-ink-3">词库与 AI 均暂无释义</p>
                )}
                {e.sourceContext && (
                  <p className="mt-1.5 line-clamp-2 text-[0.875rem] leading-[1.6] text-ink-3">
                    “{e.sourceContext}”
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void remove(e.id)}
                aria-label={`移除 ${e.word}`}
                className="shrink-0 text-sm text-ink-3 transition-colors hover:text-seal"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

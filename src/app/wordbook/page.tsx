'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import Link from 'next/link'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { AudioButton } from '@/components/AudioButton'
import { hasChineseMeaning } from '@/lib/dict/senses'

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

  // 没有中文释义的词：点按钮批量补全（词库 → AI+原句 → 联网英文释义再翻译）。
  // 不再在打开页面时自动逐词发请求 —— 那条路每开一次单词本就打一批 AI 调用，
  // 补不上的词还每次都重来一遍。
  const missing = entries.filter((e) => !hasChineseMeaning(e.senses))
  const [filling, setFilling] = useState(false)
  const [fillNote, setFillNote] = useState<string | null>(null)

  async function backfill() {
    setFilling(true)
    setFillNote(null)
    const skip: string[] = []
    let filled = 0
    try {
      // 服务端一次只补一小批（每个词最多两轮 LLM，一口气补完必超时），
      // 这里反复调直到没有待补的词。补不动的进 skip，下一轮不再重试。
      for (let round = 0; round < 200; round++) {
        const res = await fetch('/api/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skip }),
        })
        if (!res.ok) {
          setFillNote('补全请求失败，请稍后再试。')
          break
        }
        const data = (await res.json()) as {
          filled: { word: string }[]
          failed: string[]
          remaining: number
          quotaExhausted?: boolean
        }
        if (data.quotaExhausted) {
          setFillNote(`今日 AI 配额已用完，已补全 ${filled} 个，明天再来。`)
          break
        }
        filled += data.filled.length
        skip.push(...data.failed)
        setFillNote(`补全中… 已补 ${filled} 个，还剩 ${data.remaining} 个`)
        if (data.remaining === 0) {
          setFillNote(
            skip.length > 0
              ? `补全完成：${filled} 个已补上，${skip.length} 个实在补不出（${skip.join('、')}），建议直接移除。`
              : `补全完成：${filled} 个已补上。`,
          )
          break
        }
      }
    } catch {
      setFillNote('网络错误，请重试。')
    } finally {
      setFilling(false)
      await load(query)
    }
  }

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

      {(missing.length > 0 || fillNote) && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-rule bg-card px-4 py-3">
          <button
            type="button"
            onClick={() => void backfill()}
            disabled={filling || missing.length === 0}
            className="shrink-0 rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-40"
          >
            {filling ? '补全中…' : `一键补全中文释义（${missing.length}）`}
          </button>
          <p className="text-[0.8125rem] leading-[1.7] text-ink-3">
            {fillNote ?? '词库 → AI（带原句）→ 联网查英文释义再翻译，逐级兜底。'}
          </p>
        </div>
      )}

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
                ) : (
                  <p className="mt-1 text-[0.8125rem] text-ink-3">
                    暂无中文释义 —— 点上面的「一键补全」
                  </p>
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

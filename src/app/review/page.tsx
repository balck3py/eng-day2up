'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { orderCards, type ReviewMode } from '@/lib/review/order'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { AudioButton } from '@/components/AudioButton'

type Phase = 'setup' | 'reviewing' | 'done'

const MODES: { value: ReviewMode; label: string }[] = [
  { value: 'sequential', label: '顺序' },
  { value: 'random', label: '随机' },
]

export default function ReviewPage() {
  const [all, setAll] = useState<WordbookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<ReviewMode>('sequential')
  const [queue, setQueue] = useState<WordbookEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [stats, setStats] = useState({ known: 0, unknown: 0 })

  useEffect(() => {
    void fetch('/api/wordbook')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: WordbookEntry[] }) => setAll(d.entries))
      .catch(() => setAll([]))
      .finally(() => setLoading(false))
  }, [])

  function start() {
    // 种子在点击时生成，避免服务端/客户端渲染不一致
    setQueue(orderCards(all, mode, Date.now() % 2147483647))
    setCursor(0)
    setRevealed(false)
    setStats({ known: 0, unknown: 0 })
    setPhase('reviewing')
  }

  const mark = useCallback(
    (known: boolean) => {
      const card = queue[cursor]
      if (!card) return
      setStats((s) => ({
        known: s.known + (known ? 1 : 0),
        unknown: s.unknown + (known ? 0 : 1),
      }))
      // 不等待接口返回就翻下一张 —— 标记失败不该阻塞复习节奏
      void fetch('/api/review/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: card.id, known }),
      })
      if (cursor + 1 >= queue.length) setPhase('done')
      else {
        setCursor(cursor + 1)
        setRevealed(false)
      }
    },
    [queue, cursor],
  )

  // 键盘操作：空格翻面，翻面后 1 / 2 标记
  useEffect(() => {
    if (phase !== 'reviewing') return
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed((r) => !r)
        return
      }
      if (!revealed) return
      if (e.key === '1') mark(false)
      if (e.key === '2') mark(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, revealed, mark])

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 text-[0.9375rem] text-ink-3 sm:px-6">
        加载中…
      </main>
    )
  }

  if (phase === 'setup') {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">复习 · 共 {all.length} 个单词</h2>
        {all.length === 0 ? (
          <p className="text-[0.9375rem] text-ink-3">
            单词本是空的。
            <Link href="/" className="text-ink underline">
              去收藏几个词
            </Link>
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="复习顺序"
              className="flex w-fit rounded-[10px] border border-rule bg-card p-0.5"
            >
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={`rounded-[8px] px-4 py-1.5 text-sm ${
                    mode === m.value
                      ? 'bg-ink font-medium text-card'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={start}
              className="self-start rounded-[10px] bg-ink px-5 py-2 text-sm font-medium text-card"
            >
              开始
            </button>
          </>
        )}
      </main>
    )
  }

  if (phase === 'done') {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 py-10 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">本轮完成</h2>
        <p className="text-[0.9375rem] text-ink-2">
          共 {queue.length} 个 · 认识 {stats.known} · 不认识 {stats.unknown}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPhase('setup')}
            className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card"
          >
            再来一轮
          </button>
          <Link
            href="/wordbook"
            className="rounded-[10px] border border-rule px-4 py-2 text-sm text-ink"
          >
            回单词本
          </Link>
        </div>
      </main>
    )
  }

  const card = queue[cursor]
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
      <p className="font-mono text-[0.8125rem] text-ink-3">
        {cursor + 1} / {queue.length}
      </p>

      {/* 用 div 而非 button 作卡片外壳：翻面后卡内有发音按钮，button 嵌 button 是非法
          HTML。空格翻面由全局 keydown 处理，这里再补 Enter，role/tabIndex 保证可聚焦。 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setRevealed(!revealed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setRevealed((r) => !r)
        }}
        className="min-h-56 cursor-pointer rounded-[10px] border border-rule bg-card p-8 text-left shadow-[0_1px_2px_rgba(20,33,61,0.04)] focus:border-focus focus:outline-none"
      >
        <p
          data-testid="review-word"
          className="text-[2.25rem] font-semibold tracking-[-0.02em] text-ink"
        >
          {card.word}
        </p>
        {revealed ? (
          <div className="mt-5 border-t border-rule pt-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {card.phonetic && (
                <span className="font-mono text-[0.9rem] text-ink-2">{card.phonetic}</span>
              )}
              <AudioButton word={card.word} />
            </div>
            {card.senses.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {card.senses.map((s, i) => (
                  <li key={i} className="text-[1rem] leading-[1.7] text-ink">
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
              <p className="mt-3 text-[0.9375rem] text-ink-3">词库暂无中文释义</p>
            )}
            {card.sourceContext && (
              <p className="mt-3 text-[0.875rem] leading-[1.7] text-ink-3">
                “{card.sourceContext}”
              </p>
            )}
            <p className="mt-3 font-mono text-[0.75rem] text-ink-3">
              熟练度 {card.familiarity}/5 · 已复习 {card.reviewCount} 次
            </p>
          </div>
        ) : (
          <p className="mt-5 text-[0.9375rem] text-ink-3">点击或按空格翻面</p>
        )}
      </div>

      {revealed && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => mark(false)}
            className="flex-1 rounded-[10px] border border-rule py-3 text-sm text-ink"
          >
            不认识 <span className="font-mono text-[0.75rem] text-ink-3">1</span>
          </button>
          <button
            type="button"
            onClick={() => mark(true)}
            className="flex-1 rounded-[10px] bg-ink py-3 text-sm font-medium text-card"
          >
            认识 <span className="font-mono text-[0.75rem] text-card/70">2</span>
          </button>
        </div>
      )}
    </main>
  )
}

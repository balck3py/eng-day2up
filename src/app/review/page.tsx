'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { orderCards, type ReviewMode } from '@/lib/review/order'
import { assignQuizTypes, type ReviewCard } from '@/lib/review/quiz'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { ReviewFlipCard } from '@/components/ReviewFlipCard'
import { ReviewInputCard } from '@/components/ReviewInputCard'

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
  /** 中译英题目占比，0 = 全英译中，100 = 全中译英 */
  const [cnRatio, setCnRatio] = useState(50)
  const [queue, setQueue] = useState<ReviewCard<WordbookEntry>[]>([])
  const [skipped, setSkipped] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  /**
   * 每张卡当前记下的「认识 / 不认识」，键是卡在 queue 里的下标。
   * 有了上一个 / 下一个导航，同一张卡会被翻到不止一次，判定必须能改写、
   * 能回看，所以按下标存，而不是加加减减地累计计数。
   */
  const [verdicts, setVerdicts] = useState<Record<number, boolean>>({})
  // 判定要在事件里被同步读到（选完立刻翻页那条路），state 赶不上，另存一份
  const verdictsRef = useRef<Record<number, boolean>>({})
  /** 已经写进熟练度的那些卡，值是写进去的判定，用来避免重复写库 */
  const markedRef = useRef<Record<number, boolean>>({})

  useEffect(() => {
    void fetch('/api/wordbook')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: WordbookEntry[] }) => setAll(d.entries))
      .catch(() => setAll([]))
      .finally(() => setLoading(false))
  }, [])

  function start() {
    // 种子在点击时生成，避免服务端/客户端渲染不一致
    const seed = Date.now() % 2147483647
    const ordered = orderCards(all, mode, seed)
    // 题型分配换一个种子，免得洗牌与分配抽同一串数
    const cards = assignQuizTypes(ordered, cnRatio, (e) => e.senses.length > 0, seed + 1)

    if (cards.length === 0) {
      setNotice('这些词都没有中文释义，出不了中译英题 —— 把比例往「英译中」拖一点。')
      return
    }

    setNotice(null)
    setQueue(cards)
    setSkipped(ordered.length - cards.length)
    setCursor(0)
    verdictsRef.current = {}
    markedRef.current = {}
    setVerdicts({})
    setPhase('reviewing')
  }

  /** 选定当前这张卡的判定。只落在本地：来回翻看不该反复写库 */
  const setVerdict = useCallback(
    (known: boolean) => {
      verdictsRef.current = { ...verdictsRef.current, [cursor]: known }
      setVerdicts(verdictsRef.current)
    },
    [cursor],
  )

  /**
   * 离开某张卡时才把判定写进熟练度，同一个值只写一次 —— 接口每调一次
   * review_count 就加一，翻回去看两眼不该算成复习了两遍。
   */
  const commit = useCallback(
    (index: number) => {
      const known = verdictsRef.current[index]
      if (known === undefined) return
      if (markedRef.current[index] === known) return
      const entry = queue[index]
      if (!entry) return
      markedRef.current[index] = known
      // 不等待接口返回 —— 标记失败不该阻塞复习节奏
      void fetch('/api/review/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.item.id, known }),
      })
    },
    [queue],
  )

  const go = useCallback(
    (target: number) => {
      commit(cursor)
      if (target >= queue.length) setPhase('done')
      else setCursor(Math.max(0, target))
    },
    [commit, cursor, queue.length],
  )

  const prev = useCallback(() => go(cursor - 1), [go, cursor])
  const next = useCallback(() => go(cursor + 1), [go, cursor])

  /** 英译中的认识 / 不认识：标记并翻页，跟加导航之前一样 */
  const markAndNext = useCallback(
    (known: boolean) => {
      setVerdict(known)
      // setVerdict 已经同步写进 ref，go 里的 commit 拿得到这个新值
      go(cursor + 1)
    },
    [setVerdict, go, cursor],
  )

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

            <div className="flex flex-col gap-2">
              <label htmlFor="cn-ratio" className="text-sm text-ink-2">
                题型比例
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[0.8125rem] text-ink-3">英译中</span>
                <input
                  id="cn-ratio"
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={cnRatio}
                  onChange={(e) => setCnRatio(Number(e.target.value))}
                  className="w-56 accent-ink"
                />
                <span className="text-[0.8125rem] text-ink-3">中译英</span>
              </div>
              <p className="font-mono text-[0.8125rem] text-ink-3">
                英译中 {100 - cnRatio}% · 中译英 {cnRatio}%
              </p>
            </div>

            {notice && <p className="text-[0.9375rem] text-seal">{notice}</p>}

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
    // 从 verdicts 现算，别累计 —— 中途改判、翻回去重选都要如实反映在这里。
    // 一个都没选就翻过去的卡两边都不算，所以两数之和可能小于总数。
    const chosen = Object.values(verdicts)
    const known = chosen.filter(Boolean).length
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 py-10 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">本轮完成</h2>
        <p className="text-[0.9375rem] text-ink-2">
          共 {queue.length} 个 · 认识 {known} · 不认识 {chosen.length - known}
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

  const entry = queue[cursor]
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
      <p className="font-mono text-[0.8125rem] text-ink-3">
        {cursor + 1} / {queue.length}
      </p>
      {skipped > 0 && (
        <p className="text-[0.8125rem] text-ink-3">
          本轮 {queue.length} 个 · {skipped} 个无中文释义已跳过
        </p>
      )}

      {/* key={cursor}：换卡即重新挂载，翻面/作答状态自然归零。判定活在页面上，
          所以翻回上一张时它还在，卡片只负责把它显示出来 */}
      {entry.type === 'en2cn' ? (
        <ReviewFlipCard
          key={cursor}
          card={entry.item}
          verdict={verdicts[cursor] ?? null}
          onMark={markAndNext}
          canPrev={cursor > 0}
          onPrev={prev}
          onNext={next}
        />
      ) : (
        <ReviewInputCard
          key={cursor}
          card={entry.item}
          verdict={verdicts[cursor] ?? null}
          onVerdict={setVerdict}
          canPrev={cursor > 0}
          onPrev={prev}
          onNext={next}
        />
      )}
    </main>
  )
}

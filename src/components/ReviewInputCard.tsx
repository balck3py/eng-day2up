'use client'

import { useEffect, useRef, useState } from 'react'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { isAnswerCorrect } from '@/lib/review/answer'
import { ReviewCardBack } from '@/components/ReviewCardBack'
import { ReviewFooter } from '@/components/ReviewFooter'

type Result = 'correct' | 'wrong'

/**
 * 中译英：题面只出中文释义 —— 音标会泄露拼写，例句里通常直接含着这个词，
 * 两者都不能在作答前露出。
 *
 * 这张卡任何时候都不该把人困住：拼不出来可以直接选底部的「认识 / 不认识」
 * 看答案，看完答案还能「改一下」回去重答，自动判定也能手动改写。判定只落在
 * 页面的本地状态里，等离开这张卡才写熟练度 —— 否则中途改判会重复写库。
 */
export function ReviewInputCard({
  card,
  verdict,
  onVerdict,
  canPrev,
  onPrev,
  onNext,
}: {
  card: WordbookEntry
  verdict: boolean | null
  onVerdict: (known: boolean) => void
  canPrev: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const [input, setInput] = useState('')
  /** 提交打字答案后的自动判定；直接选「认识 / 不认识」跳过作答时为 null */
  const [judged, setJudged] = useState<Result | null>(null)
  const [revealed, setRevealed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 作答态才聚焦：从答案态点「改一下」回来也要把光标送回输入框
  useEffect(() => {
    if (!revealed) inputRef.current?.focus()
  }, [revealed])

  // 看到答案后：回车翻页，1 / 2 改判，与英译中卡片的手势保持一致
  useEffect(() => {
    if (!revealed) return
    const attachedAt = performance.now()
    function onKey(e: KeyboardEvent) {
      // 掀开答案的那次按键此刻还在往上冒泡：React 19 会在同一次离散事件里同步
      // flush passive effect，监听刚挂上就被它撞个正着。不挡掉的话一次回车既
      // 提交又翻页，答案连一眼都看不到。比时间戳即可 —— 事件早于挂载时刻。
      if (e.timeStamp <= attachedAt) return
      if (e.key === 'Enter') {
        e.preventDefault()
        onNext()
        return
      }
      if (e.key === '1') onVerdict(false)
      if (e.key === '2') onVerdict(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, onNext, onVerdict])

  function submit() {
    // 空输入不判错 —— 想跳过的话底部就有「不认识」，别让一次误触把词记成生词
    if (input.trim() === '') return
    const correct = isAnswerCorrect(input, card.word)
    setJudged(correct ? 'correct' : 'wrong')
    onVerdict(correct)
    setRevealed(true)
  }

  /** 底部的认识 / 不认识：拼不出来就直接选，顺带把答案亮出来 */
  function choose(known: boolean) {
    if (!revealed) {
      // 没作答就选的，谈不上答对答错，不给自动判定的标签
      setJudged(null)
      setRevealed(true)
    }
    onVerdict(known)
  }

  function edit() {
    setRevealed(false)
    setJudged(null)
  }

  const verdictLabel = judged === null ? '答案' : judged === 'correct' ? '答对' : '答错'
  const verdictClass =
    judged === null ? 'text-ink-2' : judged === 'correct' ? 'text-jade' : 'text-seal'

  return (
    <>
      <div className="min-h-56 rounded-[10px] border border-rule bg-card p-8 shadow-[0_1px_2px_rgba(20,33,61,0.04)]">
        <ul className="flex flex-col gap-1.5">
          {card.senses.map((s, i) => (
            <li key={i} className="text-[1.25rem] leading-[1.6] text-ink">
              {s.pos && (
                <span className="mr-1.5 font-mono text-[0.8125rem] text-ink-2">{s.pos}</span>
              )}
              {s.meaning}
            </li>
          ))}
        </ul>

        {!revealed ? (
          <div className="mt-6 flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              aria-label="输入英文单词"
              placeholder="输入英文单词"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 rounded-[10px] border border-rule bg-paper px-4 py-2.5 text-[1rem] text-ink placeholder:text-ink-3 focus:border-focus focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={input.trim() === ''}
              className="shrink-0 whitespace-nowrap rounded-[10px] bg-ink px-5 py-2.5 text-sm font-medium text-card disabled:opacity-40"
            >
              提交
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <p className={`text-sm font-medium ${verdictClass}`}>{verdictLabel}</p>
            <p className="mt-2 flex flex-wrap items-baseline gap-3">
              <span
                data-testid="review-answer"
                className="text-[2.25rem] font-semibold tracking-[-0.02em] text-ink"
              >
                {card.word}
              </span>
              {judged === 'wrong' && (
                <span
                  data-testid="review-wrong-input"
                  className="font-mono text-[1rem] text-seal line-through"
                >
                  {input}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={edit}
              className="mt-4 whitespace-nowrap rounded-[8px] border border-rule px-3 py-1.5 text-[0.8125rem] text-ink"
            >
              改一下
            </button>
            <ReviewCardBack card={card} />
          </div>
        )}
      </div>

      <ReviewFooter
        canPrev={canPrev}
        onPrev={onPrev}
        onNext={onNext}
        nextHint={revealed ? 'Enter' : undefined}
        showVerdict
        verdict={verdict}
        onVerdict={choose}
      />
    </>
  )
}

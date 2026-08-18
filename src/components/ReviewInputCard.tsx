'use client'

import { useEffect, useRef, useState } from 'react'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { isAnswerCorrect } from '@/lib/review/answer'
import { ReviewCardBack } from '@/components/ReviewCardBack'

type Result = 'correct' | 'wrong'

/**
 * 中译英：题面只出中文释义 —— 音标会泄露拼写，例句里通常直接含着这个词，
 * 两者都不能在作答前露出。
 *
 * 提交即判定即写熟练度，但**不**自动翻页：答错时要留出看清正确答案的时间。
 */
export function ReviewInputCard({
  card,
  onMark,
  onNext,
}: {
  card: WordbookEntry
  onMark: (known: boolean) => void
  onNext: () => void
}) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 已判定后回车进入下一张。作答时的那次回车走 input 自己的 onKeyDown，
  // 监听是在它引发的 state 更新之后才挂上的，不会被同一个事件连带触发。
  useEffect(() => {
    if (result === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, onNext])

  function submit() {
    if (result !== null) return
    const correct = isAnswerCorrect(input, card.word)
    setResult(correct ? 'correct' : 'wrong')
    onMark(correct)
  }

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

        {result === null ? (
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
              className="rounded-[10px] bg-ink px-5 py-2.5 text-sm font-medium text-card"
            >
              提交
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <p
              className={`text-sm font-medium ${
                result === 'correct' ? 'text-jade' : 'text-seal'
              }`}
            >
              {result === 'correct' ? '答对' : '答错'}
            </p>
            <p className="mt-2 flex flex-wrap items-baseline gap-3">
              <span
                data-testid="review-answer"
                className="text-[2.25rem] font-semibold tracking-[-0.02em] text-ink"
              >
                {card.word}
              </span>
              {result === 'wrong' && (
                <span
                  data-testid="review-wrong-input"
                  className="font-mono text-[1rem] text-seal line-through"
                >
                  {input}
                </span>
              )}
            </p>
            <ReviewCardBack card={card} />
          </div>
        )}
      </div>

      {result !== null && (
        <button
          type="button"
          onClick={onNext}
          className="rounded-[10px] bg-ink py-3 text-sm font-medium text-card"
        >
          下一个 <span className="font-mono text-[0.75rem] text-card/70">Enter</span>
        </button>
      )}
    </>
  )
}

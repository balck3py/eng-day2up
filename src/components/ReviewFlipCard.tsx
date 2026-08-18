'use client'

import { useEffect, useState } from 'react'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { ReviewCardBack } from '@/components/ReviewCardBack'

/**
 * 英译中：正面出英文，点击或空格翻面，翻面后按 1 / 2 标记。
 * 翻面状态靠父级传 key 重置（换卡即重新挂载），组件内不做同步。
 *
 * 键盘监听住在组件里而非页面级 —— 中译英卡片上输入框要吃空格，
 * 全局监听会和它打架。
 */
export function ReviewFlipCard({
  card,
  onMark,
}: {
  card: WordbookEntry
  onMark: (known: boolean) => void
}) {
  const [revealed, setRevealed] = useState(false)

  // 键盘操作：空格翻面，翻面后 1 / 2 标记
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed((r) => !r)
        return
      }
      if (!revealed) return
      if (e.key === '1') onMark(false)
      if (e.key === '2') onMark(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, onMark])

  return (
    <>
      {/* 用 div 而非 button 作卡片外壳：翻面后卡内有发音按钮，button 嵌 button 是非法
          HTML。空格翻面由上面的 keydown 处理，这里再补 Enter，role/tabIndex 保证可聚焦。 */}
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
          <ReviewCardBack card={card} />
        ) : (
          <p className="mt-5 text-[0.9375rem] text-ink-3">点击或按空格翻面</p>
        )}
      </div>

      {revealed && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onMark(false)}
            className="flex-1 rounded-[10px] border border-rule py-3 text-sm text-ink"
          >
            不认识 <span className="font-mono text-[0.75rem] text-ink-3">1</span>
          </button>
          <button
            type="button"
            onClick={() => onMark(true)}
            className="flex-1 rounded-[10px] bg-ink py-3 text-sm font-medium text-card"
          >
            认识 <span className="font-mono text-[0.75rem] text-card/70">2</span>
          </button>
        </div>
      )}
    </>
  )
}

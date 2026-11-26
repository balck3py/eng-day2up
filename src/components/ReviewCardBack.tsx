'use client'

import type { WordbookEntry } from '@/lib/wordbook/types'
import { AudioButton } from '@/components/AudioButton'

/**
 * 卡片背面：音标 / 发音 / 例句 / 熟练度。
 * 中文释义不在这里显示 —— 中译英的题面、英译中的翻面区各自负责。
 */
export function ReviewCardBack({ card }: { card: WordbookEntry }) {
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {card.phonetic && (
          <span className="font-mono text-[0.9rem] text-ink-2">{card.phonetic}</span>
        )}
        <AudioButton word={card.word} />
      </div>
      {card.sourceContext && (
        <p className="mt-3 text-[0.875rem] leading-[1.7] text-ink-3">“{card.sourceContext}”</p>
      )}
      <p className="mt-3 font-mono text-[0.75rem] text-ink-3">
        熟练度 {card.familiarity}/5 · 已复习 {card.reviewCount} 次
      </p>
    </div>
  )
}

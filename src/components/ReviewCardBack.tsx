'use client'

import type { WordbookEntry } from '@/lib/wordbook/types'
import { AudioButton } from '@/components/AudioButton'

/**
 * 卡片背面：音标 / 发音 / 释义 / 例句 / 熟练度。
 * 英译中翻面后与中译英提交后展示的是同一块内容，抽出来共用。
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
      {card.senses.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {card.senses.map((s, i) => (
            <li key={i} className="text-[1rem] leading-[1.7] text-ink">
              {s.pos && (
                <span className="mr-1.5 font-mono text-[0.8125rem] text-ink-2">{s.pos}</span>
              )}
              {s.meaning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.9375rem] text-ink-3">词库暂无中文释义</p>
      )}
      {card.sourceContext && (
        <p className="mt-3 text-[0.875rem] leading-[1.7] text-ink-3">“{card.sourceContext}”</p>
      )}
      <p className="mt-3 font-mono text-[0.75rem] text-ink-3">
        熟练度 {card.familiarity}/5 · 已复习 {card.reviewCount} 次
      </p>
    </div>
  )
}

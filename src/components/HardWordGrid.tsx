'use client'

import { useState } from 'react'
import type { HardWord } from '@/lib/hardwords/extract'
import { FavoriteButton } from './FavoriteButton'

function Card({ hw, context }: { hw: HardWord; context: string }) {
  const [open, setOpen] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 原文里的形态与词典原型不一致时，沿用词卡上那个 `said →` 标记
  const inflected = hw.surface.toLowerCase() !== hw.word.toLowerCase()

  async function toggle() {
    const next = !open
    setOpen(next)
    // 上下文释义按需触发：只有展开且尚未取过时才调 LLM。
    // 这是「段落模式 LLM 调用恒为 1」的关键 —— 拆解本身不调模型。
    if (!next || explanation !== null || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: hw.word, context }),
      })
      const data = (await res.json()) as { explanation?: string; error?: string }
      setExplanation(res.ok ? (data.explanation ?? '') : `（${data.error}）`)
    } catch {
      setExplanation('（释义获取失败，请重试）')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-[10px] border border-rule bg-card">
      {/* 收藏星标放在展开按钮外面，避免 <button> 嵌套 <button> */}
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-expanded={open}
          className="flex-1 rounded-l-[10px] py-3.5 pl-3.5 text-left"
        >
          {inflected && (
            <span className="block font-mono text-[0.8125rem] text-ink-3">
              {hw.surface} →
            </span>
          )}
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[1.125rem] font-semibold tracking-[-0.01em] text-ink">
              {hw.word}
            </span>
            {hw.phonetic && (
              <span className="font-mono text-[0.8125rem] text-ink-2">{hw.phonetic}</span>
            )}
          </span>

          {hw.senses.length > 0 ? (
            <span className="mt-1.5 block text-[0.9375rem] leading-[1.6] text-ink-2">
              {hw.senses
                .slice(0, 2)
                .map((s) => (s.pos ? `${s.pos} ${s.meaning}` : s.meaning))
                .join('；')}
            </span>
          ) : (
            <span className="mt-1.5 block text-[0.9375rem] text-ink-3">词典未收录</span>
          )}
        </button>
        <div className="p-3.5 pl-2">
          <FavoriteButton word={hw.word} sourceContext={context} />
        </div>
      </div>

      {open && (
        <div className="mx-3.5 mb-3.5 grid grid-cols-[2.75rem_1px_1fr] gap-x-3 border-t border-rule pt-2.5">
          <span className="pt-px text-right font-mono text-[0.8125rem] text-ink-3">
            本句
          </span>
          <span className="self-stretch bg-rule" aria-hidden="true" />
          <p className="text-[0.9375rem] leading-[1.6] text-ink" aria-live="polite">
            {busy ? (
              <span className="text-ink-3">正在分析它在这句话里的含义…</span>
            ) : (
              explanation
            )}
          </p>
        </div>
      )}
    </li>
  )
}

export function HardWordGrid({
  words,
  context,
}: {
  words: HardWord[]
  context: string
}) {
  if (words.length === 0) return null
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="font-mono text-[0.8125rem] text-ink-2">难词</h3>
        <span className="font-mono text-[0.8125rem] text-ink-3">
          {words.length} · 点开看它在本文中的意思
        </span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {words.map((hw) => (
          <Card key={hw.word} hw={hw} context={context} />
        ))}
      </ul>
    </section>
  )
}

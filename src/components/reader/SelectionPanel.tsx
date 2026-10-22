'use client'

import { useEffect, useState } from 'react'
import { WordCard } from '@/components/WordCard'
import { HardWordGrid } from '@/components/HardWordGrid'
import { lookupWordClient } from '@/lib/dict/clientLookup'
import { fetchHardWords, streamTranslate } from '@/lib/translate/client'
import { sentenceContaining } from '@/lib/reader/sentence'
import type { WordDetail } from '@/lib/dict/types'
import type { HardWord } from '@/lib/hardwords/extract'

export interface Picked {
  /** 选中的原文 */
  text: string
  /** 单词：它所在的那一句；句子：覆盖选区的完整句子（供难词挑各自的句子） */
  context: string
  isWord: boolean
}

function WordPane({ picked }: { picked: Picked }) {
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    void lookupWordClient(picked.text).then((d) => {
      if (!alive) return
      setDetail(d)
      setDone(true)
    })
    return () => {
      alive = false
    }
  }, [picked.text])

  if (!done) return <p className="p-4 text-[0.9375rem] text-ink-3">查询中…</p>
  if (!detail) return <p className="p-4 text-[0.9375rem] text-ink-2">查询失败，请稍后重试。</p>
  return (
    <>
      <WordCard detail={detail} variant="embedded" sourceContext={picked.context} />
      <p className="border-t border-rule px-4 py-2.5 text-[0.8125rem] leading-[1.6] text-ink-3">
        <span className="font-mono">收藏时连同此句：</span>
        {picked.context}
      </p>
    </>
  )
}

function SentencePane({ picked }: { picked: Picked }) {
  const [translation, setTranslation] = useState('')
  const [streaming, setStreaming] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hardWords, setHardWords] = useState<HardWord[]>([])

  useEffect(() => {
    let alive = true
    void fetchHardWords(picked.text).then((w) => alive && setHardWords(w))
    void streamTranslate(picked.text, 'en2zh', (d) => {
      if (alive) setTranslation((t) => t + d)
    }).then((o) => {
      if (!alive) return
      setError(o.error)
      setStreaming(false)
    })
    return () => {
      alive = false
    }
  }, [picked.text])

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h3 className="mb-1.5 font-mono text-[0.8125rem] text-ink-2">译文</h3>
        <p
          className="text-[0.9375rem] leading-[1.7] whitespace-pre-wrap text-ink"
          aria-live="polite"
          aria-busy={streaming}
        >
          {translation}
          {streaming && <span className="streaming-caret" aria-hidden="true" />}
        </p>
        {error && <p className="mt-2 text-[0.9375rem] text-seal">{error}</p>}
      </section>
      <HardWordGrid
        words={hardWords}
        context={picked.context}
        contextFor={(hw) => sentenceContaining(picked.context, hw.surface)}
        compact
      />
    </div>
  )
}

/** 浮窗内容：单词 → 词卡；句子 → 流式译文 + 难词（可收藏，连同各自所在句）。 */
export function SelectionPanel({ picked }: { picked: Picked }) {
  return picked.isWord ? <WordPane picked={picked} /> : <SentencePane picked={picked} />
}

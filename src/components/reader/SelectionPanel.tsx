'use client'

import { useEffect, useState } from 'react'
import { FavoriteButton } from '@/components/FavoriteButton'
import { lookupWordClient } from '@/lib/dict/clientLookup'
import { streamTranslate } from '@/lib/translate/client'
import { getRequestSource } from '@/lib/translate/deviceTranslation'
import { pronounce } from '@/lib/audio/pronounce'
import type { WordDetail } from '@/lib/dict/types'

export interface Picked {
  text: string
  context: string
  isWord: boolean
  truncated?: boolean
}

/** Compact auxiliary result: four text lines, independently scrollable. */
export function SelectionPanel({ picked, close }: { picked: Picked; close: () => void }) {
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [translation, setTranslation] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [speechError, setSpeechError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    async function query() {
      setBusy(true); setError(null); setTranslation(''); setDetail(null)
      if (picked.isWord) {
        const result = await lookupWordClient(picked.text, controller.signal)
        if (!alive) return
        setDetail(result)
        if (!result) setError(getRequestSource() === 'device' ? '设备查词失败，请重试或在设置切回 Vercel。' : '查询失败，请重试')
      } else {
        const outcome = await streamTranslate(picked.text, 'en2zh', (delta) => {
          if (alive) setTranslation((text) => text + delta)
        }, undefined, controller.signal)
        if (!alive) return
        setError(outcome.error)
      }
      setBusy(false)
    }
    void query()
    return () => { alive = false; controller.abort() }
  }, [picked.text, picked.isWord, attempt])

  async function speak() {
    if (speaking || !detail) return
    setSpeaking(true); setSpeechError(false)
    const result = await pronounce(detail.word, 'us')
    setSpeaking(false); setSpeechError(result === 'failed')
  }

  return (
    <>
      <div className="flex min-h-8 items-center gap-2 border-b border-rule px-3 py-1 text-xs text-ink-3">
        <span className="min-w-0 flex-1 truncate">{picked.isWord ? (detail?.word ?? picked.text) : '中文翻译'}{picked.truncated && ' · 已截取前 2000 字'}</span>
        {picked.isWord && detail && <>
          <button type="button" aria-label="播放单词发音" disabled={speaking} onClick={() => void speak()} className="shrink-0 rounded px-1 disabled:opacity-50">{speaking ? '…' : '🔊'}</button>
          {detail.matchedFrom !== 'none' && <FavoriteButton word={detail.word} sourceContext={picked.context} />}
        </>}
        <button type="button" aria-label="关闭翻译" onClick={close} className="shrink-0 rounded px-1 text-lg leading-none">×</button>
      </div>
      <div data-translation-content tabIndex={0} aria-label="翻译内容" aria-live="polite" aria-busy={busy}
        className="m-3 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm leading-[1.5]"
        style={{ maxHeight: '6em' }}>
        {picked.isWord && detail && <>
          <p className="font-mono text-ink-3">{detail.phoneticUs ?? detail.phonetic ?? detail.phoneticUk ?? '暂无音标'}</p>
          {detail.senses.length ? detail.senses.map((sense, i) => <p key={i}>{sense.pos} {sense.meaning}</p>) : <p>词典未收录这个词。</p>}
        </>}
        {!picked.isWord && translation}
        {busy && <span className="text-ink-3">{translation ? '…' : '查询中…'}</span>}
        {(error || speechError) && <p role="alert" className="text-seal">{error ?? '发音加载失败'} {error && <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline">重试</button>}</p>}
      </div>
    </>
  )
}

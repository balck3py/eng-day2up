'use client'

import { useEffect, useRef, useState } from 'react'
import { pronounce, type Accent } from '@/lib/audio/pronounce'

const FAIL_MESSAGE_MS = 4000

type PlayState = 'idle' | 'loading' | 'failed'

/**
 * 精简发音按钮：点一下读这个词（默认美音）。走 pronounce 的有道→本地合成降级链。
 * 供单词本 / 复习页做「快捷听力」用；词卡有自己带音标的 Pronunciation，不复用这个。
 */
export function AudioButton({
  word,
  accent = 'us',
  label = '美音',
}: {
  word: string
  accent?: Accent
  label?: string
}) {
  const [state, setState] = useState<PlayState>('idle')
  const mountedRef = useRef(true)
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (failTimerRef.current) clearTimeout(failTimerRef.current)
    }
  }, [])

  async function handleClick(e: React.MouseEvent) {
    // 复习卡整卡可点翻面，这里阻止冒泡，避免点发音顺带翻了面
    e.stopPropagation()
    if (state === 'loading') return
    if (failTimerRef.current) {
      clearTimeout(failTimerRef.current)
      failTimerRef.current = null
    }
    setState('loading')
    const result = await pronounce(word, accent)
    if (!mountedRef.current) return
    if (result === 'failed') {
      setState('failed')
      failTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setState('idle')
      }, FAIL_MESSAGE_MS)
    } else {
      setState('idle')
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={`播放${label}发音 ${word}`}
        aria-busy={state === 'loading'}
        disabled={state === 'loading'}
        onClick={(e) => void handleClick(e)}
        className="rounded text-ink-2 hover:text-ink disabled:opacity-60"
      >
        {state === 'loading' ? '🔊…' : '🔊'}
      </button>
      {state === 'failed' && <span className="text-xs text-ink-3">发音加载失败</span>}
    </span>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from './WordCard'
import type { WordDetail } from '@/lib/dict/types'

const POPOVER_WIDTH = 320
const MARGIN = 12

/**
 * 包裹任意内容，在其中选中单个英文单词时弹出词卡。
 *
 * 定位用 fixed + 视口坐标，而不是计划里写的「relative 容器 + absolute +
 * 页面坐标」—— 后者会把页面坐标当成容器坐标用，滚动过后必然偏。
 */
export function SelectionPopover({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const genRef = useRef(0)
  // effect 只挂载一次，读不到 word 这个 state，用 ref 记当前展示的词
  const wordRef = useRef('')
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [word, setWord] = useState('')
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onSelect(e: Event) {
      // 浮层内部的点击（发音按钮等）也会冒泡出 mouseup，而此时选区还在，
      // 不排除的话每点一次浮层就重查一次词。
      const origin = e.target as HTMLElement | null
      if (origin?.closest('[data-selection-popover]')) return

      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''

      // 只对「选区落在本组件内」且「是单个英文词」的情况响应
      if (!text || !isSingleWord(text) || !sel?.rangeCount) return
      const range = sel.getRangeAt(0)
      if (!hostRef.current?.contains(range.commonAncestorContainer)) return
      // 选区没变就别重查（例如在已选中的词上再点一下）
      if (text === wordRef.current) return

      const rect = range.getBoundingClientRect()
      // 贴住选中词的正下方，并夹在视口内 —— 页面不得因浮层而横向滚动
      const x = Math.min(
        Math.max(MARGIN, rect.left),
        Math.max(MARGIN, window.innerWidth - POPOVER_WIDTH - MARGIN),
      )
      setPos({ x, y: rect.bottom + 8 })
      wordRef.current = text
      setWord(text)
      setDetail(null)
      setBusy(true)

      // 连续划词时旧请求可能后到，用世代号丢弃过期结果
      const gen = ++genRef.current
      void fetch(`/api/word/${encodeURIComponent(text)}`)
        .then((r) => (r.ok ? (r.json() as Promise<WordDetail>) : null))
        .catch(() => null)
        .then((d) => {
          if (gen !== genRef.current) return
          setDetail(d)
          setBusy(false)
        })
    }

    function close() {
      setPos(null)
      // 允许再次选中同一个词重新查
      wordRef.current = ''
    }

    function onPointerDown(e: Event) {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-selection-popover]')) close()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('mouseup', onSelect)
    document.addEventListener('touchend', onSelect)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mouseup', onSelect)
      document.removeEventListener('touchend', onSelect)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div ref={hostRef}>
      {children}
      {pos && (
        <div
          data-selection-popover
          role="dialog"
          aria-label={`${word} 的释义`}
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            width: `min(${POPOVER_WIDTH}px, calc(100vw - ${MARGIN * 2}px))`,
          }}
          className="z-50 max-h-[60vh] overflow-y-auto rounded-[10px] border border-rule bg-card shadow-[0_4px_16px_rgba(20,33,61,0.12)]"
        >
          {busy && <p className="p-4 text-[0.9375rem] text-ink-3">查询中…</p>}
          {!busy && detail && <WordCard detail={detail} variant="embedded" />}
          {!busy && !detail && (
            <p className="p-4 text-[0.9375rem] text-ink-2">
              查询失败，请稍后重试。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

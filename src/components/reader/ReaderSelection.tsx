'use client'

import { useEffect, useRef, useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { sentenceAt, sentencesCovering } from '@/lib/reader/sentence'
import { SelectionPanel, type Picked } from './SelectionPanel'

const BLOCK_SELECTOR = 'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,dt,dd'
const MAX_SELECTION = 2000
const PANEL_WIDTH = 440
const MARGIN = 12
const ICON_SIZE = 40
/** selectionchange 在拖选过程中连发，停手后再判定 */
const SETTLE_MS = 250

interface Pending extends Picked {
  rect: DOMRect
}

type PanelPlacement =
  | { kind: 'sheet' }
  | { kind: 'float'; left: number; top?: number; bottom?: number; maxHeight: number }

/** 选区起止在所在块文本中的偏移，用来切出完整句子。跨块选择时块取 host 本身。 */
function pickFrom(range: Range, host: HTMLElement, text: string): Picked {
  const startEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  const block = (startEl?.closest(BLOCK_SELECTOR) as HTMLElement | null) ?? host
  const scope = host.contains(block) && block.contains(range.endContainer) ? block : host

  const before = document.createRange()
  before.setStart(scope, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  const end = start + range.toString().length
  const blockText = scope.textContent ?? ''

  const isWord = isSingleWord(text)
  return {
    text,
    isWord,
    context: isWord ? sentenceAt(blockText, start) : sentencesCovering(blockText, start, end),
  }
}

function placePanel(rect: DOMRect): PanelPlacement {
  // 手机窄屏：浮窗放不下，改成底部面板
  if (window.matchMedia('(max-width: 639px)').matches) return { kind: 'sheet' }
  const left = Math.min(
    Math.max(MARGIN, rect.left),
    Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN),
  )
  const below = window.innerHeight - rect.bottom - MARGIN * 2
  const above = rect.top - MARGIN * 2
  if (below >= 320 || below >= above) return { kind: 'float', left, top: rect.bottom + 8, maxHeight: below }
  return { kind: 'float', left, bottom: window.innerHeight - rect.top + 8, maxHeight: above }
}

/**
 * 阅读页划词：选中文字后在选区**下方**冒出「译」按钮（上方留给手机系统的
 * 复制菜单），点按钮弹出翻译浮窗。
 *
 * 监听 selectionchange 而不是 mouseup/touchend —— 手机长按选词、拖动选区手柄
 * 都不会可靠地触发 touchend，但一定会触发 selectionchange。
 */
export function ReaderSelection({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [open, setOpen] = useState<{ picked: Picked; placement: PanelPlacement } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    function evaluate() {
      const host = hostRef.current
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!host || !sel || !text || sel.isCollapsed || !sel.rangeCount) {
        setPending(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) {
        setPending(null)
        return
      }
      setPending({
        ...pickFrom(range, host, text.slice(0, MAX_SELECTION)),
        rect: range.getBoundingClientRect(),
      })
    }

    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(evaluate, SETTLE_MS)
    }

    // 页面滚动后 fixed 定位的按钮会和选区错开，立即按新位置重算
    function onScroll() {
      if (window.getSelection()?.isCollapsed === false) evaluate()
    }

    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t?.closest('[data-reader-panel],[data-reader-trigger]')) setOpen(null)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  function openPanel() {
    if (!pending) return
    const { rect, ...picked } = pending
    setOpen({ picked, placement: placePanel(rect) })
    setPending(null)
  }

  const iconLeft = pending
    ? Math.min(
        Math.max(MARGIN, pending.rect.left + pending.rect.width / 2 - ICON_SIZE / 2),
        window.innerWidth - ICON_SIZE - MARGIN,
      )
    : 0

  const placement = open?.placement
  const panelStyle: React.CSSProperties | undefined =
    placement?.kind === 'float'
      ? {
          position: 'fixed',
          left: placement.left,
          top: placement.top,
          bottom: placement.bottom,
          maxHeight: placement.maxHeight,
          width: `min(${PANEL_WIDTH}px, calc(100vw - ${MARGIN * 2}px))`,
        }
      : undefined

  return (
    <>
      <div ref={hostRef}>{children}</div>

      {pending && !open && (
        <button
          type="button"
          data-reader-trigger
          aria-label="翻译选中内容"
          // 桌面端阻止按下时清掉选区；手机端选区可能仍会被收起，所以内容已在 pending 里存好
          onPointerDown={(e) => e.preventDefault()}
          onClick={openPanel}
          style={{
            position: 'fixed',
            left: iconLeft,
            top: Math.min(pending.rect.bottom + 8, window.innerHeight - ICON_SIZE - MARGIN),
            width: ICON_SIZE,
            height: ICON_SIZE,
          }}
          className="z-50 rounded-full border border-rule bg-ink text-[0.9375rem] font-semibold text-card shadow-[0_4px_16px_rgba(20,33,61,0.18)]"
        >
          译
        </button>
      )}

      {open && (
        <div
          data-reader-panel
          role="dialog"
          aria-label={open.picked.isWord ? `${open.picked.text} 的释义` : '选中内容的翻译'}
          style={panelStyle}
          className={
            placement?.kind === 'sheet'
              ? 'fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-[14px] border-t border-rule bg-card shadow-[0_-4px_16px_rgba(20,33,61,0.12)]'
              : 'z-50 overflow-y-auto rounded-[10px] border border-rule bg-card shadow-[0_4px_16px_rgba(20,33,61,0.12)]'
          }
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rule bg-card px-4 py-2">
            <p className="truncate font-mono text-[0.8125rem] text-ink-3">{open.picked.text}</p>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="关闭"
              className="shrink-0 text-lg leading-none text-ink-3 hover:text-ink"
            >
              ×
            </button>
          </div>
          <SelectionPanel key={open.picked.text} picked={open.picked} />
        </div>
      )}
    </>
  )
}

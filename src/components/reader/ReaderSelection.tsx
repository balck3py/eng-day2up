'use client'

import { useEffect, useRef, useState } from 'react'
import { SelectionPanel, type Picked } from './SelectionPanel'
import { pickSelection } from './selection'

export function ReaderSelection({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ picked: Picked; key: number } | null>(null)
  const closeRef = useRef<() => void>(() => {})

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let sequence = 0
    let lastRange: Range | null = null
    let lastText = ''
    let dismissed = false
    let panelInteraction = false
    const inPanel = (node: EventTarget | Node | null) => node instanceof Node && !!panelRef.current?.contains(node)
    function close() {
      clearTimeout(timer)
      dismissed = true
      setOpen(null)
    }
    closeRef.current = close
    function evaluate() {
      if (panelInteraction || dismissed) return
      const host = hostRef.current, sel = window.getSelection()
      if (!host || !sel || sel.isCollapsed || !sel.rangeCount || inPanel(sel.anchorNode)) return
      const range = sel.getRangeAt(0)
      const picked = pickSelection(range, host)
      if (!picked) return
      if (lastRange && lastText === picked.text && lastRange.startContainer === range.startContainer && lastRange.startOffset === range.startOffset && lastRange.endContainer === range.endContainer && lastRange.endOffset === range.endOffset) return
      lastRange = range.cloneRange(); lastText = picked.text
      setOpen({ picked, key: ++sequence })
    }
    function selectionChange() {
      if (panelInteraction || inPanel(window.getSelection()?.anchorNode ?? null)) return
      clearTimeout(timer)
      if (window.getSelection()?.isCollapsed) { lastRange = null; lastText = '' }
      timer = setTimeout(evaluate, 250)
    }
    function pointerDown(e: PointerEvent) {
      panelInteraction = inPanel(e.target)
      if (panelInteraction) return
      close()
      // A new gesture may intentionally select the same word again.
      dismissed = false
    }
    function pointerUp() {
      // Keep panel-origin selectioncollapse events isolated through this gesture.
      if (!panelInteraction) selectionChange()
    }
    function scroll(e: Event) { if (!inPanel(e.target)) close() }
    function keyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return }
      if (inPanel(e.target)) { panelInteraction = true; return }
      if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        panelInteraction = false; dismissed = false; lastRange = null
      }
    }
    document.addEventListener('selectionchange', selectionChange)
    document.addEventListener('pointerdown', pointerDown)
    document.addEventListener('pointerup', pointerUp)
    document.addEventListener('keydown', keyDown)
    document.addEventListener('scroll', scroll, { capture: true, passive: true })
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', selectionChange)
      document.removeEventListener('pointerdown', pointerDown)
      document.removeEventListener('pointerup', pointerUp)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('scroll', scroll, true)
    }
  }, [])

  return <>
    <div ref={hostRef}>{children}</div>
    {open && <div ref={panelRef} data-reader-panel role="dialog" aria-modal="false" aria-label={open.picked.isWord ? `${open.picked.text} 的释义` : '选中内容的翻译'}
      className="fixed inset-x-3 z-50 mx-auto max-w-3xl rounded-lg border border-rule bg-card text-ink shadow-lg"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
      <SelectionPanel key={open.key} picked={open.picked} close={() => closeRef.current()} />
    </div>}
  </>
}

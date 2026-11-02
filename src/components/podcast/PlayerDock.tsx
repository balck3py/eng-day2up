'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { PodcastPlayer } from '@/lib/podcast/player'

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PlayerDock({ controller, hasCues, hasAudio, hasChinese, showChinese, onChineseChange, onHeight }: {
  controller: PodcastPlayer; hasCues: boolean; hasAudio: boolean; hasChinese: boolean; showChinese: boolean
  onChineseChange: (show: boolean) => void; onHeight: (height: number) => void
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const [expanded, setExpanded] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const foldRef = useRef<HTMLButtonElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  const focusAfterToggle = useRef(false)
  const id = useId()
  useEffect(() => {
    if (focusAfterToggle.current) {
      (expanded ? foldRef.current : expandRef.current)?.focus({ preventScroll: true })
      focusAfterToggle.current = false
    }
    if (!expanded || !panelRef.current) return
    const panel = panelRef.current
    const observer = new ResizeObserver(() => onHeight(panel.getBoundingClientRect().height))
    observer.observe(panel)
    onHeight(panel.getBoundingClientRect().height)
    return () => observer.disconnect()
  }, [expanded, onHeight])
  const busy = state.status === 'playing' || state.status === 'loading'
  function toggle() { focusAfterToggle.current = true; setExpanded((value) => !value) }
  return <aside data-player-dock data-selection-ignore aria-label="播客播放控制" className="pointer-events-none fixed inset-x-3 z-40 mx-auto max-w-[720px]" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
    {expanded ? <div ref={panelRef} id={id} className="pointer-events-auto overflow-y-auto overscroll-contain rounded-xl border border-rule bg-card p-3 shadow-[0_4px_24px_rgba(20,33,61,0.12)]" style={{ maxHeight: 'min(50dvh, 22rem)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="播放模式" value={state.mode} onChange={(e) => controller.setMode(e.target.value as 'sentence' | 'continuous')} className="min-h-11 rounded-lg border border-rule bg-card px-2 text-sm">
          <option value="sentence" disabled={!hasCues}>单句</option><option value="continuous">连续</option>
        </select>
        <button type="button" onClick={() => controller.toggle()} disabled={!hasAudio || (state.mode === 'sentence' && !hasCues)} aria-label={busy ? '暂停播客' : '继续播放播客'} className="min-h-11 min-w-16 rounded-lg bg-ink px-4 text-sm font-medium text-card disabled:opacity-50">{busy ? '暂停' : '播放'}</button>
        <button type="button" onClick={() => controller.fromStart()} disabled={!hasAudio} className="min-h-11 rounded-lg px-2 text-sm text-ink-2 hover:bg-paper">从头播放</button>
        <button ref={foldRef} type="button" aria-label="折叠播放器" aria-expanded={true} aria-controls={id} onClick={toggle} className="ml-auto size-11 shrink-0 rounded-lg text-ink-3 hover:bg-paper">⌄</button>
      </div>
      <div className="mt-1 flex min-h-11 flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        <span aria-label="播放进度" className="tabular-nums">{clock(state.time)} / {clock(state.duration)}{state.status === 'loading' && ' · 缓冲中…'}</span>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showChinese && hasChinese} disabled={!hasChinese} onChange={(e) => onChineseChange(e.target.checked)} />显示中文</label>
      </div>
      <div className="flex min-h-11 items-center gap-3 border-t border-rule pt-2 text-xs text-ink-3">
        <label htmlFor={`${id}-rate`} className="shrink-0">速度</label>
        <input id={`${id}-rate`} aria-label="播放速度" aria-valuetext={`${state.rate.toFixed(2)} 倍`} type="range" min="0.5" max="1.2" step="0.05" value={state.rate} onChange={(e) => controller.setRate(Number(e.target.value))} className="h-11 min-w-0 flex-1 accent-ink" />
        <output htmlFor={`${id}-rate`} className="w-11 text-right text-sm tabular-nums text-ink">{state.rate.toFixed(2)}×</output>
        <button type="button" aria-label="恢复正常速度" onClick={() => controller.setRate(1)} className="min-h-11 shrink-0 rounded-lg px-1 hover:bg-paper">重置</button>
      </div>
      {state.error && <p role="alert" className="mt-2 text-xs text-seal">{state.error} <button type="button" onClick={() => controller.toggle()} className="min-h-11 underline">重试播放</button></p>}
    </div> : <div className="flex justify-end"><span id={id} hidden /><button ref={expandRef} type="button" aria-label="展开播放器" aria-expanded={false} aria-controls={id} onClick={toggle} className="pointer-events-auto size-11 rounded-xl border border-rule bg-card text-ink shadow-md">⌃</button></div>}
  </aside>
}

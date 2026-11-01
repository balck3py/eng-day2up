'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ReaderSelection } from '@/components/reader/ReaderSelection'
import { PodcastPlayer } from '@/lib/podcast/player'
import { SubtitleGesture } from '@/lib/podcast/gesture'
import { episodeDate, type EpisodeDetail } from '@/lib/podcast/types'
import { usePodcastData } from './usePodcastData'

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function Playback({ controller, hasCues }: { controller: PodcastPlayer; hasCues: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const busy = state.status === 'playing' || state.status === 'loading'
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-card p-3 text-sm" data-selection-ignore>
      <label className="flex items-center gap-2">模式
        <select aria-label="播放模式" value={state.mode} onChange={(e) => controller.setMode(e.target.value as 'sentence' | 'continuous')} className="rounded border border-rule bg-card p-1">
          <option value="sentence" disabled={!hasCues}>单句</option><option value="continuous">连续</option>
        </select>
      </label>
      <button type="button" onClick={() => controller.fromStart()} className="rounded border border-rule px-3 py-1.5">从头播放</button>
      <button type="button" onClick={() => controller.toggle()} disabled={state.mode === 'sentence' && !hasCues} aria-label={busy ? '暂停播客' : '继续播放播客'} className="rounded bg-ink px-3 py-1.5 text-card disabled:opacity-50">{busy ? '暂停' : '播放'}</button>
      <span className="font-mono text-xs text-ink-3" aria-label="播放进度">{clock(state.time)} / {clock(state.duration)}</span>
      {state.status === 'loading' && <span className="text-xs text-ink-3">缓冲中…</span>}
      {state.error && <p role="alert" className="w-full text-seal">{state.error} <button type="button" onClick={() => controller.toggle()} className="underline">重试播放</button></p>}
    </div>
  )
}

function Transcript({ detail, controller, showChinese }: { detail: EpisodeDetail; controller: PodcastPlayer | null; showChinese: boolean }) {
  const empty = useRef({ activeId: null })
  const state = useSyncExternalStore<{ activeId: string | null }>(controller?.subscribe ?? (() => () => {}), controller?.snapshot ?? (() => empty.current), () => empty.current)
  const gesture = useRef(new SubtitleGesture())
  useEffect(() => {
    const block = () => { if (!window.getSelection()?.isCollapsed) gesture.current.block() }
    const scroll = () => gesture.current.block()
    document.addEventListener('selectionchange', block)
    document.addEventListener('scroll', scroll, true)
    return () => { document.removeEventListener('selectionchange', block); document.removeEventListener('scroll', scroll, true) }
  }, [])
  return (
    <ol className="mt-5 space-y-1" aria-label="节目字幕"
      onPointerDown={(e) => gesture.current.start(e.clientX, e.clientY, !!window.getSelection()?.toString())}
      onPointerMove={(e) => gesture.current.move(e.clientX, e.clientY)}
      onPointerCancel={() => gesture.current.block()}>
      {detail.cues.map((cue) => {
        const speaker = cue.text.match(/^([^:\n]{1,30}:)\s*/)?.[0] ?? ''
        return (
          <li key={cue.id}>
            <div role="button" tabIndex={controller ? 0 : -1} aria-disabled={!controller} aria-label={`播放字幕 ${clock(cue.startMs / 1000)}`} aria-current={state.activeId === cue.id ? 'true' : undefined}
              onClick={() => { if (gesture.current.allowClick(!!window.getSelection()?.toString())) controller?.select(cue) }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey && !window.getSelection()?.toString()) { e.preventDefault(); controller?.select(cue) } }}
              className={`cursor-pointer select-text rounded-lg border-l-2 px-3 py-3 transition-colors ${state.activeId === cue.id ? 'border-focus bg-focus/5' : 'border-transparent hover:bg-card'}`}>
              <span data-selection-ignore className="mb-1 block font-mono text-[0.6875rem] text-ink-3">{clock(cue.startMs / 1000)}{speaker && ` · ${speaker.trim().replace(/:$/, '')}`}</span>
              <p data-selection-english className="whitespace-pre-wrap break-words text-base leading-[1.8]">{cue.text.slice(speaker.length)}</p>
              {showChinese && cue.chineseText && <p data-selection-ignore lang="zh-CN" className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-3">{cue.chineseText}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function EpisodeContent({ detail, reload }: { detail: EpisodeDetail; reload: () => void }) {
  const [showChinese, setShowChinese] = useState(true)
  const [controller, setController] = useState<PodcastPlayer | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const { episode, cues } = detail
  useEffect(() => {
    if (!audioRef.current) return
    const player = new PodcastPlayer(audioRef.current, cues)
    if (!cues.length) player.setMode('continuous')
    setController(player)
    const hidden = () => { if (document.hidden) player.hidden() }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); player.dispose() }
  }, [episode.audio, cues])
  const hasChinese = cues.some((cue) => !!cue.chineseText)
  return (
    <ReaderSelection>
      <header className="mb-5"><h1 className="break-words text-2xl font-semibold leading-snug">{episode.title}</h1><p className="mt-2 text-xs text-ink-3">{episodeDate(episode.publishedAt)}</p></header>
      {episode.audio ? <audio ref={audioRef} src={episode.audio} preload="metadata" /> : <p className="my-3 text-sm text-seal">本期音频不可用，可继续阅读字幕。</p>}
      {controller && <Playback controller={controller} hasCues={!!cues.length} />}
      <div data-selection-ignore className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={showChinese && hasChinese} disabled={!hasChinese} onChange={(e) => setShowChinese(e.target.checked)} />显示中文</label>
        <span className="text-xs text-ink-3">点击字幕收听，长按或选中英文自动翻译。</span>
      </div>
      {(detail.englishError || detail.chineseError) && <div data-selection-ignore className="mt-3 text-xs text-ink-3">
        {detail.englishError && <p>{detail.englishError}</p>}{detail.chineseError && <p>{detail.chineseError}</p>}
        {(episode.english || episode.chinese) && <button onClick={reload} className="mt-1 underline">重新加载字幕</button>}
      </div>}
      <Transcript detail={detail} controller={controller} showChinese={showChinese} />
    </ReaderSelection>
  )
}

export function PodcastDetail({ episodeId }: { episodeId: string }) {
  const { data, error, loading, reload } = usePodcastData<EpisodeDetail>(`/api/podcast/${encodeURIComponent(episodeId)}`)
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
      <Link href="/podcast" className="mb-5 inline-block text-sm text-ink-3 hover:text-ink">← 播客列表</Link>
      {loading && <p className="mb-3 text-sm text-ink-3">加载节目中…</p>}
      {error && <p role="alert" className="mb-3 text-sm text-seal">{error} <button onClick={() => void reload()} className="underline">重试</button></p>}
      {data && <EpisodeContent detail={data} reload={() => void reload()} />}
    </main>
  )
}

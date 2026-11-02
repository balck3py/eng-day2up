'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ReaderSelection } from '@/components/reader/ReaderSelection'
import { PodcastPlayer } from '@/lib/podcast/player'
import { SubtitleGesture } from '@/lib/podcast/gesture'
import { episodeDate, type EpisodeDetail } from '@/lib/podcast/types'
import { programPath, type Program } from '@/lib/podcast/programs'
import { PlayerDock } from './PlayerDock'
import { usePodcastData } from './usePodcastData'

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
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
              className={`cursor-pointer select-text text-ink rounded-lg border-l-2 px-3 py-3 transition-colors motion-reduce:transition-none ${state.activeId === cue.id ? 'border-focus bg-focus/5' : 'border-transparent hover:bg-card'}`}>
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
  const contentRef = useRef<HTMLDivElement>(null)
  const onHeight = useCallback((height: number) => contentRef.current?.style.setProperty('--player-dock-height', `${height + 32}px`), [])
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
    <div ref={contentRef} style={{ paddingBottom: 'var(--player-dock-height, 240px)' }}><ReaderSelection>
      <header className="mb-5"><h1 className="break-words text-2xl font-semibold leading-snug">{episode.title}</h1><p className="mt-2 text-xs text-ink-3">{episodeDate(episode.publishedAt)}</p></header>
      <audio ref={audioRef} src={episode.audio ?? undefined} preload="metadata" />
      {!episode.audio && <p className="my-3 text-sm text-seal">本期音频不可用，可继续阅读字幕。</p>}
      {controller && <PlayerDock controller={controller} hasAudio={!!episode.audio} hasCues={!!cues.length} hasChinese={hasChinese} showChinese={showChinese} onChineseChange={setShowChinese} onHeight={onHeight} />}
      <p data-selection-ignore className="mt-4 text-xs text-ink-3">点击字幕收听，长按或选中英文自动翻译。</p>
      {(detail.englishError || detail.chineseError) && <div data-selection-ignore className="mt-3 text-xs text-ink-3">
        {detail.englishError && <p>{detail.englishError}</p>}{detail.chineseError && <p>{detail.chineseError}</p>}
        {(episode.english || episode.chinese) && <button onClick={reload} className="mt-1 underline">重新加载字幕</button>}
      </div>}
      <Transcript detail={detail} controller={episode.audio ? controller : null} showChinese={showChinese} />
    </ReaderSelection></div>
  )
}

export function PodcastDetail({ episodeId, program }: { episodeId: string; program: Program }) {
  const { data, error, loading, reload } = usePodcastData<EpisodeDetail>(`/api/podcast/shows/${program.id}/${encodeURIComponent(episodeId)}`)
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
      <Link href={programPath(program.id)} className="mb-5 inline-block text-sm text-ink-3 hover:text-ink">← 剧集列表</Link>
      {loading && <p className="mb-3 text-sm text-ink-3">加载节目中…</p>}
      {error && <p role="alert" className="mb-3 text-sm text-seal">{error} <button onClick={() => void reload()} className="underline">重试</button></p>}
      {data && <EpisodeContent detail={data} reload={() => void reload()} />}
    </main>
  )
}

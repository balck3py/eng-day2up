'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ReaderSelection } from '@/components/reader/ReaderSelection'
import { PodcastPlayer } from '@/lib/podcast/player'
import { SubtitleGesture } from '@/lib/podcast/gesture'
import { episodeDate, type EpisodeDetail } from '@/lib/podcast/types'
import { programPath, type Program } from '@/lib/podcast/programs'
import { PlayerDock } from './PlayerDock'
import { usePodcastData } from './usePodcastData'
import { usePodcastWords } from './usePodcastWords'
import { subtitleText, type WordAlignment, type WordTiming } from '@/lib/podcast/words'

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function EnglishWords({ text, words, selected }: { text: string; words?: readonly WordTiming[]; selected?: number }) {
  if (!words?.length) return text
  return Array.from(text.matchAll(/\s+|\S+/gu)).map((match) => {
    if (/^\s/u.test(match[0])) return match[0]
    let index = words.findIndex((word) => word.startOffset === match.index)
    if (index < 0 && /^[^\p{L}\p{N}]+$/u.test(match[0])) index = Math.max(0, words.findLastIndex((word) => word.endOffset <= match.index))
    if (index < 0) return match[0]
    return <span key={match.index} data-word-index={index} className={`rounded-sm hover:underline hover:decoration-focus/50 ${selected === index ? 'outline-2 outline-offset-2 outline-focus' : ''}`}>{match[0]}</span>
  })
}

function Transcript({ detail, controller, showChinese, alignment }: { detail: EpisodeDetail; controller: PodcastPlayer | null; showChinese: boolean; alignment: WordAlignment }) {
  // Subscribe only to the active sentence; media time updates must not re-render every word.
  const activeId = useSyncExternalStore(controller?.subscribe ?? (() => () => {}), () => controller?.snapshot().activeId ?? null, () => null)
  const [cursor, setCursor] = useState<{ cueId: string; index: number } | null>(null)
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
        const { speaker, body } = subtitleText(cue.text)
        const timed = alignment.get(cue.id)
        const selected = cursor?.cueId === cue.id && timed?.words[cursor.index] ? cursor.index : undefined
        const selectedWord = selected === undefined ? null : timed!.words[selected]
        return (
          <li key={cue.id}>
            <div role="button" tabIndex={controller ? 0 : -1} aria-disabled={!controller} aria-label={`播放字幕 ${clock(cue.startMs / 1000)}${selectedWord ? `，定位词 ${body.slice(selectedWord.startOffset, selectedWord.endOffset)}` : ''}`} aria-describedby={timed ? 'podcast-word-help' : undefined} aria-current={activeId === cue.id ? 'true' : undefined}
              onClick={(e) => {
                if (!gesture.current.allowClick(!!window.getSelection()?.toString())) return
                const word = (e.target as Element).closest<HTMLElement>('[data-word-index]')
                controller?.select(cue, word ? Number(word.dataset.wordIndex) : undefined)
              }}
              onBlur={() => setCursor(null)}
              onKeyDown={(e) => {
                if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || window.getSelection()?.toString()) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); controller?.select(cue, selected); return }
                if (e.key === 'Escape') { setCursor(null); return }
                if (!timed || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
                e.preventDefault()
                const last = timed.words.length - 1
                const index = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? Math.min(last, selected === undefined ? 0 : selected + 1) : Math.max(0, selected === undefined ? last : selected - 1)
                setCursor({ cueId: cue.id, index })
              }}
              className={`cursor-pointer select-text text-ink rounded-lg border-l-2 px-3 py-3 transition-colors motion-reduce:transition-none ${activeId === cue.id ? 'border-focus bg-focus/5' : 'border-transparent hover:bg-card'}`}>
              <span data-selection-ignore className="mb-1 block font-mono text-[0.6875rem] text-ink-3">{clock(cue.startMs / 1000)}{speaker && ` · ${speaker}`}</span>
              <p data-selection-english className="whitespace-pre-wrap break-words text-base leading-[1.8]"><EnglishWords text={body} words={timed?.words} selected={selected} /></p>
              {showChinese && cue.chineseText && <p data-selection-ignore lang="zh-CN" className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-3">{cue.chineseText}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function EpisodeContent({ detail, reload, programId }: { detail: EpisodeDetail; reload: () => void; programId: string }) {
  const [showChinese, setShowChinese] = useState(true)
  const [controller, setController] = useState<PodcastPlayer | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const onHeight = useCallback((height: number) => contentRef.current?.style.setProperty('--player-dock-height', `${height + 32}px`), [])
  const { episode, cues } = detail
  const words = usePodcastWords(detail, programId)
  useLayoutEffect(() => { controller?.setWordTimings(words.alignment) }, [controller, words.alignment])
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
      <p id="podcast-word-help" data-selection-ignore className="mt-4 text-xs text-ink-3">{words.alignment.size ? <>轻点英文词从该词收听，长按或选中英文自动翻译。<span className="sr-only sm:not-sr-only">键盘聚焦字幕后用左右键定位词、回车播放，Esc 恢复整句。</span></> : '点击字幕收听，长按或选中英文自动翻译。'}</p>
      {(words.error || words.partial) && <p data-selection-ignore className="mt-2 text-xs text-ink-3">{words.error ?? '部分逐词定位不可用，相关字幕仍可整句收听。'} <button type="button" onClick={words.error?.includes('声明已更新') ? reload : words.retry} className="underline">{words.error?.includes('声明已更新') ? '重新加载节目字幕' : '重试逐词字幕'}</button></p>}
      {(detail.englishError || detail.chineseError) && <div data-selection-ignore className="mt-3 text-xs text-ink-3">
        {detail.englishError && <p>{detail.englishError}</p>}{detail.chineseError && <p>{detail.chineseError}</p>}
        {(episode.english || episode.chinese) && <button onClick={reload} className="mt-1 underline">重新加载字幕</button>}
      </div>}
      <Transcript detail={detail} controller={episode.audio ? controller : null} showChinese={showChinese} alignment={words.alignment} />
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
      {data && <EpisodeContent detail={data} reload={() => void reload()} programId={program.id} />}
    </main>
  )
}

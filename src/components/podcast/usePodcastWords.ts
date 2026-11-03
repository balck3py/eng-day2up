'use client'

import { useEffect, useMemo, useState } from 'react'
import type { EpisodeDetail, WordTrack } from '@/lib/podcast/types'
import { alignWords, type WordAlignment } from '@/lib/podcast/words'

const EMPTY: WordAlignment = new Map()
interface Result { key: object; data?: WordTrack; error?: string }

/** Enhancement state stays separate so the detail's cues/audio instance remain stable. */
export function usePodcastWords(detail: EpisodeDetail, programId: string) {
  const source = detail.cues.length ? detail.episode.englishWords : null
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  // A deliberate primary subtitle reload also refetches a track overwritten at the same URL.
  const key = useMemo(() => ({ programId, detail, source, attempt }), [programId, detail, source, attempt])
  const id = detail.episode.id
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/podcast/shows/${encodeURIComponent(programId)}/${encodeURIComponent(id)}/words`, { cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? '逐词字幕加载失败，请重试')
        if (body.sourceUrl !== source) throw new Error('逐词字幕声明已更新，请重新加载节目字幕')
        if (!Array.isArray(body.cues) || !body.cues.length || !body.cues.every((cue: WordTrack['cues'][number]) =>
          cue && typeof cue.id === 'string' && typeof cue.text === 'string' && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.startMs >= 0 && cue.endMs > cue.startMs)) {
          throw new Error('逐词字幕格式无效，可继续整句收听')
        }
        if (!controller.signal.aborted) setResult({ key, data: body })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '逐词字幕加载失败，请重试' })
      }
    })()
    return () => controller.abort()
  }, [key, source, id, programId])
  const current = result?.key === key ? result : null
  const data = current?.data
  const alignment = useMemo(() => data ? alignWords(detail.cues, data.cues) : EMPTY, [detail.cues, data])
  return {
    alignment,
    error: current?.error ?? null,
    partial: !!data && alignment.size < detail.cues.length,
    retry: () => setAttempt((value) => value + 1),
  }
}

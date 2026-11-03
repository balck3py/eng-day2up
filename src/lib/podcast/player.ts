import { cueAt } from './srt'
import type { Cue } from './types'
import { normalizeRate, savedRate, saveRate } from './rate'
import type { WordAlignment } from './words'

interface PlaybackTarget { id: string; startMs: number; endMs: number }

export type PlaybackMode = 'sentence' | 'continuous'
export interface PlayerState {
  mode: PlaybackMode
  rate: number
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  time: number
  duration: number
  activeId: string | null
  error: string | null
}

/** One controller owns one media element; presentation changes never replace it. */
export class PodcastPlayer {
  private state: PlayerState = { mode: 'sentence', rate: 1, status: 'idle', time: 0, duration: 0, activeId: null, error: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private target: PlaybackTarget | undefined
  private alignment: WordAlignment = new Map()
  private pendingSeek: number | null = null
  private wantsPlay = false
  private disposed = false
  private timer: ReturnType<typeof setInterval>
  private handlers: Record<string, () => void>

  constructor(private audio: HTMLAudioElement, private cues: Cue[]) {
    this.state = { ...this.state, rate: savedRate() }
    this.applyRate()
    this.handlers = {
      loadedmetadata: () => { this.applyRate(); this.applySeek(); this.tick() },
      ratechange: () => this.applyRate(),
      durationchange: () => this.tick(),
      timeupdate: () => this.tick(),
      seeked: () => this.tick(),
      playing: () => { if (this.wantsPlay) this.patch({ status: 'playing', error: null }) },
      waiting: () => { if (this.wantsPlay) this.patch({ status: 'loading' }) },
      pause: () => {
        // Ignore an old queued pause event after a newer play has already started.
        if (!this.audio.paused) return
        this.wantsPlay = false
        ++this.generation
        if (!this.disposed && this.state.status !== 'error' && this.state.status !== 'ended') this.patch({ status: 'paused' })
      },
      ended: () => { this.wantsPlay = false; this.patch({ status: 'ended' }) },
      error: () => { ++this.generation; this.wantsPlay = false; this.audio.pause(); this.patch({ status: 'error', error: '音频加载失败，请重试' }) },
    }
    Object.entries(this.handlers).forEach(([type, handler]) => audio.addEventListener(type, handler))
    this.timer = setInterval(() => this.tick(), 25)
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.state
  /** New timings affect future selections, never the current playback snapshot. */
  setWordTimings(alignment: WordAlignment) {
    if (this.disposed) return
    this.alignment = alignment
  }
  private range(cue: Cue): PlaybackTarget {
    const timed = this.alignment.get(cue.id)
    return { id: cue.id, startMs: timed?.startMs ?? cue.startMs, endMs: timed?.endMs ?? cue.endMs }
  }
  private activeCue(timeMs: number) {
    if (this.state.mode === 'sentence' && this.target && timeMs >= this.target.startMs && timeMs < this.target.endMs) {
      return this.cues.find((cue) => cue.id === this.target!.id)
    }
    // A verified word range takes precedence over an overlapping old sentence range.
    const timed = this.cues.findLast((cue) => {
      const range = this.alignment.get(cue.id)
      return range && range.startMs <= timeMs && range.endMs > timeMs
    })
    return timed ?? cueAt(this.cues.filter((cue) => !this.alignment.has(cue.id)), timeMs)
  }
  private patch(patch: Partial<PlayerState>) {
    if (this.disposed) return
    const next = { ...this.state, ...patch }
    if (Object.keys(next).every((key) => next[key as keyof PlayerState] === this.state[key as keyof PlayerState])) return
    this.state = next
    this.listeners.forEach((listener) => listener())
  }
  private applyRate() {
    if (this.audio.playbackRate !== this.state.rate) this.audio.playbackRate = this.state.rate
    if ('preservesPitch' in this.audio) this.audio.preservesPitch = true
  }
  setRate(value: number) {
    const rate = normalizeRate(value)
    this.patch({ rate })
    this.applyRate()
    saveRate(rate)
  }
  private applySeek() {
    if (this.pendingSeek === null || this.audio.readyState === 0) return
    const duration = this.audio.duration
    if (Number.isFinite(duration) && this.pendingSeek >= duration) {
      this.pendingSeek = null
      this.pause()
      this.patch({ status: 'error', error: '该字幕起点超出音频时长' })
      return
    }
    this.audio.currentTime = this.pendingSeek
    this.pendingSeek = null
  }
  private tick() {
    if (this.disposed) return
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0
    if (this.pendingSeek === null && !this.audio.seeking && this.state.mode === 'sentence' && this.target && this.wantsPlay) {
      const end = Math.min(this.target.endMs / 1000, duration || Infinity)
      if (this.audio.currentTime >= end) {
        this.pause()
      }
    }
    this.patch({ time: this.audio.currentTime, duration, activeId: this.activeCue(this.audio.currentTime * 1000)?.id ?? null })
  }
  private play() {
    const generation = ++this.generation
    this.wantsPlay = true
    this.patch({ status: 'loading', error: null })
    if (this.audio.error) {
      this.pendingSeek ??= this.state.mode === 'sentence' && this.target ? this.target.startMs / 1000 : this.audio.currentTime
      this.audio.load()
    }
    this.applyRate()
    this.applySeek()
    if (!this.wantsPlay) return
    // Call in the user gesture, even before metadata, to retain mobile playback permission.
    void this.audio.play().then(() => {
      if (!this.disposed && generation === this.generation && this.wantsPlay) this.patch({ status: this.audio.paused ? 'paused' : 'playing' })
    }).catch(() => {
      if (this.disposed || generation !== this.generation) return
      this.wantsPlay = false
      this.patch({ status: 'error', error: '无法播放音频，请点击重试' })
    })
  }
  select(cue: Cue, wordIndex?: number) {
    this.audio.pause()
    const word = wordIndex === undefined ? undefined : this.alignment.get(cue.id)?.words[wordIndex]
    this.target = { ...this.range(cue), ...(word ? { startMs: word.startMs } : {}) }
    this.pendingSeek = this.target.startMs / 1000
    this.play()
  }
  fromStart() {
    this.patch({ mode: 'continuous' })
    this.target = undefined
    this.pendingSeek = 0
    this.play()
  }
  pause() {
    ++this.generation
    this.wantsPlay = false
    this.audio.pause()
    this.patch({ status: 'paused' })
  }
  toggle() {
    if (this.wantsPlay) return this.pause()
    if (this.state.mode === 'sentence') {
      if (!this.target) {
        const cue = this.activeCue(this.audio.currentTime * 1000) ?? this.cues[0]
        if (cue) this.target = this.range(cue)
      }
      if (!this.target) return
      if (this.audio.currentTime >= this.target.endMs / 1000 || this.audio.currentTime < this.target.startMs / 1000) {
        this.pendingSeek = this.target.startMs / 1000
      }
    } else if (this.audio.ended) this.pendingSeek = 0
    this.play()
  }
  setMode(mode: PlaybackMode) {
    if (mode === this.state.mode) return
    const cue = mode === 'sentence' ? this.activeCue(this.audio.currentTime * 1000) : undefined
    this.patch({ mode })
    if (mode === 'sentence') {
      this.target = cue ? this.range(cue) : undefined
      if (!this.target) this.pause()
    } else this.target = undefined
  }
  hidden() { if (this.state.mode === 'sentence') this.pause() }
  dispose() {
    this.disposed = true
    ++this.generation
    this.wantsPlay = false
    clearInterval(this.timer)
    Object.entries(this.handlers).forEach(([type, handler]) => this.audio.removeEventListener(type, handler))
    this.audio.pause()
    this.listeners.clear()
  }
}

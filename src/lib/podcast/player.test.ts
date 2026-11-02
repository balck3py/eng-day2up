import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { PodcastPlayer } from './player'
import { SubtitleGesture } from './gesture'
class Media extends EventTarget {
  playbackRate = 1
  currentTime = 0
  duration = 20
  readyState = 1
  seeking = false
  paused = true
  ended = false
  error = null
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('playing')) })
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')) })
  load = vi.fn()
}
const cues = [{ id: 'a', startMs: 1000, endMs: 2000, text: 'One' }, { id: 'b', startMs: 2200, endMs: 4000, text: 'Two' }]
let audio: Media, player: PodcastPlayer
beforeEach(() => { vi.useFakeTimers(); audio = new Media(); player = new PodcastPlayer(audio as unknown as HTMLAudioElement, cues) })
afterEach(() => { player.dispose(); vi.useRealTimers() })
function tick(time: number) { audio.currentTime = time; vi.advanceTimersByTime(25) }
describe('podcast playback modes', () => {
  it('starts idle, repeats a sentence and stops at its boundary', async () => {
    expect(audio.play).not.toHaveBeenCalled()
    player.select(cues[0]); await Promise.resolve()
    expect(audio.currentTime).toBe(1)
    tick(2.02)
    expect(audio.paused).toBe(true)
    expect(audio.currentTime).toBeCloseTo(2.02)
    player.select(cues[0]); await Promise.resolve()
    expect(audio.currentTime).toBe(1)
    tick(1.4); player.pause(); player.toggle(); await Promise.resolve()
    expect(audio.currentTime).toBe(1.4)
    tick(2); player.toggle()
    expect(audio.currentTime).toBe(1)
  })
  it('continuous mode survives pause and subtitle clicks, with no sentence stop', async () => {
    player.fromStart(); await Promise.resolve(); tick(1.5); player.pause()
    player.select(cues[0]); await Promise.resolve(); tick(2.5)
    expect(audio.paused).toBe(false)
    expect(player.snapshot().mode).toBe('continuous')
    player.select(cues[0]); expect(audio.currentTime).toBe(1)
    audio.dispatchEvent(new Event('ended')); expect(player.snapshot().status).toBe('ended')
  })
  it('switches modes without starting paused media and stops gaps', async () => {
    player.setMode('continuous'); expect(audio.play).not.toHaveBeenCalled()
    player.fromStart(); await Promise.resolve(); tick(1.5); player.setMode('sentence'); tick(2.02)
    expect(audio.paused).toBe(true)
    player.fromStart(); await Promise.resolve(); tick(2.1); player.setMode('sentence')
    expect(audio.paused).toBe(true)
    expect(player.snapshot().activeId).toBeNull()
  })
  it('switching to continuous removes sentence bounds', async () => {
    player.select(cues[0]); await Promise.resolve(); player.setMode('continuous'); tick(3)
    expect(audio.paused).toBe(false)
  })
  it('keeps only the newest metadata target and ignores old play rejections', async () => {
    audio.readyState = 0
    let rejectOld!: (e: Error) => void
    audio.play.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject }))
    player.select(cues[0]); player.select(cues[1]);
    audio.readyState = 1; audio.dispatchEvent(new Event('loadedmetadata'))
    rejectOld(new Error('old')); await Promise.resolve(); await Promise.resolve()
    expect(audio.currentTime).toBe(2.2)
    expect(player.snapshot().status).not.toBe('error')
    tick(4.02); expect(audio.paused).toBe(true)
  })
  it('resumes after native media pause without exiting continuous mode', async () => {
    player.fromStart(); await Promise.resolve(); tick(1.2)
    audio.pause()
    expect(player.snapshot().status).toBe('paused')
    player.toggle(); await Promise.resolve()
    expect(audio.paused).toBe(false)
    expect(player.snapshot().mode).toBe('continuous')
    audio.dispatchEvent(new Event('pause'))
    expect(player.snapshot().status).toBe('playing')
  })
  it('handles rejected playback, duration limits, background and disposal', async () => {
    audio.play.mockRejectedValueOnce(new Error('blocked'))
    player.select(cues[0]); await Promise.resolve(); await Promise.resolve()
    expect(player.snapshot().status).toBe('error')
    player.select(cues[0]); await Promise.resolve(); player.hidden(); expect(audio.paused).toBe(true)
    audio.duration = 0.5; player.select(cues[0]); expect(player.snapshot().error).toContain('超出')
    player.dispose(); expect(audio.paused).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
})
it('suppresses long presses, selection, drag and synthetic clicks', () => {
  const g = new SubtitleGesture()
  g.start(0, 0, false); expect(g.allowClick(false)).toBe(true)
  g.start(0, 0, false); vi.advanceTimersByTime(500); expect(g.allowClick(false)).toBe(false)
  g.start(0, 0, true); expect(g.allowClick(false)).toBe(false)
  g.start(0, 0, false); g.move(20, 0); expect(g.allowClick(false)).toBe(false)
  g.start(0, 0, false); g.block(); expect(g.allowClick(false)).toBe(false)
  expect(g.allowClick(false)).toBe(false)
})

it.each([0.5, 1, 1.2])('keeps SRT boundaries at %sx and preserves rate on replay', async (rate) => {
  player.setRate(rate); player.select(cues[0]); await Promise.resolve()
  expect(audio.playbackRate).toBe(rate)
  tick(1.9); expect(audio.paused).toBe(false)
  player.setRate(0.8)
  expect(audio.currentTime).toBe(1.9)
  tick(2.02); expect(audio.paused).toBe(true)
  player.select(cues[0]); expect(audio.playbackRate).toBe(0.8)
  player.fromStart(); expect(audio.playbackRate).toBe(0.8)
  player.pause(); const plays = audio.play.mock.calls.length
  player.setRate(rate); expect(audio.play.mock.calls).toHaveLength(plays)
  expect(audio.paused).toBe(true)
})

it('reasserts the chosen rate when native loading resets media speed', () => {
  player.setRate(0.8)
  audio.playbackRate = 1
  audio.dispatchEvent(new Event('ratechange'))
  expect(audio.playbackRate).toBe(0.8)
  audio.playbackRate = 1
  audio.dispatchEvent(new Event('loadedmetadata'))
  expect(audio.playbackRate).toBe(0.8)
  expect(player.snapshot().rate).toBe(0.8)
})

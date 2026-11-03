import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { PodcastPlayer } from './player'
import { SubtitleGesture } from './gesture'
import { alignWords } from './words'
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

const wordCue = { id: 'a', startMs: 1000, endMs: 2000, text: 'Go go now.' }
const wordCues = [
  { id: '1', startMs: 159, endMs: 400, text: 'Go' },
  { id: '2', startMs: 1100, endMs: 1400, text: 'go' },
  { id: '3', startMs: 2100, endMs: 2459, text: 'now.' },
]
function withWords() {
  player.dispose()
  player = new PodcastPlayer(audio as unknown as HTMLAudioElement, [wordCue, cues[1]])
  player.setWordTimings(alignWords([wordCue], wordCues))
}

it.each([0.5, 1, 1.2])('plays from a selected word to the last word at %sx without clipping at the old sentence end', async (rate) => {
  withWords(); player.setRate(rate)
  player.select(wordCue, 2); await Promise.resolve()
  expect(audio.currentTime).toBe(2.1)
  tick(2.2); expect(audio.paused).toBe(false)
  expect(player.snapshot().activeId).toBe('a')
  tick(2.47); expect(audio.paused).toBe(true)
  player.toggle(); expect(audio.currentTime).toBe(2.1)
  expect(audio.playbackRate).toBe(rate)
})

it('repeats the selected occurrence, resumes a paused fragment and restarts whole-sentence entries at the first word', async () => {
  withWords()
  player.select(wordCue, 1); await Promise.resolve()
  expect(audio.currentTime).toBe(1.1)
  tick(1.3); player.pause(); player.toggle()
  expect(audio.currentTime).toBe(1.3)
  player.select(wordCue, 1); expect(audio.currentTime).toBe(1.1)
  player.select(wordCue); expect(audio.currentTime).toBe(0.159)
  player.select(wordCue, 999); expect(audio.currentTime).toBe(0.159)
})

it('retains continuous mode on a paused word jump and uses word bounds on explicit mode changes', async () => {
  withWords(); player.fromStart(); await Promise.resolve(); player.pause()
  player.select(wordCue, 2); await Promise.resolve(); tick(2.7)
  expect(audio.paused).toBe(false); expect(player.snapshot().mode).toBe('continuous')
  player.select(wordCue, 1); await Promise.resolve(); tick(1.8); player.setMode('sentence')
  tick(2.3); expect(audio.paused).toBe(false)
  tick(2.47); expect(audio.paused).toBe(true)
  player.setMode('continuous'); expect(audio.paused).toBe(true)
})

it('does not change an in-flight target when timings arrive and highlights early words by their owning sentence', async () => {
  player.select(cues[0]); await Promise.resolve(); tick(1.8)
  const plays = audio.play.mock.calls.length, pauses = audio.pause.mock.calls.length
  player.setWordTimings(alignWords([wordCue], wordCues))
  expect(audio.currentTime).toBe(1.8)
  expect(audio.play).toHaveBeenCalledTimes(plays); expect(audio.pause).toHaveBeenCalledTimes(pauses)
  tick(2.02); expect(audio.paused).toBe(true) // Original selected snapshot ends at 2.0.
  player.select(cues[0]); expect(audio.currentTime).toBe(0.159)
  tick(0.2); expect(player.snapshot().activeId).toBe('a')
})

it('keeps only the latest word seek before metadata and checks media duration', async () => {
  withWords(); audio.readyState = 0
  let reject!: (reason: Error) => void
  audio.play.mockImplementationOnce(() => new Promise((_, r) => { reject = r }))
  player.select(wordCue, 0); player.select(wordCue, 2)
  audio.readyState = 1; audio.dispatchEvent(new Event('loadedmetadata'))
  reject(new Error('old')); await Promise.resolve(); await Promise.resolve()
  expect(audio.currentTime).toBe(2.1); expect(player.snapshot().status).not.toBe('error')
  audio.duration = 2; player.select(wordCue, 2)
  expect(player.snapshot().error).toContain('超出')
})

it('selects the actual timed sentence when switching out of continuous mode after enrichment', async () => {
  player.fromStart(); player.select(cues[0]); await Promise.resolve(); tick(1.8)
  player.setWordTimings(alignWords(cues, [
    { id: 'one', startMs: 1000, endMs: 1400, text: 'One' },
    { id: 'two', startMs: 1500, endMs: 2500, text: 'Two' },
  ]))
  player.setMode('sentence'); tick(2.2)
  expect(audio.paused).toBe(false)
  expect(player.snapshot().activeId).toBe('b')
  tick(2.51); expect(audio.paused).toBe(true)
})

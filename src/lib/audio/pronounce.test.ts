import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { youdaoUrl, pronounce } from './pronounce'

type PlayBehavior = 'resolve' | 'reject' | 'error-event' | 'hang'

/** 模拟 <audio>：可配置 play() 的结果，以及是否异步触发 error 事件。 */
class FakeAudio {
  static nextBehavior: PlayBehavior = 'resolve'
  static instances: FakeAudio[] = []

  src: string
  private listeners = new Map<string, Set<() => void>>()

  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }

  addEventListener(type: string, cb: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(cb)
  }

  removeEventListener(type: string, cb: () => void) {
    this.listeners.get(type)?.delete(cb)
  }

  dispatch(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb()
  }

  play(): Promise<void> {
    switch (FakeAudio.nextBehavior) {
      case 'resolve':
        return Promise.resolve()
      case 'reject':
        return Promise.reject(new Error('decode failed'))
      case 'error-event':
        // 有道对生僻词返回 JSON：play() 悬而不决，但 error 事件异步触发
        queueMicrotask(() => this.dispatch('error'))
        return new Promise(() => {})
      case 'hang':
        // 网络卡住：play() 永不 settle，只能靠超时兜底
        return new Promise(() => {})
    }
  }
}

class FakeUtterance {
  lang = ''
  constructor(public text: string) {}
}

let fakeSynth: { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> }

beforeEach(() => {
  FakeAudio.nextBehavior = 'resolve'
  FakeAudio.instances = []
  fakeSynth = { cancel: vi.fn(), speak: vi.fn() }
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  ;(globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis = fakeSynth
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis
  vi.useRealTimers()
})

describe('youdaoUrl', () => {
  it('美音用 type=2', () => {
    expect(youdaoUrl('apple', 'us')).toBe(
      'https://dict.youdao.com/dictvoice?audio=apple&type=2',
    )
  })

  it('英音用 type=1', () => {
    expect(youdaoUrl('apple', 'uk')).toBe(
      'https://dict.youdao.com/dictvoice?audio=apple&type=1',
    )
  })

  it('撇号、连字符等常见词形不会破坏 URL 结构', () => {
    expect(youdaoUrl("don't", 'us')).toBe(
      `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent("don't")}&type=2`,
    )
    expect(youdaoUrl('well-known', 'uk')).toBe(
      `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent('well-known')}&type=1`,
    )
  })

  it('对会破坏 query string 的字符做编码（防御性，即使真实词库不太会出现）', () => {
    expect(youdaoUrl('rock&roll', 'us')).toBe(
      'https://dict.youdao.com/dictvoice?audio=rock%26roll&type=2',
    )
  })
})

describe('pronounce', () => {
  it('有道成功时返回 youdao，不触碰本地合成', async () => {
    FakeAudio.nextBehavior = 'resolve'
    const result = await pronounce('apple', 'us')
    expect(result).toBe('youdao')
    expect(fakeSynth.speak).not.toHaveBeenCalled()
  })

  it('play() reject 时降级到本地合成', async () => {
    FakeAudio.nextBehavior = 'reject'
    const result = await pronounce('zzzznotaword', 'us')
    expect(result).toBe('local')
    expect(fakeSynth.cancel).toHaveBeenCalled()
    expect(fakeSynth.speak).toHaveBeenCalledTimes(1)
  })

  it('有道返回 JSON（触发 error 事件）时降级到本地合成', async () => {
    FakeAudio.nextBehavior = 'error-event'
    const result = await pronounce('zzzznotaword', 'us')
    expect(result).toBe('local')
  })

  it('本地合成使用正确的 lang：us → en-US，uk → en-GB', async () => {
    FakeAudio.nextBehavior = 'reject'
    await pronounce('apple', 'us')
    const utterance = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.lang).toBe('en-US')

    fakeSynth.speak.mockClear()
    await pronounce('apple', 'uk')
    const utterance2 = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance2.lang).toBe('en-GB')
  })

  it('有道超时未开播时降级到本地合成，而不是无限等待', async () => {
    vi.useFakeTimers()
    FakeAudio.nextBehavior = 'hang'
    const promise = pronounce('apple', 'us', 50)
    await vi.advanceTimersByTimeAsync(50)
    const result = await promise
    expect(result).toBe('local')
  })

  it('有道失败且本地合成不可用时返回 failed', async () => {
    FakeAudio.nextBehavior = 'reject'
    delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis
    const result = await pronounce('apple', 'us')
    expect(result).toBe('failed')
  })

  it('SSR/无 window 环境下不抛异常，直接走本地合成或 failed', async () => {
    vi.stubGlobal('window', undefined)
    // window 不存在时 speechSynthesis 也无从访问，只能 failed
    const result = await pronounce('apple', 'us')
    expect(result).toBe('failed')
  })

  it('绝不抛异常，即使 Audio 构造函数抛错', async () => {
    vi.stubGlobal(
      'Audio',
      class {
        constructor() {
          throw new Error('boom')
        }
      },
    )
    await expect(pronounce('apple', 'us')).resolves.toBe('local')
  })
})

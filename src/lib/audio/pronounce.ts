/**
 * 单词发音：有道 TTS → 浏览器本地合成（speechSynthesis）降级链。
 *
 * 背景（详见 task-tts-spec.md）：dictionaryapi.dev 的音频 CDN 在部分网络下不可达，
 * 有道 dictvoice 接口延迟低（约 0.13s）且返回标准 mp3，作为主音源；
 * 但有道对它不认识的词会返回 JSON 而非音频，所以必须有能读任意字符串的兜底——
 * 这正是 Web Speech API 的价值。
 *
 * 本文件是纯客户端逻辑，但会被 'use client' 组件导入，Next.js 仍会在服务端
 * 对模块做一次求值，因此所有浏览器 API 的访问都放在函数体内，模块顶层不碰 window。
 */

export type Accent = 'us' | 'uk'

/** 有道 TTS 的 URL。type=2 美音，type=1 英音。 */
export function youdaoUrl(word: string, accent: Accent): string {
  const type = accent === 'us' ? 2 : 1
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`
}

const DEFAULT_TIMEOUT_MS = 3000

/**
 * 尝试用有道音源播放。
 *
 * 有道对不认识的词返回 JSON 而不是音频，这种情况下 <audio> 会触发 `error` 事件
 * （有时 `play()` 的 promise 也会 reject）。任一信号出现即视为失败。
 * 另设超时，避免网络卡住时无限等待。
 *
 * 绝不抛异常——所有失败路径都以 resolve(false) 收尾。
 */
function tryYoudao(
  word: string,
  accent: Accent,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      resolve(false)
      return
    }

    let settled = false
    let audio: HTMLAudioElement
    try {
      audio = new Audio(youdaoUrl(word, accent))
    } catch {
      resolve(false)
      return
    }

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeEventListener('error', onError)
      resolve(ok)
    }

    const onError = () => finish(false)
    audio.addEventListener('error', onError)

    const timer = setTimeout(() => finish(false), timeoutMs)

    audio
      .play()
      .then(() => finish(true))
      .catch(() => finish(false))
  })
}

/**
 * 浏览器本地合成兜底。能读任意字符串，完全离线。
 * 调用前先 cancel 掉上一次未播完的，避免排队堆积。
 * 返回是否成功发起了合成（API 是否可用），不代表用户一定听到了声音
 * （比如系统没装对应语言的语音包），但这是本地合成能给出的最强保证。
 */
function speakLocally(word: string, accent: Accent): boolean {
  if (typeof window === 'undefined') return false
  const synth = window.speechSynthesis
  if (!synth) return false

  try {
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(word)
    utterance.lang = accent === 'us' ? 'en-US' : 'en-GB'
    synth.speak(utterance)
    return true
  } catch {
    return false
  }
}

/**
 * 播放一个词的发音，按 有道 → 浏览器本地合成 的顺序降级。
 * 返回最终用了哪个音源；全部失败返回 'failed'。
 * 绝不抛异常。
 */
export async function pronounce(
  word: string,
  accent: Accent,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<'youdao' | 'local' | 'failed'> {
  const youdaoOk = await tryYoudao(word, accent, timeoutMs)
  if (youdaoOk) return 'youdao'
  if (speakLocally(word, accent)) return 'local'
  return 'failed'
}

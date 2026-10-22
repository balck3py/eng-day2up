import type { HardWord } from '@/lib/hardwords/extract'
import type { Direction, ProviderName } from './types'
import { getLocalModelConfig, streamLocalTranslate } from './localModel'

export interface StreamOutcome {
  provider: ProviderName | 'local' | null
  /** 非空表示出错；已收到的部分译文仍通过 onDelta 交付过了 */
  error: string | null
}

/**
 * 浏览器端流式翻译：配置了本地模型就直连它（覆盖服务端），否则走 /api/translate。
 * provider 一确定就通过 onProvider 回报，好让界面在译文到达前先显示来源。
 */
export async function streamTranslate(
  text: string,
  direction: Direction,
  onDelta: (delta: string) => void,
  onProvider?: (p: ProviderName | 'local' | null) => void,
): Promise<StreamOutcome> {
  const local = getLocalModelConfig()
  let provider: ProviderName | 'local' | null = null
  let error: string | null = null
  try {
    if (local) {
      provider = 'local'
      onProvider?.(provider)
      for await (const delta of streamLocalTranslate(text, direction, local)) onDelta(delta)
      return { provider, error }
    }

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, direction }),
    })
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { provider, error: data.error ?? '翻译失败，请重试。' }
    }
    provider = res.headers.get('X-Provider') as ProviderName | null
    onProvider?.(provider)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        try {
          const evt = JSON.parse(line.slice(5).trim()) as { type: string; value?: string }
          if (evt.type === 'delta') onDelta(evt.value ?? '')
          else if (evt.type === 'error') error = `响应中断：${evt.value}`
        } catch {
          // 单帧解析失败不该毁掉整段译文，跳过继续读
        }
      }
    }
  } catch {
    error = local
      ? '本地模型调用失败，请检查设置里的 Base URL、跨域与混合内容限制。'
      : '网络错误，已保留收到的部分译文。'
  }
  return { provider, error }
}

/** 难词拆解（纯数据库，不耗配额）。失败按「没有难词」处理。 */
export async function fetchHardWords(text: string): Promise<HardWord[]> {
  try {
    const r = await fetch('/api/hard-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!r.ok) return []
    const d = (await r.json()) as { words: HardWord[] }
    return d.words
  } catch {
    return []
  }
}

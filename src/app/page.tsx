'use client'

import { useId, useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from '@/components/WordCard'
import { TranslateResult } from '@/components/TranslateResult'
import type { WordDetail } from '@/lib/dict/types'
import type { HardWord } from '@/lib/hardwords/extract'
import type { Direction, ProviderName } from '@/lib/translate/types'
import { getLocalModelConfig, streamLocalTranslate } from '@/lib/translate/localModel'
import { lookupWordClient } from '@/lib/dict/clientLookup'

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'en2zh', label: '英 → 中' },
  { value: 'zh2en', label: '中 → 英' },
]

export default function HomePage() {
  const inputId = useId()
  const [input, setInput] = useState('')
  const [direction, setDirection] = useState<Direction>('en2zh')
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [translation, setTranslation] = useState('')
  const [provider, setProvider] = useState<ProviderName | 'local' | null>(null)
  const [hardWords, setHardWords] = useState<HardWord[]>([])
  const [source, setSource] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setDetail(null)
    setTranslation('')
    setProvider(null)
    setHardWords([])
    setSource('')
    setError(null)
  }

  async function submit() {
    const text = input.trim()
    if (!text || busy) return
    reset()
    setBusy(true)
    try {
      // 单个英文词走词典，其余走 LLM。中译英不做单词分支——
      // 输入中文词时用户要的是英文说法，那正是翻译。
      if (isSingleWord(text) && direction === 'en2zh') {
        await lookupSingleWord(text)
      } else {
        await translateText(text)
      }
    } finally {
      setBusy(false)
      setStreaming(false)
    }
  }

  async function lookupSingleWord(text: string) {
    // lookupWordClient 内部会按本地模型配置决定是否走浏览器直连兜底
    const result = await lookupWordClient(text)
    if (!result) {
      setError('查询失败，请重试。')
      return
    }
    setDetail(result)
  }

  async function translateText(text: string) {
    setSource(text)
    setStreaming(true)

    // 难词拆解与译文并行发起 —— 前者走数据库，通常先到。
    // 中译英不拆难词：难词拆解只对英文源文本有意义。
    const hardWordsPromise =
      direction === 'zh2en'
        ? Promise.resolve()
        : fetch('/api/hard-words', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then((r) => (r.ok ? r.json() : { words: [] }))
            .then((d: { words: HardWord[] }) => setHardWords(d.words))
            .catch(() => setHardWords([]))

    // 配置了本地模型就由浏览器直连它（覆盖服务端）；否则走默认后端。
    const local = getLocalModelConfig()

    try {
      if (local) {
        setProvider('local')
        for await (const delta of streamLocalTranslate(text, direction, local)) {
          setTranslation((t) => t + delta)
        }
      } else {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, direction }),
        })
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          setError(data.error ?? '翻译失败，请重试。')
          return
        }
        setProvider(res.headers.get('X-Provider') as ProviderName | null)

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
              const evt = JSON.parse(line.slice(5).trim()) as {
                type: string
                value?: string
              }
              if (evt.type === 'delta') setTranslation((t) => t + (evt.value ?? ''))
              else if (evt.type === 'error') setError(`响应中断：${evt.value}`)
            } catch {
              // 单帧解析失败不该毁掉整段译文，跳过继续读
            }
          }
        }
      }
    } catch {
      setError(
        local
          ? '本地模型调用失败，请检查设置里的 Base URL、跨域与混合内容限制。'
          : '网络错误，已保留收到的部分译文。',
      )
    } finally {
      setStreaming(false)
      await hardWordsPromise
    }
  }

  const showResult = source !== '' && (translation !== '' || hardWords.length > 0)

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div
          role="radiogroup"
          aria-label="翻译方向"
          className="flex rounded-[10px] border border-rule bg-card p-0.5"
        >
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              role="radio"
              aria-checked={direction === d.value}
              onClick={() => setDirection(d.value)}
              className={`rounded-[8px] px-3 py-1 text-sm ${
                direction === d.value
                  ? 'bg-ink font-medium text-card'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label htmlFor={inputId} className="sr-only">
          要翻译的单词或段落
        </label>
        <textarea
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 回车翻译，Shift+回车换行（输入法组合中的回车不触发）
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={5}
          placeholder={
            direction === 'en2zh' ? '输入一个英文单词，或一整段英文…' : '输入一段中文…'
          }
          className="w-full rounded-[10px] border border-rule bg-card p-3 text-ink placeholder:text-ink-3 focus:border-focus"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[0.8125rem] text-ink-3">回车翻译 · Shift+回车换行</p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
          >
            {busy ? '处理中…' : '翻译'}
          </button>
        </div>
      </div>

      {error && !translation && !detail && (
        <p className="text-[0.9375rem] text-seal">{error}</p>
      )}
      {detail && <WordCard detail={detail} />}
      {showResult && (
        <TranslateResult
          source={source}
          translation={translation}
          provider={provider}
          hardWords={hardWords}
          streaming={streaming}
          error={error}
        />
      )}
    </main>
  )
}

'use client'

import { useId, useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from '@/components/WordCard'
import { TranslateResult } from '@/components/TranslateResult'
import type { WordDetail } from '@/lib/dict/types'
import type { HardWord } from '@/lib/hardwords/extract'
import type { Direction, ProviderName } from '@/lib/translate/types'
import { fetchHardWords, streamTranslate } from '@/lib/translate/client'
import { lookupWordClient } from '@/lib/dict/clientLookup'
import { addHistory } from '@/lib/history/store'

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
    // 记历史：单词的「译文」就是它的中文释义，逐条用 · 连接；未收录则不记
    if (result.senses.length > 0) {
      const line = result.senses
        .map((s) => (s.pos ? `${s.pos} ${s.meaning}` : s.meaning))
        .join('；')
      addHistory(result.word, line)
    }
  }

  async function translateText(text: string) {
    setSource(text)
    setStreaming(true)

    // 难词拆解与译文并行发起 —— 前者走数据库，通常先到。
    // 中译英不拆难词：难词拆解只对英文源文本有意义。
    const hardWordsPromise =
      direction === 'zh2en' ? Promise.resolve() : fetchHardWords(text).then(setHardWords)

    // 本地累加完整译文，流结束后记一条历史（state 更新是异步的，不能直接读 translation）
    let full = ''
    const outcome = await streamTranslate(
      text,
      direction,
      (delta) => {
        full += delta
        setTranslation((t) => t + delta)
      },
      setProvider,
    )
    if (outcome.error) setError(outcome.error)
    setStreaming(false)
    // 收到了译文就记历史（哪怕中途报错也保留已得部分；难词不参与）
    if (full.trim()) addHistory(text, full)
    await hardWordsPromise
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

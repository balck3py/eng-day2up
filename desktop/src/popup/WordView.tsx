import { useEffect, useState } from 'react'
import { lookupWord } from '../lib/lookup'
import { favorite, isSaved } from '../lib/favorite'
import { resolveContext } from '../lib/context'
import { llmConfigOf } from '../lib/config'
import { defineMessages, streamChat } from '../lib/llm'
import { httpFetch } from '../lib/bridge'
import { parseTranslation } from '../lib/senses'
import { pronounce, type Accent } from '../lib/pronounce'
import type { Selection, Sense, WordDetail } from '../lib/types'
import { Notice, Star } from '../ui'
import type { Ready } from './Popup'

type StarState = 'idle' | 'busy' | 'added' | 'exists' | 'error'

export function WordView({ env, sel, word }: { env: Ready; sel: Selection; word: string }) {
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [star, setStar] = useState<StarState>('idle')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    lookupWord(env.db, word)
      .then(async (d) => {
        if (!alive) return
        setDetail(d)
        // 打开即显示收藏状态
        if (d.matchedFrom !== 'none' && (await isSaved(env.db, d.word)) && alive) setStar('exists')
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [env.db, word, attempt])

  if (failed) {
    return (
      <div className="p-4">
        <p className="text-[0.9375rem] text-ink-2">查询失败，请检查网络。</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false)
            setAttempt(attempt + 1)
          }}
          className="mt-2 text-sm text-ink underline"
        >
          重试
        </button>
      </div>
    )
  }
  if (!detail) return <Notice>查询中…</Notice>

  async function save() {
    if (!detail) return
    setStar('busy')
    try {
      const sourceContext = resolveContext(sel, 'word', word)
      setStar(await favorite(env.db, env.userId, { word: detail.word, sourceContext }))
    } catch {
      setStar('error')
    }
  }

  const inflected = detail.matchedFrom === 'lemma' || detail.matchedFrom === 'suffix'
  const fallbackPhonetic = !detail.phoneticUs && !detail.phoneticUk ? detail.phonetic : null

  return (
    <article className="p-4">
      {inflected && <p className="mb-1 font-mono text-[0.8125rem] text-ink-3">{detail.query} →</p>}
      <div className="flex items-start justify-between gap-3">
        <h1 className="border-b border-rule pb-1 text-[1.5rem] leading-tight font-semibold tracking-[-0.02em]">
          {detail.word}
        </h1>
        {detail.matchedFrom !== 'none' && <Star state={star} onClick={() => void save()} />}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Pronunciation label="美式" phonetic={detail.phoneticUs} word={detail.word} accent="us" />
        <Pronunciation label="英式" phonetic={detail.phoneticUk} word={detail.word} accent="uk" />
        {fallbackPhonetic && <span className="font-mono text-[0.9rem]">{fallbackPhonetic}</span>}
      </div>

      <Badges detail={detail} />

      {detail.matchedFrom === 'none' ? (
        <Unlisted env={env} word={detail.word} />
      ) : (
        <Senses senses={detail.senses} />
      )}
    </article>
  )
}

function Badges({ detail }: { detail: WordDetail }) {
  if (!detail.oxford && !detail.collins && detail.tags.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 text-[0.75rem] font-medium">
      {detail.oxford && (
        <span className="rounded-full border border-jade/30 bg-jade/10 px-2 py-0.5 text-jade">牛津核心</span>
      )}
      {detail.collins ? (
        <span
          role="img"
          aria-label={`柯林斯 ${detail.collins} 星`}
          className="rounded-full border border-seal/30 bg-seal/10 px-2 py-0.5 text-seal"
        >
          <span aria-hidden="true">{'★'.repeat(detail.collins)}</span>
        </span>
      ) : null}
      {detail.tags.map((t) => (
        <span key={t} className="rounded-full border border-rule px-2 py-0.5 text-ink-2 uppercase">
          {t}
        </span>
      ))}
    </div>
  )
}

function Senses({ senses }: { senses: Sense[] }) {
  if (senses.length === 0) return <p className="mt-4 text-sm text-ink-2">词典里没有中文释义。</p>
  return (
    <ul className="mt-4 border-t border-rule">
      {senses.map((s, i) => (
        <li key={i} className="grid grid-cols-[2.75rem_1px_1fr] gap-x-3 py-2">
          <span className="pt-px text-right font-mono text-[0.8125rem] text-ink-2">{s.pos}</span>
          <span className="self-stretch bg-rule" aria-hidden="true" />
          <span className="text-[1rem] leading-[1.7]">{s.meaning}</span>
        </li>
      ))}
    </ul>
  )
}

/** 未收录：不自动调 LLM，点按钮才生成；只展示、不写库、不显示音标。 */
function Unlisted({ env, word }: { env: Ready; word: string }) {
  const llm = llmConfigOf(env.settings)
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [senses, setSenses] = useState<Sense[] | null>(null)

  async function generate() {
    if (!llm) return
    setState('busy')
    try {
      let text = ''
      for await (const d of streamChat(llm, defineMessages(word), httpFetch)) text += d
      setSenses(parseTranslation(text))
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-ink-2">未收录</p>
      {senses ? (
        <>
          <span className="mt-2 inline-block rounded-full border border-ink-3/30 bg-ink-3/10 px-2 py-0.5 text-[0.75rem] font-medium text-ink-3">
            AI 释义，未收录
          </span>
          <Senses senses={senses} />
        </>
      ) : llm ? (
        <button
          type="button"
          disabled={state === 'busy'}
          onClick={() => void generate()}
          className="mt-2 rounded-[10px] border border-rule px-3 py-1.5 text-sm text-ink hover:border-ink disabled:opacity-60"
        >
          {state === 'busy' ? '生成中…' : state === 'error' ? 'AI 释义失败，重试' : 'AI 释义'}
        </button>
      ) : (
        <p className="mt-1 text-[0.8125rem] text-ink-3">在设置中配置翻译端点后可用 AI 释义。</p>
      )}
    </div>
  )
}

function Pronunciation({
  label,
  phonetic,
  word,
  accent,
}: {
  label: string
  phonetic: string | null
  word: string
  accent: Accent
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  async function play() {
    if (state === 'loading') return
    setState('loading')
    setState((await pronounce(word, accent)) === 'failed' ? 'failed' : 'idle')
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-ink-2">{label}</span>
      {phonetic && <span className="font-mono text-[0.9rem]">{phonetic}</span>}
      <button
        type="button"
        aria-label={`播放${label}发音`}
        disabled={state === 'loading'}
        onClick={() => void play()}
        className="text-ink-2 hover:text-ink disabled:opacity-60"
      >
        🔊
      </button>
      {state === 'failed' && <span className="text-xs text-ink-3">发音失败</span>}
    </span>
  )
}

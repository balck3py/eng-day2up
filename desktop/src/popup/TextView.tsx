import { useEffect, useState } from 'react'
import { extractHardWords, type HardWord } from '../lib/hardwords'
import { favorite } from '../lib/favorite'
import { resolveContext } from '../lib/context'
import { llmConfigOf } from '../lib/config'
import { streamChat, translateMessages } from '../lib/llm'
import { httpFetch } from '../lib/bridge'
import type { Selection } from '../lib/types'
import { Star } from '../ui'
import type { Ready } from './Popup'

/** 文本模式：流式译文与难词列表并行，互不等待；翻译失败不影响难词。 */
export function TextView({
  env,
  sel,
  text,
  truncated,
}: {
  env: Ready
  sel: Selection
  text: string
  truncated: boolean
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {truncated && <p className="text-[0.8125rem] text-ink-3">选中内容超过 5000 字，只处理前 5000 字。</p>}
      <Translation env={env} text={text} />
      <HardWords env={env} sel={sel} text={text} />
    </div>
  )
}

function Translation({ env, text }: { env: Ready; text: string }) {
  const llm = llmConfigOf(env.settings)
  const [out, setOut] = useState('')
  const [state, setState] = useState<'streaming' | 'done' | 'error'>('streaming')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!llm) return
    const ctrl = new AbortController()
    setOut('')
    setState('streaming')
    void (async () => {
      try {
        for await (const d of streamChat(llm, translateMessages(text, llm.prompt), httpFetch, ctrl.signal)) {
          setOut((o) => o + d)
        }
        setState('done')
      } catch {
        if (!ctrl.signal.aborted) setState('error')
      }
    })()
    return () => ctrl.abort()
    // llm 每次渲染都是新对象，用它的字段做依赖
  }, [text, attempt, llm?.baseUrl, llm?.model, llm?.apiKey, llm?.prompt])

  return (
    <section>
      <h2 className="mb-1 font-mono text-[0.8125rem] text-ink-2">译文</h2>
      {!llm ? (
        <p className="text-[0.875rem] text-ink-3">未配置翻译端点，请在设置中填写 LLM baseUrl 与 model。</p>
      ) : (
        <>
          <p className="text-[1rem] leading-[1.7] whitespace-pre-wrap" aria-live="polite" aria-busy={state === 'streaming'}>
            {out}
            {state === 'streaming' && <span className="streaming-caret" aria-hidden="true" />}
          </p>
          {state === 'error' && (
            <p className="mt-1 text-[0.875rem] text-seal">
              翻译失败。
              <button type="button" onClick={() => setAttempt(attempt + 1)} className="ml-1 text-ink underline">
                重试
              </button>
            </p>
          )}
        </>
      )}
    </section>
  )
}

function HardWords({ env, sel, text }: { env: Ready; sel: Selection; text: string }) {
  const [words, setWords] = useState<HardWord[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    extractHardWords(env.db, text, env.settings.threshold)
      .then((w) => alive && setWords(w))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [env.db, env.settings.threshold, text])

  if (failed) return <p className="text-[0.875rem] text-ink-3">难词读取失败。</p>
  if (!words) return <p className="text-[0.875rem] text-ink-3">难词分析中…</p>
  if (words.length === 0) return null
  return (
    <section>
      <h2 className="mb-1 font-mono text-[0.8125rem] text-ink-2">难词 · 点星收藏</h2>
      <ul className="flex flex-col divide-y divide-rule rounded-[10px] border border-rule">
        {words.map((hw) => (
          <HardWordRow key={hw.word} env={env} sel={sel} hw={hw} />
        ))}
      </ul>
    </section>
  )
}

function HardWordRow({ env, sel, hw }: { env: Ready; sel: Selection; hw: HardWord }) {
  const [star, setStar] = useState<'idle' | 'busy' | 'added' | 'exists' | 'error'>('idle')
  async function save() {
    setStar('busy')
    try {
      const sourceContext = resolveContext(sel, 'text', hw.surface)
      setStar(await favorite(env.db, env.userId, { word: hw.word, sourceContext }))
    } catch {
      setStar('error')
    }
  }
  const inflected = hw.surface.toLowerCase() !== hw.word.toLowerCase()
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {inflected && <span className="font-mono text-[0.75rem] text-ink-3">{hw.surface} →</span>}
          <span className="font-semibold">{hw.word}</span>
          {hw.phonetic && <span className="font-mono text-[0.75rem] text-ink-2">{hw.phonetic}</span>}
        </span>
        <span className="block truncate text-[0.875rem] text-ink-2">
          {hw.senses
            .slice(0, 2)
            .map((s) => (s.pos ? `${s.pos} ${s.meaning}` : s.meaning))
            .join('；') || '词典未收录'}
        </span>
      </div>
      <Star state={star} onClick={() => void save()} />
    </li>
  )
}

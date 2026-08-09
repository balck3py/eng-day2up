'use client'

import { useEffect, useRef, useState } from 'react'
import type { WordDetail } from '@/lib/dict/types'
import { pronounce, type Accent } from '@/lib/audio/pronounce'
import { FavoriteButton } from './FavoriteButton'

const FAIL_MESSAGE_MS = 4000

type PlayState = 'idle' | 'loading' | 'failed'

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
  const [state, setState] = useState<PlayState>('idle')
  const mountedRef = useRef(true)
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // 在开发模式的 StrictMode 下，effect 会先「假卸载」再「真挂载」一次：
    // 光在 cleanup 里把 ref 置 false 不够，setup 里必须把它重新置回 true，
    // 否则真正挂载完成后 mountedRef 会永远停留在 false，
    // 导致 pronounce() 一 resolve 就被当成「已卸载」而永远不更新按钮状态。
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (failTimerRef.current) clearTimeout(failTimerRef.current)
    }
  }, [])

  async function handleClick() {
    // 忽略连续点击：上一次播放请求还在进行时不重复发起，避免排队堆积。
    if (state === 'loading') return

    if (failTimerRef.current) {
      clearTimeout(failTimerRef.current)
      failTimerRef.current = null
    }
    setState('loading')

    const result = await pronounce(word, accent)

    // 组件已卸载（比如用户已经切走这个词）就不再碰 state。
    if (!mountedRef.current) return

    if (result === 'failed') {
      setState('failed')
      failTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setState('idle')
      }, FAIL_MESSAGE_MS)
    } else {
      setState('idle')
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-xs text-ink-2">{label}</span>}
      {phonetic && (
        <span className="font-mono text-[0.9rem] text-ink">{phonetic}</span>
      )}
      <button
        type="button"
        aria-label={`播放${label}发音`}
        aria-busy={state === 'loading'}
        disabled={state === 'loading'}
        onClick={handleClick}
        className="rounded text-ink-2 hover:text-ink disabled:opacity-60"
      >
        {state === 'loading' ? '🔊…' : '🔊'}
      </button>
      {state === 'failed' && (
        <span className="text-xs text-ink-3">发音加载失败</span>
      )}
    </span>
  )
}

export function WordCard({
  detail,
  variant = 'standalone',
  sourceContext = null,
}: {
  detail: WordDetail
  /** 'embedded' 供划词浮层使用：外层已有卡片外壳，这里不再叠一层边框，词头也收小 */
  variant?: 'standalone' | 'embedded'
  /** 收藏时随词一起存下的原句（划词浮层会传入所在段落） */
  sourceContext?: string | null
}) {
  const isLemma =
    detail.matchedFrom === 'lemma' || detail.matchedFrom === 'suffix'
  const isAi = detail.matchedFrom === 'ai'
  const hasBadges =
    isAi || detail.tags.length > 0 || detail.oxford || !!detail.collins
  // 发音按钮不依赖 dictionaryapi.dev 的音标/音频数据——有道和本地合成都只需要
  // 词本身。只要查到了词（detail.word 恒非空），就允许发音。
  const fallbackPhonetic =
    !detail.phoneticUs && !detail.phoneticUk ? detail.phonetic : null
  const embedded = variant === 'embedded'

  return (
    <article
      className={
        embedded
          ? 'p-4'
          : 'word-card-enter rounded-[10px] border border-rule bg-card p-5 shadow-[0_1px_2px_rgba(20,33,61,0.04)] sm:p-6'
      }
    >
      {isLemma && (
        <p className="mb-1 font-mono text-[0.8125rem] text-ink-3">
          {detail.query.trim()} →
        </p>
      )}

      <div className="flex items-start justify-between gap-3">
        <h2
          className={`inline-block w-fit border-b border-rule pb-1 leading-tight font-semibold tracking-[-0.02em] text-ink ${
            embedded ? 'text-[1.5rem]' : 'text-[2.25rem] sm:text-[3rem]'
          }`}
        >
          {detail.word}
        </h2>
        {/* 未收录的词收藏了也没释义可复习，只有词典命中才给收藏 */}
        {detail.matchedFrom !== 'none' && (
          <FavoriteButton word={detail.word} sourceContext={sourceContext} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Pronunciation
          label="美式"
          phonetic={detail.phoneticUs}
          word={detail.word}
          accent="us"
        />
        <Pronunciation
          label="英式"
          phonetic={detail.phoneticUk}
          word={detail.word}
          accent="uk"
        />
        {/* 在线音标全缺失时，回落到 ECDICT 的单一音标（仅展示，不影响发音按钮） */}
        {fallbackPhonetic && (
          <span className="font-mono text-[0.9rem] text-ink">
            {fallbackPhonetic}
          </span>
        )}
      </div>

      {hasBadges && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {isAi && (
            <span className="rounded-full border border-ink-3/30 bg-ink-3/10 px-2 py-0.5 text-[0.75rem] font-medium text-ink-3">
              AI 释义
            </span>
          )}
          {detail.oxford && (
            <span className="rounded-full border border-jade/30 bg-jade/10 px-2 py-0.5 text-[0.75rem] font-medium text-jade">
              牛津核心
            </span>
          )}
          {detail.collins ? (
            <span
              role="img"
              className="rounded-full border border-seal/30 bg-seal/10 px-2 py-0.5 text-[0.75rem] font-medium text-seal"
              aria-label={`柯林斯 ${detail.collins} 星`}
            >
              <span aria-hidden="true">{'★'.repeat(detail.collins)}</span>
            </span>
          ) : null}
          {detail.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-rule px-2 py-0.5 text-[0.75rem] font-medium text-ink-2 uppercase"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {detail.senses.length > 0 ? (
        <ul className="mt-4 border-t border-rule">
          {detail.senses.map((s, i) => (
            <li
              key={i}
              className="grid grid-cols-[2.75rem_1px_1fr] gap-x-3 py-2 sm:grid-cols-[3.5rem_1px_1fr]"
            >
              <span className="pt-px text-right font-mono text-[0.8125rem] text-ink-2">
                {s.pos}
              </span>
              <span className="self-stretch bg-rule" aria-hidden="true" />
              <span className="text-[1rem] leading-[1.7] text-ink">
                {s.meaning}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2">词典未收录这个词。</p>
      )}
    </article>
  )
}

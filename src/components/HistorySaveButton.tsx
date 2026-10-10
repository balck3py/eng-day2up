'use client'

import { useState } from 'react'

type State = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * 历史页的「收藏」按钮：把这条记录的原文当单词存进单词本。
 *
 * 刻意不复用 FavoriteButton —— 那个会在挂载时按词查一次已收藏态，历史页
 * 一屏可能有上百条，会打出上百个请求。这里不预查，直接 POST：后端对已收藏
 * 的词是「返回既有记录」而不是报错，重复点也不会出问题。
 */
export function HistorySaveButton({ word }: { word: string }) {
  const [state, setState] = useState<State>('idle')

  async function save() {
    if (state === 'saving' || state === 'saved') return
    setState('saving')
    try {
      const res = await fetch('/api/wordbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      })
      setState(res.ok ? 'saved' : 'failed')
    } catch {
      setState('failed')
    }
  }

  if (state === 'saved') {
    return (
      <span data-testid="history-saved" className="shrink-0 text-sm text-jade">
        已收藏
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void save()}
      disabled={state === 'saving'}
      aria-label={`收藏 ${word} 到单词本`}
      className={`shrink-0 text-sm transition-colors disabled:opacity-60 ${
        state === 'failed' ? 'text-seal' : 'text-ink-3 hover:text-ink'
      }`}
    >
      {state === 'saving' ? '收藏中…' : state === 'failed' ? '重试' : '收藏'}
    </button>
  )
}

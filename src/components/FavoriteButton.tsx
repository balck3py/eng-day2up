'use client'

import { useState } from 'react'

/**
 * 自管理状态的收藏切换。挂载时**不**查询已收藏态（已知简化，见 Plan 3 Task 2）：
 * 首次点击即收藏，再点取消。重复收藏由后端「已存在则返回既有记录」兜住，
 * 不会产生脏数据，只是刷新后星标会回到未收藏样式。
 *
 * 星标沿用词卡上柯林斯星级的 --seal 色，与这页既有的「星」视觉保持一致。
 */
export function FavoriteButton({
  word,
  sourceContext = null,
}: {
  word: string
  sourceContext?: string | null
}) {
  const [entryId, setEntryId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      if (saved && entryId) {
        const res = await fetch(`/api/wordbook/${entryId}`, { method: 'DELETE' })
        if (res.ok) {
          setSaved(false)
          setEntryId(null)
        }
      } else {
        const res = await fetch('/api/wordbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, sourceContext }),
        })
        if (res.ok) {
          const data = (await res.json()) as { entry: { id: string } }
          setEntryId(data.entry.id)
          setSaved(true)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? `从单词本移除 ${word}` : `收藏 ${word}`}
      className={`shrink-0 rounded text-lg leading-none transition-colors disabled:opacity-50 ${
        saved ? 'text-seal' : 'text-ink-3 hover:text-seal'
      }`}
    >
      {saved ? '★' : '☆'}
    </button>
  )
}

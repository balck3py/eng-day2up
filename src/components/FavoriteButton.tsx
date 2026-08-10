'use client'

import { useEffect, useState } from 'react'

/**
 * 自管理状态的收藏切换。挂载时按词查询已收藏态并同步星标——重新查询同一个词
 * 或刷新页面后，已收藏的词会正确显示为实心星，取消收藏也能直接进行。
 * 重复收藏另由后端「已存在则返回既有记录」兜底。
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

  // 挂载/换词时同步已收藏态：按 word_key 精确查这个词是否已在单词本里。
  useEffect(() => {
    let alive = true
    setSaved(false)
    setEntryId(null)
    void fetch(`/api/wordbook?word=${encodeURIComponent(word)}`)
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: { id: string }[] }) => {
        if (!alive) return
        const hit = d.entries[0]
        if (hit) {
          setSaved(true)
          setEntryId(hit.id)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [word])

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

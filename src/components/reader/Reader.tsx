'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MarkdownView } from './MarkdownView'
import { ReaderSelection } from './ReaderSelection'

type Doc = { url: string; text: string }

/**
 * 阅读页主体。地址放在 ?url= 里，刷新或收藏都能回到同一篇；
 * 换地址时上层以 url 作 key 重建本组件，抓取状态天然归零。
 */
export function Reader({ url }: { url: string }) {
  const inputId = useId()
  const router = useRouter()
  const [input, setInput] = useState(url)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(url !== '')

  useEffect(() => {
    if (!url) return
    let alive = true
    void fetch('/api/fetch-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as Partial<Doc> & { error?: string }
        if (!alive) return
        if (r.ok && typeof data.text === 'string' && data.url) setDoc({ url: data.url, text: data.text })
        else setError(data.error ?? '加载失败')
      })
      .catch(() => alive && setError('网络错误'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [url])

  function submit() {
    const next = input.trim()
    if (!next) return
    if (next === url) {
      // 同一地址再点一次＝重新加载（key 不变，组件不会重建，只能整页刷新）
      window.location.reload()
      return
    }
    router.push(`/reader?url=${encodeURIComponent(next)}`)
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:px-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          第三方文档地址
        </label>
        <input
          id={inputId}
          // 不用 type="url"：浏览器会拦下不带协议的输入（如 podcast/a.md），
          // 而那正是要支持的写法 —— 补全交给服务端的 toFetchUrl
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴 Markdown 地址，或只填路径如 podcast/deep-dive/deep-dive-2.md"
          className="min-w-0 flex-1 rounded-[10px] border border-rule bg-card px-3 py-2 text-ink placeholder:text-ink-3 focus:border-focus"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
        >
          {loading ? '加载中…' : '打开'}
        </button>
      </form>

      {!url && (
        <p className="text-[0.9375rem] leading-[1.7] text-ink-3">
          打开后，选中任意单词或句子，点下方出现的「译」查看翻译，难词可以连同所在句子收进单词本。
        </p>
      )}
      {error && <p className="text-[0.9375rem] text-seal">{error}</p>}
      {doc && (
        <>
          <p className="truncate font-mono text-[0.8125rem] text-ink-3">
            来源：
            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              {doc.url}
            </a>
          </p>
          <ReaderSelection>
            <MarkdownView text={doc.text} baseUrl={doc.url} />
          </ReaderSelection>
        </>
      )}
    </main>
  )
}

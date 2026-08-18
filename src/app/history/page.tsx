'use client'

import { useSyncExternalStore } from 'react'
import {
  subscribeHistory,
  getHistorySnapshot,
  getHistoryServerSnapshot,
  removeHistory,
  clearHistory,
} from '@/lib/history/store'

function when(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 「是否已完成 hydration」的外部 store：服务端恒 false、客户端恒 true。
    这三个函数必须是模块级常量 —— 每渲染新建一份会让 React 反复重订阅。 */
const noopSubscribe = () => () => {}
const alwaysTrue = () => true
const alwaysFalse = () => false

export default function HistoryPage() {
  // 历史存 localStorage，服务端渲染读不到。用 useSyncExternalStore 而不是
  // 「effect 里 setState」：省掉一轮级联渲染，还顺带让其他标签页的改动同步过来。
  const items = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getHistoryServerSnapshot,
  )
  // hydration 完成前不显示「还没有记录」，否则有历史的用户会先看到一闪的空态
  const ready = useSyncExternalStore(noopSubscribe, alwaysTrue, alwaysFalse)

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">翻译历史</h2>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clearHistory()
            }}
            className="text-sm text-ink-3 transition-colors hover:text-seal"
          >
            清空
          </button>
        )}
      </div>

      {ready && items.length === 0 && (
        <p className="text-[0.9375rem] text-ink-3">
          还没有翻译记录 —— 去翻译页查几个词、译几句话吧。历史只存在这台设备的浏览器里。
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-rule rounded-[10px] border border-rule bg-card">
          {items.map((h) => (
            <li key={h.id} className="flex items-start gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[1rem] leading-[1.6] font-medium break-words text-ink">
                  {h.source}
                </p>
                <p className="mt-1 text-[0.9375rem] leading-[1.7] break-words text-ink-2">
                  {h.translation}
                </p>
                <p className="mt-1.5 font-mono text-[0.75rem] text-ink-3">{when(h.at)}</p>
              </div>
              <button
                type="button"
                onClick={() => removeHistory(h.id)}
                aria-label={`删除记录 ${h.source}`}
                className="shrink-0 text-sm text-ink-3 transition-colors hover:text-seal"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

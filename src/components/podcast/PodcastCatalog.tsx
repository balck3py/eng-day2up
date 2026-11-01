'use client'

import Link from 'next/link'
import { useState } from 'react'
import { episodeDate, type Episode } from '@/lib/podcast/types'
import { usePodcastData } from './usePodcastData'

function Cover({ episode }: { episode: Episode }) {
  const [failed, setFailed] = useState<string[]>([])
  const src = [episode.image, episode.channelImage].find((url) => url && !failed.includes(url))
  return src
    // The fixed-source image is public; retain channel fallback on load errors.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" width={80} height={80} onError={() => setFailed((list) => [...list, src])} className="size-20 shrink-0 rounded-lg object-cover" />
    : <div aria-hidden="true" className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-2xl text-ink-3">♫</div>
}

export function PodcastCatalog() {
  const { data, error, loading, reload } = usePodcastData<{ episodes: Episode[] }>('/api/podcast')
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">播客</h1><p className="mt-1 text-sm text-ink-3">Daily News · 听新闻，练英语</p></div>
        <button type="button" onClick={() => void reload()} disabled={loading} className="rounded-lg border border-rule px-3 py-2 text-sm disabled:opacity-50">{loading ? '加载中…' : '刷新'}</button>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-seal">{error} <button onClick={() => void reload()} className="underline">重试</button>{data && '（当前保留上次列表）'}</p>}
      {!loading && !error && data?.episodes.length === 0 && <p className="text-ink-3">暂无节目。</p>}
      <ul className="divide-y divide-rule">
        {data?.episodes.map((episode) => (
          <li key={episode.id} className="flex gap-4 py-5">
            <Cover episode={episode} />
            <div className="min-w-0 self-center"><Link href={`/podcast/${episode.id}`} className="break-words text-base font-medium leading-relaxed hover:text-focus">{episode.title}</Link><p className="mt-2 text-xs text-ink-3"><time dateTime={episode.publishedAt ?? undefined}>{episodeDate(episode.publishedAt)}</time></p></div>
          </li>
        ))}
      </ul>
    </main>
  )
}

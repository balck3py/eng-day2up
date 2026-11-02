'use client'

import Link from 'next/link'
import { programPath, type Program } from '@/lib/podcast/programs'
import { PodcastCover } from './PodcastCover'
import { episodeDate, type Episode } from '@/lib/podcast/types'
import { usePodcastData } from './usePodcastData'

export function PodcastCatalog({ program }: { program: Program }) {
  const { data, error, loading, reload } = usePodcastData<{ episodes: Episode[] }>(`/api/podcast/shows/${program.id}`)
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
      <Link href="/podcast" className="mb-5 inline-block text-sm text-ink-3 hover:text-ink">← 所有节目</Link>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">{program.name}</h1></div>
        <button type="button" onClick={() => void reload()} disabled={loading} className="rounded-lg border border-rule px-3 py-2 text-sm disabled:opacity-50">{loading ? '加载中…' : '刷新'}</button>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-seal">{error} <button onClick={() => void reload()} className="underline">重试</button>{data && '（当前保留上次列表）'}</p>}
      {!loading && !error && data?.episodes.length === 0 && <p className="text-ink-3">暂无节目。</p>}
      <ul className="divide-y divide-rule">
        {data?.episodes.map((episode) => (
          <li key={episode.id}>
            <Link href={`${programPath(program.id)}/${episode.id}`} className="flex gap-4 rounded-lg px-3 py-5 transition-colors hover:bg-card">
              <PodcastCover image={episode.image} fallback={episode.channelImage ?? program.cover} />
              <div className="min-w-0 self-center"><h2 className="break-words text-base font-medium leading-relaxed">{episode.title}</h2><p className="mt-2 text-xs text-ink-3"><time dateTime={episode.publishedAt ?? undefined}>{episodeDate(episode.publishedAt)}</time></p></div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

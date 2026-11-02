import { redirect } from 'next/navigation'
import { programPath } from '@/lib/podcast/programs'

export default async function PodcastEpisodePage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params
  redirect(`${programPath('daily-news')}/${encodeURIComponent(episodeId)}`)
}

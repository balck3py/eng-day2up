import { PodcastDetail } from '@/components/podcast/PodcastDetail'

export default async function PodcastEpisodePage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params
  return <PodcastDetail key={episodeId} episodeId={episodeId} />
}

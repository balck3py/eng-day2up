import { podcastResponse } from '@/lib/podcast/api'
import { loadEpisode } from '@/lib/podcast/load'

export async function GET(_request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params
  return podcastResponse(() => loadEpisode(episodeId))
}

import { notFound } from 'next/navigation'
import { findProgram } from '@/lib/podcast/programs'
import { PodcastDetail } from '@/components/podcast/PodcastDetail'

export default async function EpisodePage({ params }: { params: Promise<{ programId: string; episodeId: string }> }) {
  const { programId, episodeId } = await params
  const program = findProgram(programId)
  if (!program) notFound()
  return <PodcastDetail key={`${programId}:${episodeId}`} program={program} episodeId={episodeId} />
}

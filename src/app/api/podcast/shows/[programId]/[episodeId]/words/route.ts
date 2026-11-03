import { podcastResponse } from '@/lib/podcast/api'
import { loadWordTrack, PodcastError } from '@/lib/podcast/load'
import { findProgram } from '@/lib/podcast/programs'

export async function GET(_request: Request, { params }: { params: Promise<{ programId: string; episodeId: string }> }) {
  const { programId, episodeId } = await params
  return podcastResponse(async () => {
    const program = findProgram(programId)
    if (!program) throw new PodcastError('节目不存在', 404)
    return loadWordTrack(episodeId, program)
  })
}

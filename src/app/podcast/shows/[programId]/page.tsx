import { notFound } from 'next/navigation'
import { findProgram } from '@/lib/podcast/programs'
import { PodcastCatalog } from '@/components/podcast/PodcastCatalog'

export default async function ProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params
  const program = findProgram(programId)
  if (!program) notFound()
  return <PodcastCatalog key={program.id} program={program} />
}

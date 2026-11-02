import Link from 'next/link'
import { PROGRAMS, programPath } from '@/lib/podcast/programs'
import { PodcastCover } from './PodcastCover'

export function PodcastPrograms() {
  return <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
    <h1 className="mb-6 text-2xl font-semibold tracking-tight">播客</h1>
    <ul className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
      {PROGRAMS.map((program) => <li key={program.id}>
        <Link href={programPath(program.id)} aria-label={program.name} className="block overflow-hidden rounded-xl border border-rule bg-card transition-colors hover:border-ink-3 motion-reduce:transition-none">
          <PodcastCover image={program.cover} fullSize />
        </Link>
      </li>)}
    </ul>
  </main>
}

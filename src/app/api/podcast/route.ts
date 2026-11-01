import { podcastResponse } from '@/lib/podcast/api'
import { loadCatalog } from '@/lib/podcast/load'

export async function GET() {
  return podcastResponse(async () => ({ episodes: await loadCatalog() }))
}

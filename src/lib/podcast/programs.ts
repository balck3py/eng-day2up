export interface Program { id: string; name: string; feed: string; directory: string; cover: string }
const base = 'https://qiniu.aiquannei.com/podcast/'
export const PROGRAMS: readonly Program[] = [
  ['daily-news', 'Daily News 10 Mins'], ['ai-digest', 'AI Digest'],
  ['topic', 'Talk Today'], ['deep-dive', 'How It Works'],
].map(([id, name]) => ({ id, name, feed: `${base}${id}/feed.xml`, directory: `/podcast/${id}/`, cover: `${base}${id}/cover.jpg` }))
export function findProgram(id: string): Program | undefined { return PROGRAMS.find((p) => p.id === id) }
export function programPath(id: string) { return `/podcast/shows/${encodeURIComponent(id)}` }

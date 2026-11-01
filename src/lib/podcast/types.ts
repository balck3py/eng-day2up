export interface Episode {
  id: string
  title: string
  publishedAt: string | null
  image: string | null
  channelImage: string | null
  audio: string | null
  english: string | null
  chinese: string | null
}

export interface Cue {
  id: string
  startMs: number
  endMs: number
  text: string
  chineseText?: string
}

export interface EpisodeDetail {
  episode: Episode
  cues: Cue[]
  englishError: string | null
  chineseError: string | null
}

export function episodeDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value)) : '日期未知'
}

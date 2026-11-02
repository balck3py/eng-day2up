'use client'

import { useState } from 'react'
import Image from 'next/image'

export function PodcastCover({ image, fallback, fullSize = false }: { image: string | null; fallback?: string | null; fullSize?: boolean }) {
  const [failed, setFailed] = useState<string[]>([])
  const src = [image, fallback].find((url) => url && !failed.includes(url))
  return src
    ? <Image src={src} alt="" width={fullSize ? 640 : 80} height={fullSize ? 640 : 80}
        sizes={fullSize ? '(min-width: 768px) 352px, (min-width: 360px) calc((100vw - 56px) / 2), calc(100vw - 40px)' : '(min-width: 640px) 80px, 64px'}
        loading={fullSize ? 'eager' : 'lazy'} onError={() => setFailed((list) => [...list, src])}
        className={fullSize ? 'aspect-square h-auto w-full object-cover' : 'size-16 shrink-0 rounded-lg object-cover sm:size-20'} />
    : <div aria-hidden="true" className={`flex items-center justify-center bg-paper text-ink-3 ${fullSize ? 'aspect-square w-full text-4xl' : 'size-16 shrink-0 rounded-lg border border-rule text-2xl sm:size-20'}`}>♫</div>
}

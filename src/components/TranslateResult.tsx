'use client'

import { HardWordGrid } from './HardWordGrid'
import { SelectionPopover } from './SelectionPopover'
import type { HardWord } from '@/lib/hardwords/extract'
import type { ProviderName } from '@/lib/translate/types'

const PROVIDER_LABEL: Record<ProviderName, string> = {
  ollama: '本地模型',
  cloud: '云端模型',
}

/**
 * 原文与译文左右对位，中间一道 --rule 竖线 —— 与词卡上「词性 │ 释义」
 * 用的是同一个结构装置：竖线分隔的是同一份内容的两种语域，不是装饰。
 * 窄屏退化为上下堆叠，竖线改为横线。
 */
export function TranslateResult({
  source,
  translation,
  provider,
  hardWords,
  streaming,
  error,
}: {
  source: string
  translation: string
  provider: ProviderName | null
  hardWords: HardWord[]
  streaming: boolean
  error: string | null
}) {
  return (
    <SelectionPopover>
      <div className="flex flex-col gap-6">
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-[1fr_1px_1fr]">
          <section>
            <h3 className="mb-2 font-mono text-[0.8125rem] text-ink-2">原文</h3>
            <p className="text-[1rem] leading-[1.7] whitespace-pre-wrap text-ink-2">
              {source}
            </p>
          </section>

          <span className="hidden bg-rule md:block" aria-hidden="true" />

          <section className="border-t border-rule pt-5 md:border-t-0 md:pt-0">
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="font-mono text-[0.8125rem] text-ink-2">译文</h3>
              {provider && (
                <span className="rounded-full border border-rule px-2 py-0.5 font-mono text-[0.75rem] text-ink-3">
                  {PROVIDER_LABEL[provider]}
                </span>
              )}
            </div>
            <p
              className="text-[1rem] leading-[1.7] whitespace-pre-wrap text-ink"
              aria-live="polite"
              aria-busy={streaming}
            >
              {translation}
              {streaming && <span className="streaming-caret" aria-hidden="true" />}
            </p>
            {error && <p className="mt-2 text-[0.9375rem] text-seal">{error}</p>}
          </section>
        </div>

        <HardWordGrid words={hardWords} context={source} />
      </div>
    </SelectionPopover>
  )
}

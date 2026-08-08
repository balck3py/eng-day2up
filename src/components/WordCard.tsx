'use client'

import type { WordDetail } from '@/lib/dict/types'

function playAudio(url: string) {
  // Audio.play() 返回 Promise，浏览器拦截自动播放或资源 404 时会 reject，
  // 不 catch 会在控制台抛出未处理的 rejection。
  void new Audio(url).play().catch(() => {})
}

function Pronunciation({
  label,
  phonetic,
  audio,
}: {
  label: string
  phonetic: string | null
  audio: string | null
}) {
  if (!phonetic && !audio) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-xs text-ink-2">{label}</span>}
      {phonetic && (
        <span className="font-mono text-[0.9rem] text-ink">{phonetic}</span>
      )}
      {audio && (
        <button
          type="button"
          aria-label={`播放${label}发音`}
          onClick={() => playAudio(audio)}
          className="rounded text-ink-2 hover:text-ink"
        >
          🔊
        </button>
      )}
    </span>
  )
}

export function WordCard({ detail }: { detail: WordDetail }) {
  const bothSame =
    detail.phoneticUs !== null && detail.phoneticUs === detail.phoneticUk
  const isLemma =
    detail.matchedFrom === 'lemma' || detail.matchedFrom === 'suffix'
  const hasBadges = detail.tags.length > 0 || detail.oxford || !!detail.collins
  const hasPronunciation =
    !!detail.phoneticUs ||
    !!detail.phoneticUk ||
    !!detail.audioUs ||
    !!detail.audioUk ||
    !!detail.phonetic

  return (
    <article className="word-card-enter rounded-[10px] border border-rule bg-card p-5 shadow-[0_1px_2px_rgba(20,33,61,0.04)] sm:p-6">
      {isLemma && (
        <p className="mb-1 font-mono text-[0.8125rem] text-ink-3">
          {detail.query.trim()} →
        </p>
      )}

      <h2 className="inline-block w-fit border-b border-rule pb-1 text-[2.25rem] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[3rem]">
        {detail.word}
      </h2>

      {hasPronunciation && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          {bothSame ? (
            <Pronunciation
              label=""
              phonetic={detail.phoneticUs}
              audio={detail.audioUs ?? detail.audioUk}
            />
          ) : (
            <>
              <Pronunciation
                label="美"
                phonetic={detail.phoneticUs}
                audio={detail.audioUs}
              />
              <Pronunciation
                label="英"
                phonetic={detail.phoneticUk}
                audio={detail.audioUk}
              />
            </>
          )}
          {/* 在线音标全缺失时，回落到 ECDICT 的单一音标 */}
          {!detail.phoneticUs && !detail.phoneticUk && detail.phonetic && (
            <span className="font-mono text-[0.9rem] text-ink">
              {detail.phonetic}
            </span>
          )}
        </div>
      )}

      {hasBadges && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {detail.oxford && (
            <span className="rounded-full border border-jade/30 bg-jade/10 px-2 py-0.5 text-[0.75rem] font-medium text-jade">
              牛津核心
            </span>
          )}
          {detail.collins ? (
            <span
              role="img"
              className="rounded-full border border-seal/30 bg-seal/10 px-2 py-0.5 text-[0.75rem] font-medium text-seal"
              aria-label={`柯林斯 ${detail.collins} 星`}
            >
              <span aria-hidden="true">{'★'.repeat(detail.collins)}</span>
            </span>
          ) : null}
          {detail.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-rule px-2 py-0.5 text-[0.75rem] font-medium text-ink-2 uppercase"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {detail.senses.length > 0 ? (
        <ul className="mt-4 border-t border-rule">
          {detail.senses.map((s, i) => (
            <li
              key={i}
              className="grid grid-cols-[2.75rem_1px_1fr] gap-x-3 py-2 sm:grid-cols-[3.5rem_1px_1fr]"
            >
              <span className="pt-px text-right font-mono text-[0.8125rem] text-ink-2">
                {s.pos}
              </span>
              <span className="self-stretch bg-rule" aria-hidden="true" />
              <span className="text-[1rem] leading-[1.7] text-ink">
                {s.meaning}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2">词典未收录这个词。</p>
      )}
    </article>
  )
}

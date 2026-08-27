'use client'

/**
 * 两种题型共用的卡片底部操作区。
 *
 * 上一个 / 下一个 是纯导航：不打分、不写库，任何题型任何状态下都在、都能点
 * —— 卡在哪一步都走得掉。认识 / 不认识 各占一整行摆在最下面，行为跟挪位置
 * 之前一样：英译中是标记并翻页，中译英是选定判定并亮出答案，差别由调用方
 * 传进来的 onVerdict 决定，这里只管长相。
 */
export function ReviewFooter({
  canPrev,
  onPrev,
  onNext,
  nextHint,
  showVerdict,
  verdict,
  onVerdict,
}: {
  canPrev: boolean
  onPrev: () => void
  onNext: () => void
  /** 「下一个」上的快捷键提示，没有就不显示 */
  nextHint?: string
  showVerdict: boolean
  /** 这张卡当前记下的判定，还没选过就是 null */
  verdict: boolean | null
  onVerdict: (known: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          className="flex-1 whitespace-nowrap rounded-[10px] border border-rule py-3 text-sm text-ink disabled:opacity-40"
        >
          上一个
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 whitespace-nowrap rounded-[10px] bg-ink py-3 text-sm font-medium text-card"
        >
          下一个
          {nextHint && (
            <span className="ml-1.5 font-mono text-[0.75rem] text-card/70">{nextHint}</span>
          )}
        </button>
      </div>

      {showVerdict && (
        <>
          <button
            type="button"
            aria-pressed={verdict === false}
            onClick={() => onVerdict(false)}
            className={`w-full whitespace-nowrap rounded-[10px] py-3 text-sm ${
              verdict === false
                ? 'bg-seal font-medium text-card'
                : 'border border-rule text-ink'
            }`}
          >
            不认识 <span className="font-mono text-[0.75rem] opacity-70">1</span>
          </button>
          <button
            type="button"
            aria-pressed={verdict === true}
            onClick={() => onVerdict(true)}
            className={`w-full whitespace-nowrap rounded-[10px] py-3 text-sm ${
              verdict === true
                ? 'bg-jade font-medium text-card'
                : 'border border-rule text-ink'
            }`}
          >
            认识 <span className="font-mono text-[0.75rem] opacity-70">2</span>
          </button>
        </>
      )}
    </div>
  )
}

/** 弹窗与设置页共用的小部件。 */

export function Star({
  state,
  onClick,
}: {
  state: 'idle' | 'busy' | 'added' | 'exists' | 'error'
  onClick: () => void
}) {
  const saved = state === 'added' || state === 'exists'
  const label = { idle: '收藏', busy: '收藏中', added: '已收藏', exists: '已在单词本', error: '收藏失败，点击重试' }[state]
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {(state === 'exists' || state === 'error') && (
        <span className={`text-[0.75rem] ${state === 'error' ? 'text-seal' : 'text-ink-3'}`}>
          {state === 'exists' ? '已在单词本' : '收藏失败'}
        </span>
      )}
      <button
        type="button"
        aria-label={label}
        aria-pressed={saved}
        title={label}
        disabled={saved || state === 'busy'}
        onClick={onClick}
        className={`text-[1.25rem] leading-none ${saved ? 'text-seal' : 'text-ink-3 hover:text-seal'} disabled:cursor-default`}
      >
        {saved ? '★' : '☆'}
      </button>
    </span>
  )
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-[0.9375rem] text-ink-2">{children}</p>
}

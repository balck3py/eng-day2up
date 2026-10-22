'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { orderCards, type ReviewMode } from '@/lib/review/order'
import { assignQuizTypes, type QuizRules, type ReviewCard } from '@/lib/review/quiz'
import { splitRecent, splitPrevious, interleave } from '@/lib/review/ebbinghaus'
import { nextFamiliarity, nextSpellOkCount, owesSpelling, SPELL_QUOTA } from '@/lib/review/mark'
import { inCooldown, MASTERED_COOLDOWN_MS } from '@/lib/review/cooldown'
import { shouldSaveLeftover, unknownIds, type RoundKind } from '@/lib/review/leftover'
import {
  clearSession,
  isExpired,
  loadSession,
  restoreSession,
  saveSession,
  type SavedSession,
} from '@/lib/review/session'
import {
  enqueue,
  flushOutbox,
  readOutbox,
  sendItem,
  type FetchLike,
  type OutboxDraft,
} from '@/lib/review/outbox'
import { hasChineseMeaning } from '@/lib/dict/senses'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { ReviewFlipCard } from '@/components/ReviewFlipCard'
import { ReviewInputCard } from '@/components/ReviewInputCard'

type Phase = 'setup' | 'reviewing' | 'done'

const MODES: { value: ReviewMode; label: string }[] = [
  { value: 'sequential', label: '顺序' },
  { value: 'random', label: '随机' },
]

/**
 * 题型的两条强制规则，都读单词本上的累计状态：
 *
 * - 第一次背（一次都没复习过）只出英译中 —— 没见过的词让人凭空拼是白费功夫。
 * - 熟练度未满、拼对次数还没到 SPELL_QUOTA 的词强制出中译英，直到还清。
 */
const QUIZ_RULES: QuizRules<WordbookEntry> = {
  canAskCn: (e) => hasChineseMeaning(e.senses),
  isFirstEver: (e) => e.reviewCount === 0,
  owesSpelling: (e) => owesSpelling(e.familiarity, e.spellOkCount),
}

const COOLDOWN_DAYS = Math.round(MASTERED_COOLDOWN_MS / (24 * 60 * 60 * 1000))

const browserFetch: FetchLike = (url, init) => fetch(url, init)

/** 本地存档里生词数，给续背提示用 */
function savedUnknownCount(s: SavedSession): number {
  return Object.values(s.verdicts).filter((v) => v === false).length
}

export default function ReviewPage() {
  const [all, setAll] = useState<WordbookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<ReviewMode>('sequential')
  /** 中译英题目占比，0 = 全英译中，100 = 全中译英 */
  const [cnRatio, setCnRatio] = useState(50)
  /** 本轮要攒够多少生词。受控输入，空着 / 填 0 都回落到默认的 10 */
  const [limitText, setLimitText] = useState('10')
  const [queue, setQueue] = useState<ReviewCard<WordbookEntry>[]>([])
  const [skipped, setSkipped] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  /**
   * 每张卡当前记下的「认识 / 不认识」，键是卡在 queue 里的下标。
   * 有了上一个 / 下一个导航，同一张卡会被翻到不止一次，判定必须能改写、
   * 能回看，所以按下标存，而不是加加减减地累计计数。
   */
  const [verdicts, setVerdicts] = useState<Record<number, boolean>>({})
  // 判定要在事件里被同步读到（选完立刻翻页那条路），state 赶不上，另存一份
  const verdictsRef = useRef<Record<number, boolean>>({})
  /** 已经写进熟练度的那些卡，值是写进去的判定，用来避免重复写库 */
  const markedRef = useRef<Record<number, boolean>>({})
  /** 本轮的收工线，开始时定死，中途改输入框不影响正在跑的这轮 */
  const [limit, setLimit] = useState(10)
  /**
   * 队首「上一批」的张数。这些是必修课：攒够生词也不收工，非过完不可 ——
   * 昨天背过的词今天必须完整再过一遍，这是艾宾浩斯的整个意义所在。
   */
  const [mustDo, setMustDo] = useState(0)
  /** 这一轮是什么来路 —— 只有 regular 结算时会覆盖上一轮生词名单 */
  const [roundKind, setRoundKind] = useState<RoundKind>('regular')
  /** 本轮开始时刻，进本地存档，用来判断存档过没过期 */
  const startedAtRef = useRef(0)
  /** 上一轮生词名单（数据库里的那份），只存 id */
  const [leftoverIds, setLeftoverIds] = useState<string[]>([])
  /** 打开页面时发现的、上次没背完的那一轮 */
  const [pending, setPending] = useState<SavedSession | null>(null)
  /** 加载完成的时刻。冷却判断要一个「现在」，渲染里不能直接调 Date.now() */
  const [loadedAt, setLoadedAt] = useState(0)
  /** 待补写的请求条数，以及最近一次是不是因为登录过期失败的 */
  const [unsaved, setUnsaved] = useState(0)
  const [authExpired, setAuthExpired] = useState(false)

  // 没有中文释义的词本轮直接不排 —— 卡翻过去背面是空的，出了也没法背
  const usable = all.filter((e) => hasChineseMeaning(e.senses))
  const noSense = all.length - usable.length
  const cooling = usable.filter((e) => inCooldown(e, loadedAt)).length
  // 名单里已被删掉或没有释义的词数不进来
  const leftoverWords = leftoverIds
    .map((id) => usable.find((e) => e.id === id))
    .filter((e) => e !== undefined)

  const parsedLimit = Number.parseInt(limitText, 10)
  const nextLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10

  /** 发一条写库请求；失败了能重试的进补写队列，并刷新页面上的提示 */
  const deliver = useCallback((draft: OutboxDraft) => {
    void sendItem(draft, browserFetch).then((outcome) => {
      if (outcome === 'auth' || outcome === 'retry') {
        enqueue(draft)
        setUnsaved(readOutbox().length)
        if (outcome === 'auth') setAuthExpired(true)
      }
    })
  }, [])

  const flush = useCallback(() => {
    void flushOutbox(browserFetch).then((r) => {
      setUnsaved(r.remaining)
      setAuthExpired(r.authExpired)
    })
  }, [])

  /** 覆盖上一轮生词名单。本地立刻换上，免得回设置页还显示旧的 */
  const saveLeftover = useCallback(
    (ids: string[]) => {
      setLeftoverIds(ids)
      deliver({ kind: 'leftover', ids })
    },
    [deliver],
  )

  /**
   * 结算一份没走到完成页的存档（用户选了结束，或存档过期）：还没写库的判定补上，
   * 常规复习有生词就写名单。判定按卡上的词 id 发，不依赖单词本里还有没有这个词 ——
   * 删掉的词服务端会回 404，补写队列直接丢弃。
   */
  const settleSaved = useCallback(
    (s: SavedSession) => {
      for (const [k, known] of Object.entries(s.verdicts)) {
        const i = Number(k)
        const card = s.cards[i]
        if (!card || s.marked[i] === known) continue
        deliver({ kind: 'mark', id: card.id, known, quizType: card.type, reviewedAt: new Date().toISOString() })
      }
      if (shouldSaveLeftover(s.kind, s.verdicts)) {
        saveLeftover(unknownIds(s.verdicts, s.cards.map((c) => ({ item: { id: c.id } }))))
      }
      clearSession()
      setPending(null)
    },
    [deliver, saveLeftover],
  )

  useEffect(() => {
    const words = fetch('/api/wordbook')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: WordbookEntry[] }) => d.entries)
      .catch(() => [] as WordbookEntry[])
    const leftover = fetch('/api/review/leftover')
      .then((r) => (r.ok ? r.json() : { ids: [] }))
      .then((d: { ids: string[] }) => d.ids)
      .catch(() => [] as string[])
    // effect 被清理后（开发模式 StrictMode 会挂两次）这次加载的结果作废：
    // 晚到的旧结果会把用户刚结算的名单盖回去，过期存档也会被结算两遍
    let stale = false
    void Promise.all([words, leftover])
      .then(([entries, ids]) => {
        if (stale) return
        setAll(entries)
        setLeftoverIds(ids)
        const now = Date.now()
        setLoadedAt(now)
        const saved = loadSession()
        if (saved && isExpired(saved, now)) settleSaved(saved)
        else setPending(saved)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    // 上次没写进去的判定先补上（登录过期、断网留下的）
    flush()
    window.addEventListener('online', flush)
    window.addEventListener('focus', flush)
    return () => {
      stale = true
      window.removeEventListener('online', flush)
      window.removeEventListener('focus', flush)
    }
  }, [flush, settleSaved])

  // 进行中的这一轮落到本地：刷新、关页面、登录过期回来都能接着背
  useEffect(() => {
    if (phase !== 'reviewing') return
    saveSession({
      v: 1,
      kind: roundKind,
      limit: Number.isFinite(limit) ? limit : null,
      mustDo,
      cursor,
      cards: queue.map((c) => ({ id: c.item.id, type: c.type })),
      verdicts,
      marked: { ...markedRef.current },
      startedAt: startedAtRef.current,
    })
  }, [phase, roundKind, limit, mustDo, cursor, queue, verdicts])

  /** 开一轮新的：ordered 已经排好序，这里只管分题型、清账、进复习态 */
  function begin(
    kind: RoundKind,
    ordered: WordbookEntry[],
    roundLimit: number,
    seed: number,
    dueIds: Set<string> = new Set(),
  ) {
    // 还挂着一轮没背完的，开新一轮就等于结束它
    if (pending) settleSaved(pending)
    // 题型分配换一个种子，免得洗牌与分配抽同一串数
    const cards = assignQuizTypes(ordered, cnRatio, QUIZ_RULES, seed + 1)

    if (cards.length === 0) {
      setNotice(
        noSense > 0 && usable.length === 0
          ? '单词本里的词都还没有中文释义 —— 去单词本点「一键补全中文释义」。'
          : '这些词都没有中文释义，出不了中译英题 —— 把比例往「英译中」拖一点。',
      )
      setPhase('setup')
      return
    }

    setNotice(null)
    setRoundKind(kind)
    startedAtRef.current = Date.now()
    setQueue(cards)
    // dueIds 的词排在 ordered 最前面，分题型只会剔除、不会重排，所以它们
    // 在 cards 里仍是一段前缀，数出来的张数就是必修的下标区间
    setMustDo(cards.filter((c) => dueIds.has(c.item.id)).length)
    setSkipped(ordered.length - cards.length + noSense)
    setLimit(roundLimit)
    setCursor(0)
    verdictsRef.current = {}
    markedRef.current = {}
    setVerdicts({})
    setPhase('reviewing')
  }

  function start() {
    // 种子在点击时生成，避免服务端/客户端渲染不一致
    const seed = Date.now() % 2147483647
    const now = Date.now()
    // 熟练度满值、还在冷却期的词先拿掉 —— 必修批和巩固词里也不要它们
    const pool = usable.filter((e) => !inCooldown(e, now))
    if (usable.length > 0 && pool.length === 0) {
      setNotice(`单词本里的词都已掌握、还在 ${COOLDOWN_DAYS} 天冷却期里 —— 可以复习上一轮生词，或者过几天再来。`)
      return
    }
    // 一天内背过的词单独抽出来打乱，跟其余的词交替出 —— 到了生词目标就收工，
    // 撒得太匀等于一轮下来一个巩固词都撞不上。
    const { recent, rest } = splitRecent(pool, now)
    // 上一次复习那一批（通常就是昨天的）整批排到队首，必须完整过完才轮到新词
    const { due, older } = splitPrevious(rest, now)
    const ordered = [
      ...orderCards(due, mode, seed + 3),
      ...interleave(orderCards(recent, 'random', seed + 2), orderCards(older, mode, seed)),
    ]
    begin('regular', ordered, nextLimit, seed, new Set(due.map((e) => e.id)))
  }

  /** 复习上一轮生词：名单整批出完，没有收工线，不看冷却，也不覆盖名单 */
  function startLeftover() {
    const seed = Date.now() % 2147483647
    begin('leftover', orderCards(leftoverWords, mode, seed), Infinity, seed)
  }

  /** 接着背上次没背完的那一轮。题型沿用存档里的，不重抽 */
  function resume(s: SavedSession) {
    const r = restoreSession(s, all)
    if (!r) {
      settleSaved(s)
      return
    }
    setPending(null)
    setNotice(null)
    setRoundKind(s.kind)
    startedAtRef.current = s.startedAt
    setQueue(r.cards)
    setMustDo(r.mustDo)
    setSkipped(0)
    setLimit(s.limit ?? Infinity)
    setCursor(r.cursor)
    verdictsRef.current = r.verdicts
    markedRef.current = r.marked
    setVerdicts(r.verdicts)
    setPhase('reviewing')
  }

  /** 二次复习：只出本轮已判定的那些词，顺序打乱、题型重抽 */
  function repeatRound(words: WordbookEntry[]) {
    const seed = Date.now() % 2147483647
    // queue 里存的是开轮那一刻的快照，熟练度与拼写计数都是旧的。题型要按刚才
    // 记下的成绩重抽 —— 新词这会儿已经不是第一次背了，正该开始还拼写欠账 ——
    // 所以按 id 换成 all 里的最新值。
    const fresh = words.map((w) => all.find((e) => e.id === w.id) ?? w)
    begin('repeat', orderCards(fresh, 'random', seed), limit, seed)
  }

  /** 选定当前这张卡的判定。只落在本地：来回翻看不该反复写库 */
  const setVerdict = useCallback(
    (known: boolean) => {
      verdictsRef.current = { ...verdictsRef.current, [cursor]: known }
      setVerdicts(verdictsRef.current)
    },
    [cursor],
  )

  /**
   * 离开某张卡时才把判定写进熟练度，同一个值只写一次 —— 接口每调一次
   * review_count 就加一，翻回去看两眼不该算成复习了两遍。
   */
  const commit = useCallback(
    (index: number) => {
      const known = verdictsRef.current[index]
      if (known === undefined) return
      if (markedRef.current[index] === known) return
      const entry = queue[index]
      if (!entry) return
      markedRef.current[index] = known
      // 不等待接口返回 —— 标记失败不该阻塞复习节奏；失败了进补写队列，不会丢。
      // 题型要一起报上去：只有中译英答对才算还了一次拼写欠账
      const now = new Date().toISOString()
      deliver({ kind: 'mark', id: entry.item.id, known, quizType: entry.type, reviewedAt: now })
      // 本地照着服务端的规则同步算一遍：不然回设置页再开一轮时，all 里还是旧值 ——
      // 时间戳旧了，这一轮刚过完的词会被当成旧词，巩固批次就是空的；熟练度与拼写
      // 计数旧了，题型的两条强制规则会按过时的状态判，新词又被判成第一次背。
      setAll((prev) =>
        prev.map((e) =>
          e.id === entry.item.id
            ? {
                ...e,
                lastReviewedAt: now,
                reviewCount: e.reviewCount + 1,
                // e.familiarity 是这次之前的熟练度，正是「已掌握的词又忘了要清零」要看的值
                spellOkCount: nextSpellOkCount(e.spellOkCount, e.familiarity, known, entry.type),
                familiarity: nextFamiliarity(e.familiarity, known),
              }
            : e,
        ),
      )
    },
    [queue, deliver],
  )

  /** 本轮攒到的生词数 —— 答不出来的就算生词，不管它是新词还是昨天背过的 */
  const unknownCount = useCallback(
    () => Object.values(verdictsRef.current).filter((v) => v === false).length,
    [],
  )

  /** 走到完成页：清本地存档；常规复习有生词就覆盖名单 */
  const finish = useCallback(() => {
    setPhase('done')
    clearSession()
    if (shouldSaveLeftover(roundKind, verdictsRef.current)) {
      saveLeftover(unknownIds(verdictsRef.current, queue))
    }
  }, [roundKind, queue, saveLeftover])

  const go = useCallback(
    (target: number) => {
      commit(cursor)
      // 收工线只在往前走的时候判：已经攒够了还想往回翻看两眼，得让人翻得动。
      // target < mustDo 说明队首那批昨天的词还没过完，攒够生词也不许收工。
      if (target > cursor && target >= mustDo && unknownCount() >= limit) {
        finish()
        return
      }
      if (target >= queue.length) finish()
      else setCursor(Math.max(0, target))
    },
    [commit, cursor, queue.length, limit, mustDo, unknownCount, finish],
  )

  const prev = useCallback(() => go(cursor - 1), [go, cursor])
  const next = useCallback(() => go(cursor + 1), [go, cursor])

  /** 英译中的认识 / 不认识：标记并翻页，跟加导航之前一样 */
  const markAndNext = useCallback(
    (known: boolean) => {
      setVerdict(known)
      // setVerdict 已经同步写进 ref，go 里的 commit 拿得到这个新值
      go(cursor + 1)
    },
    [setVerdict, go, cursor],
  )

  const unsavedNote =
    unsaved > 0 ? (
      <p className="text-[0.8125rem] leading-[1.7] text-seal">
        {unsaved} 条判定还没保存
        {authExpired ? (
          <>
            {' '}—— 登录已过期，
            <Link href="/login" className="underline">
              重新登录
            </Link>
            后回到这里会自动补写。
          </>
        ) : (
          '，网络恢复后会自动补写。'
        )}
      </p>
    ) : null

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 text-[0.9375rem] text-ink-3 sm:px-6">
        加载中…
      </main>
    )
  }

  if (phase === 'setup') {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">复习 · 共 {all.length} 个单词</h2>
        {unsavedNote}
        {pending && (
          <div className="flex flex-col gap-3 rounded-[10px] border border-rule bg-card px-4 py-3">
            <p className="text-[0.9375rem] text-ink-2">
              上次有一轮没背完（第 {Math.min(pending.cursor + 1, pending.cards.length)} /{' '}
              {pending.cards.length} 张 · 生词 {savedUnknownCount(pending)} 个）。
              开始新的一轮也会把它结束掉。
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => resume(pending)}
                className="rounded-[10px] bg-ink px-4 py-1.5 text-sm font-medium text-card"
              >
                继续
              </button>
              <button
                type="button"
                onClick={() => settleSaved(pending)}
                className="rounded-[10px] border border-rule px-4 py-1.5 text-sm text-ink"
              >
                结束这一轮
              </button>
            </div>
          </div>
        )}
        {all.length === 0 ? (
          <p className="text-[0.9375rem] text-ink-3">
            单词本是空的。
            <Link href="/" className="text-ink underline">
              去收藏几个词
            </Link>
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="复习顺序"
              className="flex w-fit rounded-[10px] border border-rule bg-card p-0.5"
            >
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={`rounded-[8px] px-4 py-1.5 text-sm ${
                    mode === m.value
                      ? 'bg-ink font-medium text-card'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="new-limit" className="text-sm text-ink-2">
                今天要复习多少生词
              </label>
              <input
                id="new-limit"
                type="number"
                min={1}
                inputMode="numeric"
                value={limitText}
                onChange={(e) => setLimitText(e.target.value)}
                className="w-28 rounded-[10px] border border-rule bg-paper px-4 py-2 text-[1rem] text-ink focus:border-focus focus:outline-none"
              />
              <p className="text-[0.8125rem] leading-[1.7] text-ink-3">
                答不出来的就算生词，攒够 {nextLimit} 个这轮就收工 —— 出多少张卡不限。
                上一次复习过的那批词会整批排在最前面、必须全部过完才收工；
                今天已经背过的词也会打乱了掺进来，答不出来照样算生词。
                熟练度满 5 的词进入 {COOLDOWN_DAYS} 天冷却期，期满再出；答错会降回 4。
              </p>
              {cooling > 0 && (
                <p className="text-[0.8125rem] text-ink-3">
                  {cooling} 个已掌握的词在冷却中，满 {COOLDOWN_DAYS} 天后再出。
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="cn-ratio" className="text-sm text-ink-2">
                题型比例
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[0.8125rem] text-ink-3">英译中</span>
                <input
                  id="cn-ratio"
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={cnRatio}
                  onChange={(e) => setCnRatio(Number(e.target.value))}
                  className="w-56 accent-ink"
                />
                <span className="text-[0.8125rem] text-ink-3">中译英</span>
              </div>
              <p className="font-mono text-[0.8125rem] text-ink-3">
                英译中 {100 - cnRatio}% · 中译英 {cnRatio}%
              </p>
              <p className="text-[0.8125rem] leading-[1.7] text-ink-3">
                这个比例只管「没被规则挑走」的词，所以实际出题会偏离它：
                第一次背的词只出英译中 —— 还没见过的词凭空拼不出来；
                熟练度没满、又还没拼对满 {SPELL_QUOTA} 次的生词则一定出中译英，
                直到拼够为止（拼够之后照样可能被比例再抽中）。
              </p>
            </div>

            {noSense > 0 && (
              <p className="text-[0.8125rem] leading-[1.7] text-ink-3">
                {noSense} 个词还没有中文释义，本轮不出 —— 去
                <Link href="/wordbook" className="text-ink underline">
                  单词本
                </Link>
                点「一键补全中文释义」。
              </p>
            )}

            {notice && <p className="text-[0.9375rem] text-seal">{notice}</p>}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={start}
                className="rounded-[10px] bg-ink px-5 py-2 text-sm font-medium text-card"
              >
                开始
              </button>
              {leftoverWords.length > 0 && (
                <button
                  type="button"
                  onClick={startLeftover}
                  className="rounded-[10px] border border-rule px-5 py-2 text-sm text-ink"
                >
                  复习上一轮生词（{leftoverWords.length} 个）
                </button>
              )}
            </div>
            {leftoverWords.length > 0 && (
              <p className="text-[0.8125rem] leading-[1.7] text-ink-3">
                上一轮生词是最近一次常规复习里答不出来的那批，会整批出完、不设收工线。
                重练时记住了几个名单也不减，只有下一次常规复习有了新生词才会替换它。
              </p>
            )}
          </>
        )}
      </main>
    )
  }

  if (phase === 'done') {
    // 从 verdicts 现算，别累计 —— 中途改判、翻回去重选都要如实反映在这里。
    // 本轮的词 = 真给过判定的那些卡；只按「下一个」跳过去的不算复习过，
    // 也就不进二次复习的名单。
    const indices = Object.keys(verdicts).map(Number)
    const chosen = indices.map((i) => verdicts[i])
    const known = chosen.filter(Boolean).length
    const words = indices.map((i) => queue[i]?.item).filter((w) => w !== undefined)
    // 只重练答不出来的那些 —— 认识的再翻一遍是浪费时间
    const unknownWords = indices
      .filter((i) => verdicts[i] === false)
      .map((i) => queue[i]?.item)
      .filter((w) => w !== undefined)
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 py-10 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">本轮完成</h2>
        {unsavedNote}
        <p className="text-[0.9375rem] text-ink-2">
          共 {chosen.length} 个 · 认识 {known} · 不认识 {chosen.length - known}
        </p>
        {words.length > 0 && (
          <p className="text-[0.8125rem] leading-[1.7] text-ink-3">
            趁热再过一遍，顺序打乱、题型重抽。
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {unknownWords.length > 0 && (
            <button
              type="button"
              onClick={() => repeatRound(unknownWords)}
              className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card"
            >
              只练生词 {unknownWords.length} 个
            </button>
          )}
          {words.length > 0 && (
            <button
              type="button"
              onClick={() => repeatRound(words)}
              className={`rounded-[10px] px-4 py-2 text-sm ${
                unknownWords.length > 0
                  ? 'border border-rule text-ink'
                  : 'bg-ink font-medium text-card'
              }`}
            >
              全部再来 {words.length} 个
            </button>
          )}
          <button
            type="button"
            onClick={() => setPhase('setup')}
            className="rounded-[10px] border border-rule px-4 py-2 text-sm text-ink"
          >
            再来一轮
          </button>
          <Link
            href="/wordbook"
            className="rounded-[10px] border border-rule px-4 py-2 text-sm text-ink"
          >
            回单词本
          </Link>
        </div>
      </main>
    )
  }

  const entry = queue[cursor]
  const unknownSoFar = Object.values(verdicts).filter((v) => v === false).length
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
      {/* 进度看的是生词，不是卡片张数 —— 卡是出到攒够为止的，分母没有意义 */}
      {unsavedNote}
      <p className="font-mono text-[0.8125rem] text-ink-3">
        {Number.isFinite(limit)
          ? `第 ${cursor + 1} 张 · 生词 ${unknownSoFar} / ${limit}`
          : `${roundKind === 'leftover' ? '上一轮生词 · ' : ''}第 ${cursor + 1} / ${queue.length} 张 · 生词 ${unknownSoFar}`}
      </p>
      {cursor < mustDo && (
        <p className="text-[0.8125rem] text-ink-3">
          先把上一批背过的 {mustDo} 个词过完（{cursor + 1}/{mustDo}），过完才收工
        </p>
      )}
      {skipped > 0 && (
        <p className="text-[0.8125rem] text-ink-3">
          {skipped} 个无中文释义的词已跳过
        </p>
      )}

      {/* key={cursor}：换卡即重新挂载，翻面/作答状态自然归零。判定活在页面上，
          所以翻回上一张时它还在，卡片只负责把它显示出来 */}
      {entry.type === 'en2cn' ? (
        <ReviewFlipCard
          key={cursor}
          card={entry.item}
          verdict={verdicts[cursor] ?? null}
          onMark={markAndNext}
          canPrev={cursor > 0}
          onPrev={prev}
          onNext={next}
        />
      ) : (
        <ReviewInputCard
          key={cursor}
          card={entry.item}
          verdict={verdicts[cursor] ?? null}
          onVerdict={setVerdict}
          canPrev={cursor > 0}
          onPrev={prev}
          onNext={next}
        />
      )}
    </main>
  )
}

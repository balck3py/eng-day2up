# 复习「中译英」题型 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复习页新增「中译英」输入题型，与现有「英译中」翻卡按用户设定的比例在同一轮中穿插出现。

**Architecture:** 两个新的纯函数模块承载全部规则——`answer.ts` 判定作答、`quiz.ts` 按比例分配题型；两者都可脱离 React 单测。复习页拆成三个卡片组件（共用背面），页面本身只留队列调度与标记提交。不动数据库，不动接口。

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Tailwind v4, Vitest, Playwright

**设计文档:** `docs/superpowers/specs/2026-08-18-review-cn2en-design.md`

**工作目录:** `/Volumes/Data/github/eng-day2up/.claude/worktrees/translate-wordbook`（分支 `worktree-translate-wordbook`）

## Global Constraints

- 不新增数据库表或字段，不修改 `/api/review/mark` 的请求/响应格式
- 熟练度规则不变：`nextFamiliarity` 原样保留，答对 = `known: true`，答错 = `known: false`
- 标记提交只有一条路径——`page.tsx` 的 `mark(known)` 回调；卡片组件**不得**自己 `fetch`
- 颜色只用 `globals.css` 里已有的 token：正确用 `jade`，错误用 `seal`，不得新增颜色变量
- 单测环境是 `environment: 'node'`（见 `vitest.config.ts`），**不要**给 React 组件写单测、不要引入 jsdom；组件行为由 Playwright E2E 覆盖
- 现有单测 `src/lib/review/order.test.ts` 全程不得修改，它是 Task 1 重构无回归的证明
- 每个 Task 结束必须 commit
- 每个 Task 的验证命令统一是：`npm test`、`npx tsc --noEmit`、`npm run lint`

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/lib/review/prng.ts` | 确定性 PRNG，`order.ts` 与 `quiz.ts` 共用 | 新建（从 `order.ts` 抽出） |
| `src/lib/review/order.ts` | 复习顺序（顺序/随机） | 改（只改 import） |
| `src/lib/review/answer.ts` | 中译英作答判定 | 新建 |
| `src/lib/review/answer.test.ts` | 判定规则单测 | 新建 |
| `src/lib/review/quiz.ts` | 题型分配（比例 + 无释义剔除） | 新建 |
| `src/lib/review/quiz.test.ts` | 题型分配单测 | 新建 |
| `src/components/ReviewCardBack.tsx` | 卡片背面，两种题型共用 | 新建（从 `page.tsx` 抽出） |
| `src/components/ReviewFlipCard.tsx` | 英译中卡片 | 新建（从 `page.tsx` 抽出） |
| `src/components/ReviewInputCard.tsx` | 中译英卡片 | 新建 |
| `src/app/review/page.tsx` | 设置页、队列调度、计数、标记提交 | 改 |
| `e2e/full-flow.spec.ts` | 端到端 | 改 + 新增两个用例 |

---

## Task 1: 抽出共用 PRNG

纯重构，对外行为零变化。`order.ts` 的现有单测就是回归证明，所以本任务不写新测试。

**Files:**
- Create: `src/lib/review/prng.ts`
- Modify: `src/lib/review/order.ts:3-13`（删掉私有 `prng`，改为 import）

**Interfaces:**
- Consumes: 无
- Produces: `prng(seed: number): () => number` —— 返回 `[0, 1)` 区间的确定性随机数生成器

- [ ] **Step 1: 先跑一遍现有测试，确认改动前是绿的**

```bash
npx vitest run src/lib/review/order.test.ts
```

预期：9 个用例全部 PASS。若此时就是红的，停下来先查环境，别继续。

- [ ] **Step 2: 新建 `src/lib/review/prng.ts`**

```ts
/** mulberry32 —— 小巧的确定性 PRNG，让随机结果在测试中可复现。 */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 3: 改 `src/lib/review/order.ts`**

删掉文件里的 `prng` 函数定义（连同它上方的注释），在顶部加 import。改完整个文件是：

```ts
import { prng } from './prng'

export type ReviewMode = 'sequential' | 'random'

/** 返回新数组，不修改入参。 */
export function orderCards<T>(items: T[], mode: ReviewMode, seed: number): T[] {
  const out = [...items]
  if (mode === 'sequential') return out

  const rand = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
```

- [ ] **Step 4: 再跑同一批测试，确认仍是绿的**

```bash
npx vitest run src/lib/review/order.test.ts
```

预期：仍是 9 个 PASS。特别注意「相同种子产生相同结果」和「随机模式打乱顺序」——它们证明 PRNG 搬家后数列没变。

- [ ] **Step 5: 全量校验**

```bash
npm test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/review/prng.ts src/lib/review/order.ts
git commit -m "refactor: 抽出共用 PRNG，供题型分配复用"
```

---

## Task 2: 作答判定 `isAnswerCorrect`

**Files:**
- Create: `src/lib/review/answer.ts`
- Test: `src/lib/review/answer.test.ts`

**Interfaces:**
- Consumes: `normalizeWord(raw: string): string`，来自 `src/lib/text/normalize.ts`（已存在）——剥掉首尾非字母字符后转小写，词内撇号与连字符保留
- Produces: `isAnswerCorrect(input: string, word: string): boolean`

- [ ] **Step 1: 写失败的测试**

新建 `src/lib/review/answer.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { isAnswerCorrect } from './answer'

describe('isAnswerCorrect', () => {
  it('完全一致判对', () => {
    expect(isAnswerCorrect('serendipity', 'serendipity')).toBe(true)
  })
  it('忽略大小写', () => {
    expect(isAnswerCorrect('Serendipity', 'serendipity')).toBe(true)
    expect(isAnswerCorrect('SERENDIPITY', 'serendipity')).toBe(true)
  })
  it('忽略首尾空格', () => {
    expect(isAnswerCorrect('  serendipity  ', 'serendipity')).toBe(true)
  })
  it('忽略首尾标点', () => {
    expect(isAnswerCorrect('serendipity.', 'serendipity')).toBe(true)
    expect(isAnswerCorrect('"serendipity"', 'serendipity')).toBe(true)
  })
  it('词条侧也归一化', () => {
    expect(isAnswerCorrect('run', 'Run')).toBe(true)
  })
  it('词内连字符必须一致', () => {
    expect(isAnswerCorrect('wellbeing', 'well-being')).toBe(false)
    expect(isAnswerCorrect('well-being', 'well-being')).toBe(true)
  })
  it('词内撇号必须一致', () => {
    expect(isAnswerCorrect('dont', "don't")).toBe(false)
  })
  it('拼写错误判错', () => {
    expect(isAnswerCorrect('serendipty', 'serendipity')).toBe(false)
  })
  it('词形变化判错 —— 本题型就是拼写训练', () => {
    expect(isAnswerCorrect('running', 'run')).toBe(false)
    expect(isAnswerCorrect('cats', 'cat')).toBe(false)
  })
  it('空输入判错', () => {
    expect(isAnswerCorrect('', 'serendipity')).toBe(false)
  })
  it('纯空格输入判错', () => {
    expect(isAnswerCorrect('   ', 'serendipity')).toBe(false)
  })
  it('纯标点输入判错', () => {
    expect(isAnswerCorrect('...', 'serendipity')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/review/answer.test.ts
```

预期：FAIL，报错类似 `Failed to resolve import "./answer"`。

- [ ] **Step 3: 写最小实现**

新建 `src/lib/review/answer.ts`：

```ts
import { normalizeWord } from '@/lib/text/normalize'

/**
 * 中译英作答判定：宽松匹配 —— 忽略大小写、首尾空格与首尾标点；
 * 词内的撇号与连字符必须一致，词形变化与拼写误差一律判错（本题型就是拼写训练）。
 *
 * 空输入永远判错：异常词条归一化后也可能是空串，不能让两个空串互相匹配。
 */
export function isAnswerCorrect(input: string, word: string): boolean {
  const got = normalizeWord(input)
  if (got === '') return false
  return got === normalizeWord(word)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/review/answer.test.ts
```

预期：12 个用例全 PASS。

- [ ] **Step 5: 全量校验**

```bash
npm test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/review/answer.ts src/lib/review/answer.test.ts
git commit -m "feat: 中译英作答的宽松匹配判定"
```

---

## Task 3: 题型分配 `assignQuizTypes`

**Files:**
- Create: `src/lib/review/quiz.ts`
- Test: `src/lib/review/quiz.test.ts`

**Interfaces:**
- Consumes: `prng(seed: number): () => number`（Task 1）
- Produces:
  - `type QuizType = 'en2cn' | 'cn2en'`
  - `interface ReviewCard<T> { item: T; type: QuizType }`
  - `assignQuizTypes<T>(items: T[], cnRatio: number, canAskCn: (item: T) => boolean, seed: number): ReviewCard<T>[]`

- [ ] **Step 1: 写失败的测试**

新建 `src/lib/review/quiz.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { assignQuizTypes } from './quiz'

interface Item {
  id: number
  hasSenses: boolean
}

/** 20 个条目，其中 id 为偶数的没有中文释义 */
const ITEMS: Item[] = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  hasSenses: i % 2 === 1,
}))

const canAskCn = (x: Item) => x.hasSenses

describe('assignQuizTypes', () => {
  it('比例为 0 时全是英译中，且一个词都不丢', () => {
    const out = assignQuizTypes(ITEMS, 0, canAskCn, 42)
    expect(out).toHaveLength(20)
    expect(out.every((c) => c.type === 'en2cn')).toBe(true)
  })

  it('比例为 100 时全是中译英，且无释义的词全被剔除', () => {
    const out = assignQuizTypes(ITEMS, 100, canAskCn, 42)
    expect(out).toHaveLength(10)
    expect(out.every((c) => c.type === 'cn2en')).toBe(true)
    expect(out.every((c) => c.item.hasSenses)).toBe(true)
  })

  it('比例居中时两种题型都出现', () => {
    const out = assignQuizTypes(ITEMS, 50, canAskCn, 42)
    expect(out.some((c) => c.type === 'en2cn')).toBe(true)
    expect(out.some((c) => c.type === 'cn2en')).toBe(true)
  })

  it('被分到中译英的卡一定有中文释义', () => {
    const out = assignQuizTypes(ITEMS, 50, canAskCn, 42)
    expect(out.filter((c) => c.type === 'cn2en').every((c) => c.item.hasSenses)).toBe(true)
  })

  it('保留原有顺序', () => {
    const out = assignQuizTypes(ITEMS, 0, canAskCn, 42)
    expect(out.map((c) => c.item.id)).toEqual(ITEMS.map((i) => i.id))
  })

  it('相同种子产生相同结果', () => {
    const a = assignQuizTypes(ITEMS, 50, canAskCn, 7)
    const b = assignQuizTypes(ITEMS, 50, canAskCn, 7)
    expect(a).toEqual(b)
  })

  it('不同种子产生不同结果', () => {
    const a = assignQuizTypes(ITEMS, 50, canAskCn, 1)
    const b = assignQuizTypes(ITEMS, 50, canAskCn, 2)
    expect(a).not.toEqual(b)
  })

  it('比例越界时被夹到 0-100', () => {
    expect(assignQuizTypes(ITEMS, -20, canAskCn, 42)).toEqual(
      assignQuizTypes(ITEMS, 0, canAskCn, 42),
    )
    expect(assignQuizTypes(ITEMS, 999, canAskCn, 42)).toEqual(
      assignQuizTypes(ITEMS, 100, canAskCn, 42),
    )
  })

  it('不修改入参数组', () => {
    const copy = [...ITEMS]
    assignQuizTypes(copy, 50, canAskCn, 42)
    expect(copy).toEqual(ITEMS)
  })

  it('空数组返回空数组', () => {
    expect(assignQuizTypes([], 50, canAskCn, 42)).toEqual([])
  })

  it('全部无释义 + 比例 100 时返回空数组', () => {
    const none = ITEMS.map((i) => ({ ...i, hasSenses: false }))
    expect(assignQuizTypes(none, 100, canAskCn, 42)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/review/quiz.test.ts
```

预期：FAIL，报错类似 `Failed to resolve import "./quiz"`。

- [ ] **Step 3: 写最小实现**

新建 `src/lib/review/quiz.ts`：

```ts
import { prng } from './prng'

export type QuizType = 'en2cn' | 'cn2en'

/** 一张待复习的卡：词条本身 + 这一轮要考的题型。 */
export interface ReviewCard<T> {
  item: T
  type: QuizType
}

/**
 * 按 cnRatio（0-100，中译英占比）给每张卡随机分配题型。
 *
 * 被分到中译英但 canAskCn 为假的卡直接剔除 —— 中译英的题面就是中文释义，
 * 没有释义就没有题面。只在「抽中中译英」时才剔除，所以 cnRatio = 0 时
 * 一个词都不会丢，行为与加这个功能之前完全一致。
 *
 * 剔除会让实际交付的比例偏离设定值，这是有意的；调用方负责把跳过的数量
 * 显示给用户，否则数字对不上会让人困惑。
 */
export function assignQuizTypes<T>(
  items: T[],
  cnRatio: number,
  canAskCn: (item: T) => boolean,
  seed: number,
): ReviewCard<T>[] {
  const ratio = Math.min(Math.max(cnRatio, 0), 100) / 100
  const rand = prng(seed)
  const out: ReviewCard<T>[] = []
  for (const item of items) {
    // 每张卡都消费一个随机数，与它最终是否被剔除无关 —— 否则剔除会让
    // 后续卡片的分配随之漂移，同种子不再可复现。
    const wantsCn = rand() < ratio
    if (!wantsCn) out.push({ item, type: 'en2cn' })
    else if (canAskCn(item)) out.push({ item, type: 'cn2en' })
  }
  return out
}
```

`rand()` 返回 `[0, 1)`：`ratio = 0` 时 `rand() < 0` 恒假（全英译中），`ratio = 1` 时 `rand() < 1` 恒真（全中译英）。两个边界都不靠运气。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/review/quiz.test.ts
```

预期：11 个用例全 PASS。

- [ ] **Step 5: 全量校验**

```bash
npm test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/review/quiz.ts src/lib/review/quiz.test.ts
git commit -m "feat: 按比例分配复习题型，无中文释义的词跳过中译英"
```

---

## Task 4: 拆出 `ReviewCardBack` 与 `ReviewFlipCard`

纯重构，页面行为零变化。验证靠现有 E2E——它此刻必须仍然全绿。

**Files:**
- Create: `src/components/ReviewCardBack.tsx`
- Create: `src/components/ReviewFlipCard.tsx`
- Modify: `src/app/review/page.tsx`

**Interfaces:**
- Consumes: `WordbookEntry`（`src/lib/wordbook/types.ts`）、`AudioButton`（`src/components/AudioButton.tsx`）
- Produces:
  - `ReviewCardBack({ card }: { card: WordbookEntry })`
  - `ReviewFlipCard({ card, onMark }: { card: WordbookEntry; onMark: (known: boolean) => void })` —— `onMark` 由父级负责「记分 + 提交 + 翻到下一张」，组件自己不推进游标

- [ ] **Step 1: 新建 `src/components/ReviewCardBack.tsx`**

内容整体搬自 `page.tsx` 里 `revealed ? (...)` 分支的那个 `<div className="mt-5 border-t ...">`，一个字不改：

```tsx
'use client'

import type { WordbookEntry } from '@/lib/wordbook/types'
import { AudioButton } from '@/components/AudioButton'

/**
 * 卡片背面：音标 / 发音 / 释义 / 例句 / 熟练度。
 * 英译中翻面后与中译英提交后展示的是同一块内容，抽出来共用。
 */
export function ReviewCardBack({ card }: { card: WordbookEntry }) {
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {card.phonetic && (
          <span className="font-mono text-[0.9rem] text-ink-2">{card.phonetic}</span>
        )}
        <AudioButton word={card.word} />
      </div>
      {card.senses.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {card.senses.map((s, i) => (
            <li key={i} className="text-[1rem] leading-[1.7] text-ink">
              {s.pos && (
                <span className="mr-1.5 font-mono text-[0.8125rem] text-ink-2">{s.pos}</span>
              )}
              {s.meaning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.9375rem] text-ink-3">词库暂无中文释义</p>
      )}
      {card.sourceContext && (
        <p className="mt-3 text-[0.875rem] leading-[1.7] text-ink-3">“{card.sourceContext}”</p>
      )}
      <p className="mt-3 font-mono text-[0.75rem] text-ink-3">
        熟练度 {card.familiarity}/5 · 已复习 {card.reviewCount} 次
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 新建 `src/components/ReviewFlipCard.tsx`**

`revealed` 状态和键盘监听都从 `page.tsx` 搬进来。键盘监听必须住在组件里——中译英卡片上输入框要吃空格，全局监听会和它打架。

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { ReviewCardBack } from '@/components/ReviewCardBack'

/**
 * 英译中：正面出英文，点击或空格翻面，翻面后按 1 / 2 标记。
 * 翻面状态靠父级传 key 重置（换卡即重新挂载），组件内不做同步。
 */
export function ReviewFlipCard({
  card,
  onMark,
}: {
  card: WordbookEntry
  onMark: (known: boolean) => void
}) {
  const [revealed, setRevealed] = useState(false)

  // 键盘操作：空格翻面，翻面后 1 / 2 标记
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed((r) => !r)
        return
      }
      if (!revealed) return
      if (e.key === '1') onMark(false)
      if (e.key === '2') onMark(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, onMark])

  return (
    <>
      {/* 用 div 而非 button 作卡片外壳：翻面后卡内有发音按钮，button 嵌 button 是非法
          HTML。空格翻面由上面的 keydown 处理，这里再补 Enter，role/tabIndex 保证可聚焦。 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setRevealed(!revealed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setRevealed((r) => !r)
        }}
        className="min-h-56 cursor-pointer rounded-[10px] border border-rule bg-card p-8 text-left shadow-[0_1px_2px_rgba(20,33,61,0.04)] focus:border-focus focus:outline-none"
      >
        <p
          data-testid="review-word"
          className="text-[2.25rem] font-semibold tracking-[-0.02em] text-ink"
        >
          {card.word}
        </p>
        {revealed ? (
          <ReviewCardBack card={card} />
        ) : (
          <p className="mt-5 text-[0.9375rem] text-ink-3">点击或按空格翻面</p>
        )}
      </div>

      {revealed && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onMark(false)}
            className="flex-1 rounded-[10px] border border-rule py-3 text-sm text-ink"
          >
            不认识 <span className="font-mono text-[0.75rem] text-ink-3">1</span>
          </button>
          <button
            type="button"
            onClick={() => onMark(true)}
            className="flex-1 rounded-[10px] bg-ink py-3 text-sm font-medium text-card"
          >
            认识 <span className="font-mono text-[0.75rem] text-card/70">2</span>
          </button>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: 改 `src/app/review/page.tsx` 用上新组件**

这一步只做搬迁，队列结构、比例滑杆都还不动。改动点：

1. 删掉 `revealed` state 和那段全局 `keydown` 的 `useEffect`
2. `mark` 里删掉 `setRevealed(false)`，其余保留
3. 顶部 import 换成 `import { ReviewFlipCard } from '@/components/ReviewFlipCard'`，删掉不再用到的 `AudioButton` import
4. 复习中那一大段 JSX（从 `<div role="button" ...>` 到末尾的按钮组）整体替换为：

```tsx
<ReviewFlipCard key={cursor} card={card} onMark={mark} />
```

`key={cursor}` 是关键：换卡时强制重新挂载，翻面状态自然归零，不需要额外的同步 effect。

改完后 `page.tsx` 里保留的 `mark` 应当是：

```tsx
const mark = useCallback(
  (known: boolean) => {
    const card = queue[cursor]
    if (!card) return
    setStats((s) => ({
      known: s.known + (known ? 1 : 0),
      unknown: s.unknown + (known ? 0 : 1),
    }))
    // 不等待接口返回就翻下一张 —— 标记失败不该阻塞复习节奏
    void fetch('/api/review/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: card.id, known }),
    })
    if (cursor + 1 >= queue.length) setPhase('done')
    else setCursor(cursor + 1)
  },
  [queue, cursor],
)
```

- [ ] **Step 4: 类型与静态检查**

```bash
npx tsc --noEmit && npm run lint && npm test
```

预期：全绿。`npm test` 这里不覆盖组件，但要确保 Task 1-3 的单测没被带坏。

- [ ] **Step 5: 跑现有 E2E，确认页面行为一字未变**

```bash
npx playwright test --grep "复习流程走完一轮并更新熟练度|随机模式打乱顺序"
```

预期：2 个用例 PASS。这两个用例覆盖了翻面、标记、熟练度回写和随机顺序——它们绿了就说明重构无回归。

若失败，**不要**改测试来迁就代码，回头查搬迁时漏掉了什么。

- [ ] **Step 6: Commit**

```bash
git add src/components/ReviewCardBack.tsx src/components/ReviewFlipCard.tsx src/app/review/page.tsx
git commit -m "refactor: 复习卡片拆成独立组件，背面共用"
```

---

## Task 5: 中译英卡片 `ReviewInputCard`

本任务只建组件、不接线，页面此时还看不到它。接线在 Task 6，E2E 覆盖在 Task 7。

**Files:**
- Create: `src/components/ReviewInputCard.tsx`

**Interfaces:**
- Consumes: `isAnswerCorrect(input, word)`（Task 2）、`ReviewCardBack`（Task 4）、`WordbookEntry`
- Produces: `ReviewInputCard({ card, onMark, onNext }: { card: WordbookEntry; onMark: (known: boolean) => void; onNext: () => void })`
  - `onMark` 只记分与提交，**不**推进游标
  - `onNext` 只推进游标，**不**记分

- [ ] **Step 1: 新建 `src/components/ReviewInputCard.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { isAnswerCorrect } from '@/lib/review/answer'
import { ReviewCardBack } from '@/components/ReviewCardBack'

type Result = 'correct' | 'wrong'

/**
 * 中译英：题面只出中文释义 —— 音标会泄露拼写，例句里通常直接含着这个词，
 * 两者都不能在作答前露出。
 *
 * 提交即判定即写熟练度，但**不**自动翻页：答错时要留出看清正确答案的时间。
 */
export function ReviewInputCard({
  card,
  onMark,
  onNext,
}: {
  card: WordbookEntry
  onMark: (known: boolean) => void
  onNext: () => void
}) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 已判定后回车进入下一张。作答时的那次回车走 input 自己的 onKeyDown，
  // 监听是在它引发的 state 更新之后才挂上的，不会被同一个事件连带触发。
  useEffect(() => {
    if (result === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, onNext])

  function submit() {
    if (result !== null) return
    const correct = isAnswerCorrect(input, card.word)
    setResult(correct ? 'correct' : 'wrong')
    onMark(correct)
  }

  return (
    <>
      <div className="min-h-56 rounded-[10px] border border-rule bg-card p-8 shadow-[0_1px_2px_rgba(20,33,61,0.04)]">
        <ul className="flex flex-col gap-1.5">
          {card.senses.map((s, i) => (
            <li key={i} className="text-[1.25rem] leading-[1.6] text-ink">
              {s.pos && (
                <span className="mr-1.5 font-mono text-[0.8125rem] text-ink-2">{s.pos}</span>
              )}
              {s.meaning}
            </li>
          ))}
        </ul>

        {result === null ? (
          <div className="mt-6 flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              aria-label="输入英文单词"
              placeholder="输入英文单词"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 rounded-[10px] border border-rule bg-paper px-4 py-2.5 text-[1rem] text-ink placeholder:text-ink-3 focus:border-focus focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              className="rounded-[10px] bg-ink px-5 py-2.5 text-sm font-medium text-card"
            >
              提交
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <p
              className={`text-sm font-medium ${
                result === 'correct' ? 'text-jade' : 'text-seal'
              }`}
            >
              {result === 'correct' ? '答对' : '答错'}
            </p>
            <p className="mt-2 flex flex-wrap items-baseline gap-3">
              <span
                data-testid="review-answer"
                className="text-[2.25rem] font-semibold tracking-[-0.02em] text-ink"
              >
                {card.word}
              </span>
              {result === 'wrong' && (
                <span
                  data-testid="review-wrong-input"
                  className="font-mono text-[1rem] text-seal line-through"
                >
                  {input}
                </span>
              )}
            </p>
            <ReviewCardBack card={card} />
          </div>
        )}
      </div>

      {result !== null && (
        <button
          type="button"
          onClick={onNext}
          className="rounded-[10px] bg-ink py-3 text-sm font-medium text-card"
        >
          下一个 <span className="font-mono text-[0.75rem] text-card/70">Enter</span>
        </button>
      )}
    </>
  )
}
```

答错时用户的输入若是空串，`review-wrong-input` 会渲染成空的 `<span>`——这是可接受的：正确答案仍然显示，「答错」文字也在。不必为空输入加特殊分支。

- [ ] **Step 2: 类型与静态检查**

```bash
npx tsc --noEmit && npm run lint
```

预期：全绿。组件尚未被引用，ESLint 不会因此报错。

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewInputCard.tsx
git commit -m "feat: 中译英输入卡片"
```

---

## Task 6: 复习页接线 —— 比例滑杆 + 混合队列

**Files:**
- Modify: `src/app/review/page.tsx`

**Interfaces:**
- Consumes: `orderCards` / `ReviewMode`（已有）、`assignQuizTypes` / `ReviewCard`（Task 3）、`ReviewFlipCard`（Task 4）、`ReviewInputCard`（Task 5）
- Produces: 无（页面组件）

- [ ] **Step 1: 改写 `src/app/review/page.tsx`**

整个文件改成下面这样。相对 Task 4 结束时的状态，变化是：队列元素变成 `ReviewCard<WordbookEntry>`、新增 `cnRatio` / `skipped` / `notice` 三个 state、`mark` 与 `next` 拆开、设置页多一条滑杆。

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { orderCards, type ReviewMode } from '@/lib/review/order'
import { assignQuizTypes, type ReviewCard } from '@/lib/review/quiz'
import type { WordbookEntry } from '@/lib/wordbook/types'
import { ReviewFlipCard } from '@/components/ReviewFlipCard'
import { ReviewInputCard } from '@/components/ReviewInputCard'

type Phase = 'setup' | 'reviewing' | 'done'

const MODES: { value: ReviewMode; label: string }[] = [
  { value: 'sequential', label: '顺序' },
  { value: 'random', label: '随机' },
]

export default function ReviewPage() {
  const [all, setAll] = useState<WordbookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<ReviewMode>('sequential')
  /** 中译英题目占比，0 = 全英译中，100 = 全中译英 */
  const [cnRatio, setCnRatio] = useState(50)
  const [queue, setQueue] = useState<ReviewCard<WordbookEntry>[]>([])
  const [skipped, setSkipped] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [stats, setStats] = useState({ known: 0, unknown: 0 })

  useEffect(() => {
    void fetch('/api/wordbook')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: WordbookEntry[] }) => setAll(d.entries))
      .catch(() => setAll([]))
      .finally(() => setLoading(false))
  }, [])

  function start() {
    // 种子在点击时生成，避免服务端/客户端渲染不一致
    const seed = Date.now() % 2147483647
    const ordered = orderCards(all, mode, seed)
    // 题型分配换一个种子，免得洗牌与分配抽同一串数
    const cards = assignQuizTypes(ordered, cnRatio, (e) => e.senses.length > 0, seed + 1)

    if (cards.length === 0) {
      setNotice('这些词都没有中文释义，出不了中译英题 —— 把比例往「英译中」拖一点。')
      return
    }

    setNotice(null)
    setQueue(cards)
    setSkipped(ordered.length - cards.length)
    setCursor(0)
    setStats({ known: 0, unknown: 0 })
    setPhase('reviewing')
  }

  /** 只记分与提交，不推进游标 —— 中译英要停下来给用户看正确答案 */
  const mark = useCallback(
    (known: boolean) => {
      const entry = queue[cursor]
      if (!entry) return
      setStats((s) => ({
        known: s.known + (known ? 1 : 0),
        unknown: s.unknown + (known ? 0 : 1),
      }))
      // 不等待接口返回 —— 标记失败不该阻塞复习节奏
      void fetch('/api/review/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.item.id, known }),
      })
    },
    [queue, cursor],
  )

  const next = useCallback(() => {
    if (cursor + 1 >= queue.length) setPhase('done')
    else setCursor(cursor + 1)
  }, [cursor, queue.length])

  /** 英译中标记完即翻页，保持原来的节奏 */
  const markAndNext = useCallback(
    (known: boolean) => {
      mark(known)
      next()
    },
    [mark, next],
  )

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
            </div>

            {notice && <p className="text-[0.9375rem] text-seal">{notice}</p>}

            <button
              type="button"
              onClick={start}
              className="self-start rounded-[10px] bg-ink px-5 py-2 text-sm font-medium text-card"
            >
              开始
            </button>
          </>
        )}
      </main>
    )
  }

  if (phase === 'done') {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 py-10 sm:px-6">
        <h2 className="text-lg font-semibold text-ink">本轮完成</h2>
        <p className="text-[0.9375rem] text-ink-2">
          共 {queue.length} 个 · 认识 {stats.known} · 不认识 {stats.unknown}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPhase('setup')}
            className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card"
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
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-10 sm:px-6">
      <p className="font-mono text-[0.8125rem] text-ink-3">
        {cursor + 1} / {queue.length}
      </p>
      {skipped > 0 && (
        <p className="text-[0.8125rem] text-ink-3">
          本轮 {queue.length} 个 · {skipped} 个无中文释义已跳过
        </p>
      )}

      {/* key={cursor}：换卡即重新挂载，翻面/作答状态自然归零 */}
      {entry.type === 'en2cn' ? (
        <ReviewFlipCard key={cursor} card={entry.item} onMark={markAndNext} />
      ) : (
        <ReviewInputCard key={cursor} card={entry.item} onMark={mark} onNext={next} />
      )}
    </main>
  )
}
```

- [ ] **Step 2: 类型与静态检查**

```bash
npx tsc --noEmit && npm run lint && npm test
```

预期：全绿。

- [ ] **Step 3: 起开发服务器手动过一遍**

```bash
npm run dev
```

打开 `/review`，逐条确认：

1. 设置页有「题型比例」滑杆，左右标着「英译中」「中译英」，默认停在中间，下方显示 `英译中 50% · 中译英 50%`
2. 滑杆拖到最左 → 开始 → 全程都是翻卡，空格能翻面，`1` / `2` 能标记
3. 滑杆拖到最右 → 开始 → 出的是中文释义 + 输入框，页面上**看不到**英文单词、音标和例句
4. 输入正确 → 显示绿色「答对」和正确答案；输入错误 → 显示红色「答错」、正确答案，以及带删除线的用户输入
5. 判定后按回车进入下一张
6. 中译英卡片上敲空格，空格进到输入框里，页面不翻面
7. 若跳过了词，进度行下方出现「N 个无中文释义已跳过」

跑完 `Ctrl+C` 停掉服务器。

- [ ] **Step 4: Commit**

```bash
git add src/app/review/page.tsx
git commit -m "feat: 复习页比例滑杆，两种题型混合出题"
```

---

## Task 7: 端到端测试

**Files:**
- Modify: `e2e/full-flow.spec.ts`（两个现有用例改比例，末尾追加两个新用例）

**Interfaces:**
- Consumes: `data-testid="review-word"`（Task 4）、`data-testid="review-answer"` / `data-testid="review-wrong-input"`（Task 5）、`aria-label="输入英文单词"`（Task 5）、`<label for="cn-ratio">题型比例</label>`（Task 6）

- [ ] **Step 1: 修现有用例 `复习流程走完一轮并更新熟练度`**

`alpha` / `beta` / `gamma` 这类测试词在词库里大概率没有中文释义，默认 50% 比例下会被跳过一部分，`3 / 3` 的断言就对不上。把滑杆先拖到最左，锁成纯英译中。

在 `await page.getByRole('radio', { name: '顺序' }).click()` 之后、`点击「开始」` 之前插入一行：

```ts
  await page.getByLabel('题型比例').fill('0')
```

该用例其余部分一字不改。

- [ ] **Step 2: 修现有用例 `随机模式打乱顺序`**

同理，`firstCardWord` 里在选完「随机」之后、点「开始」之前插入同一行。改完这个辅助函数是：

```ts
  async function firstCardWord(): Promise<string> {
    await page.goto('/review')
    await page.getByRole('radio', { name: '随机' }).click()
    // 锁成纯英译中：这些测试词没有中文释义，混合比例下会被跳过
    await page.getByLabel('题型比例').fill('0')
    await page.getByRole('button', { name: '开始' }).click()
    return (await page.getByTestId('review-word').first().textContent()) ?? ''
  }
```

- [ ] **Step 3: 跑这两个用例，确认改完是绿的**

```bash
npx playwright test --grep "复习流程走完一轮并更新熟练度|随机模式打乱顺序"
```

预期：2 个 PASS。

若 `fill('0')` 报错说不能对该元素填值，改用直接派发事件的写法：

```ts
  await page.locator('#cn-ratio').evaluate((el) => {
    const input = el as HTMLInputElement
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
```

- [ ] **Step 4: 在 `e2e/full-flow.spec.ts` 末尾追加两个新用例**

```ts
test('中译英答对', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  // 中译英的题面就是中文释义 —— 词库里没释义的话这个用例本身没意义，先确认
  const res = await page.request.get('/api/wordbook')
  const { entries } = (await res.json()) as { entries: { senses: unknown[] }[] }
  expect(entries[0].senses.length).toBeGreaterThan(0)

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  // 作答前不能泄题：英文单词一次都不该出现在页面上
  await expect(page.getByText('serendipity', { exact: true })).toHaveCount(0)

  // 大小写与尾部标点都该被宽松匹配吃掉
  await page.getByLabel('输入英文单词').fill('Serendipity.')
  await page.getByRole('button', { name: '提交' }).click()

  await expect(page.getByText('答对')).toBeVisible()
  await expect(page.getByTestId('review-answer')).toHaveText('serendipity')

  // 判定后回车进下一张 —— 只有一个词，直接到结算页
  await page.keyboard.press('Enter')
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/认识 1/)).toBeVisible()
})

test('中译英答错时显示正确答案与用户输入', async ({ page }) => {
  await page.request.post('/api/wordbook', { data: { word: 'serendipity' } })

  await page.goto('/review')
  await page.getByLabel('题型比例').fill('100')
  await page.getByRole('button', { name: '开始' }).click()

  await page.getByLabel('输入英文单词').fill('serendipty')
  await page.getByRole('button', { name: '提交' }).click()

  await expect(page.getByText('答错')).toBeVisible()
  await expect(page.getByTestId('review-answer')).toHaveText('serendipity')
  await expect(page.getByTestId('review-wrong-input')).toHaveText('serendipty')

  await page.getByRole('button', { name: /下一个/ }).click()
  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/不认识 1/)).toBeVisible()
})
```

若 Step 4 开头那句 `senses.length` 断言挂了，说明 `serendipity` 在这个环境的词库里没有中文释义。换一个确定有释义的常见词（例如 `abandon`），两个新用例里的单词一并替换——**不要**删掉这句断言，它是这两个用例的前提。

- [ ] **Step 5: 跑新用例**

```bash
npx playwright test --grep "中译英"
```

预期：2 个 PASS。

- [ ] **Step 6: 跑全量 E2E**

```bash
npx playwright test
```

预期：全部 PASS。

- [ ] **Step 7: 全量校验**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

预期：全绿。

- [ ] **Step 8: Commit**

```bash
git add e2e/full-flow.spec.ts
git commit -m "test: 中译英题型的端到端覆盖"
```

---

## 验收标准

对照设计文档第 8 节逐条确认：

1. 设置页可拖动比例滑杆，两端与中点均可选，实时显示百分比
2. 滑杆最左时全程英译中，行为与改动前完全一致
3. 滑杆最右时全程中译英，无中文释义的词被跳过并显示跳过提示
4. 中译英题面不出现英文单词、音标、发音按钮与例句
5. 输入正确（含大小写 / 首尾空格 / 首尾标点差异）判对并 `familiarity + 1`
6. 输入错误判错并 `familiarity - 1`，同时显示正确答案与用户输入
7. 英译中卡片上空格翻面、`1` / `2` 标记照常工作
8. 中译英卡片上空格可正常输入，回车提交，再回车进入下一张
9. `npm test` 与 `npm run test:e2e` 全绿

额外（设计文档写完后补的边界）：

10. 单词本里的词全部没有中文释义、且比例拉到最右时，点「开始」不崩溃，而是留在设置页并提示把比例往回拖

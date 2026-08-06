# Plan 3 · 单词本与复习 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付完整产品 —— 收藏单词、查看与管理单词本、顺序/随机翻卡复习，并部署上线。

**Architecture:** `wordbook` 表已在 Plan 1 建好（含 RLS 与 SM-2 预留字段），本计划只补 CRUD 与两个页面。复习的排序逻辑做成带种子的纯函数以便确定性测试。最后接 Playwright E2E 跑通全链路并部署到 Vercel。

**Tech Stack:** 承接 Plan 1 / Plan 2 —— TypeScript, Next.js 15 App Router, Supabase, Vitest, Playwright

**前置条件:** Plan 1 与 Plan 2 全部任务已完成，`npm test` 与 `npm run build` 均通过。

## Global Constraints

- 承接 Plan 1 / Plan 2 的全部 Global Constraints
- 单词本读写一律通过**用户会话客户端**（`createServerSupabase`），依赖 RLS 做隔离；**不得**用 `createAdminSupabase` 绕过 RLS
- 收藏的是**原型**（`lookupWord` 返回的 `word`），不是用户输入的表面形式 —— 否则 `running` 和 `run` 会被存成两条
- 第一版**不实现 SM-2 调度**，只更新 `review_count` / `familiarity` / `last_reviewed_at`；`due_at` / `ease_factor` / `interval_days` 保持默认值不动
- 每个 Task 结束必须 commit

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/lib/wordbook/types.ts` | 单词本共享类型 |
| `src/lib/review/order.ts` | 复习顺序（纯函数，带种子） |
| `src/lib/review/mark.ts` | 熟练度更新规则（纯函数） |
| `src/app/api/wordbook/route.ts` | 列表与新增 |
| `src/app/api/wordbook/[id]/route.ts` | 删除 |
| `src/app/api/review/mark/route.ts` | 复习标记 |
| `src/components/FavoriteButton.tsx` | 收藏切换按钮 |
| `src/app/wordbook/page.tsx` | 单词本页 |
| `src/app/review/page.tsx` | 复习页 |
| `src/components/NavBar.tsx` | 顶部导航（主页 / 单词本 / 登出） |
| `e2e/full-flow.spec.ts` | 端到端测试 |
| `playwright.config.ts` | Playwright 配置 |

---

### Task 1: 单词本接口

**Files:**
- Create: `src/lib/wordbook/types.ts`
- Create: `src/app/api/wordbook/route.ts`
- Create: `src/app/api/wordbook/[id]/route.ts`

**Interfaces:**
- Consumes: `createServerSupabase`（Plan 1 Task 4）、`normalizeWord`（Plan 1 Task 2）
- Produces:
  - `interface WordbookEntry { id: string; word: string; wordKey: string; sourceContext: string | null; note: string | null; reviewCount: number; familiarity: number; lastReviewedAt: string | null; createdAt: string }`
  - `GET /api/wordbook?q=<搜索词>&tag=<标签>` → `{ entries: WordbookEntry[] }`
  - `POST /api/wordbook` body `{ word, sourceContext? }` → `{ entry: WordbookEntry }`（已存在则返回既有记录，不报错）
  - `DELETE /api/wordbook/:id` → `{ ok: true }`

- [ ] **Step 1: 定义类型**

创建 `src/lib/wordbook/types.ts`：

```ts
export interface WordbookEntry {
  id: string
  word: string
  wordKey: string
  sourceContext: string | null
  note: string | null
  reviewCount: number
  familiarity: number
  lastReviewedAt: string | null
  createdAt: string
}

/** 数据库行 → 前端类型。集中在一处，避免每个调用点各写一遍字段映射。 */
export function toEntry(row: Record<string, unknown>): WordbookEntry {
  return {
    id: row.id as string,
    word: row.word as string,
    wordKey: row.word_key as string,
    sourceContext: (row.source_context as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    reviewCount: (row.review_count as number) ?? 0,
    familiarity: (row.familiarity as number) ?? 0,
    lastReviewedAt: (row.last_reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }
}
```

- [ ] **Step 2: 实现列表与新增**

创建 `src/app/api/wordbook/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { normalizeWord } from '@/lib/text/normalize'
import { toEntry } from '@/lib/wordbook/types'

const COLS = 'id, word, word_key, source_context, note, review_count, familiarity, last_reviewed_at, created_at'

export async function GET(request: Request) {
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''

  // RLS 已保证只能看到自己的记录，这里不需要再加 user_id 条件
  let query = db.from('wordbook').select(COLS).order('created_at', { ascending: false })
  if (q) query = query.ilike('word', `%${q}%`)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    entries: (data ?? []).map((r) => toEntry(r as Record<string, unknown>)),
  })
}

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    { word?: unknown; sourceContext?: unknown } | null
  const word = typeof body?.word === 'string' ? body.word.trim() : ''
  const wordKey = normalizeWord(word)
  if (!wordKey) return NextResponse.json({ error: '缺少单词' }, { status: 400 })

  const sourceContext = typeof body?.sourceContext === 'string'
    ? body.sourceContext.slice(0, 500) : null

  // 已收藏时返回既有记录而不是报错 —— 重复收藏对用户来说不是错误
  const { data: existing } = await db
    .from('wordbook').select(COLS).eq('word_key', wordKey).maybeSingle()
  if (existing) {
    return NextResponse.json({ entry: toEntry(existing as Record<string, unknown>) })
  }

  const { data, error } = await db
    .from('wordbook')
    .insert({ user_id: user.id, word, word_key: wordKey, source_context: sourceContext })
    .select(COLS)
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ entry: toEntry(data as Record<string, unknown>) })
}
```

- [ ] **Step 3: 实现删除**

创建 `src/app/api/wordbook/[id]/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  // RLS 保证只能删自己的记录，删别人的会静默影响 0 行
  const { error } = await db.from('wordbook').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: 手动验证 CRUD**

```bash
npm run dev
```

在已登录的浏览器控制台依次运行：

```js
// 新增
const a = await (await fetch('/api/wordbook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ word: 'serendipity', sourceContext: 'A happy accident.' }),
})).json()
console.log(a)

// 重复收藏应返回同一条而不是报错
const b = await (await fetch('/api/wordbook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ word: 'serendipity' }),
})).json()
console.log(b.entry.id === a.entry.id)   // 应为 true

// 列表
console.log(await (await fetch('/api/wordbook')).json())

// 搜索
console.log(await (await fetch('/api/wordbook?q=seren')).json())

// 删除
console.log(await (await fetch(`/api/wordbook/${a.entry.id}`, { method: 'DELETE' })).json())
console.log(await (await fetch('/api/wordbook')).json())   // 应为空
```

- [ ] **Step 5: 验证 RLS 隔离**

在 Supabase 控制台创建第二个测试账号，用它登录后调 `GET /api/wordbook`。

预期：看不到第一个账号收藏的任何词。

再用账号 B 尝试删除账号 A 的某条记录 ID：

```js
await (await fetch('/api/wordbook/<账号A的记录id>', { method: 'DELETE' })).json()
```

预期：返回 `{ok:true}`（RLS 使其匹配 0 行），但账号 A 的记录**仍然存在**。回到账号 A 确认。

- [ ] **Step 6: Commit**

```bash
git add src/lib/wordbook src/app/api/wordbook
git commit -m "feat: 单词本增删查接口"
```

---

### Task 2: 收藏按钮与词卡集成

**Files:**
- Create: `src/components/FavoriteButton.tsx`
- Modify: `src/components/WordCard.tsx`
- Modify: `src/components/HardWordGrid.tsx`

**Interfaces:**
- Consumes: `POST /api/wordbook` / `DELETE /api/wordbook/:id`（Task 1）
- Produces: `<FavoriteButton word={string} sourceContext={string | null} />` —— 自管理状态，挂载时不查询收藏态（首次点击即收藏，再次点击取消）

- [ ] **Step 1: 实现收藏按钮**

创建 `src/components/FavoriteButton.tsx`：

```tsx
'use client'

import { useState } from 'react'

export function FavoriteButton({
  word, sourceContext = null,
}: { word: string; sourceContext?: string | null }) {
  const [entryId, setEntryId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      if (saved && entryId) {
        const res = await fetch(`/api/wordbook/${entryId}`, { method: 'DELETE' })
        if (res.ok) { setSaved(false); setEntryId(null) }
      } else {
        const res = await fetch('/api/wordbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, sourceContext }),
        })
        if (res.ok) {
          const data = await res.json()
          setEntryId(data.entry.id)
          setSaved(true)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? `从单词本移除 ${word}` : `收藏 ${word}`}
      className="text-lg text-neutral-400 hover:text-amber-500 disabled:opacity-50 aria-pressed:text-amber-500"
    >
      {saved ? '★' : '☆'}
    </button>
  )
}
```

- [ ] **Step 2: 在词卡上加收藏按钮**

修改 `src/components/WordCard.tsx`。

在文件顶部加入 import：

```tsx
import { FavoriteButton } from './FavoriteButton'
```

修改组件签名，加一个可选的上下文参数：

```tsx
export function WordCard({
  detail, sourceContext = null,
}: { detail: WordDetail; sourceContext?: string | null }) {
```

在 `<header>` 内、`<h2>` 之后加入按钮（只有词典命中时才允许收藏 —— 未收录的词收藏了也没释义可复习）：

```tsx
        {detail.matchedFrom !== 'none' && (
          <FavoriteButton word={detail.word} sourceContext={sourceContext} />
        )}
```

- [ ] **Step 3: 在难词卡片上加收藏按钮**

修改 `src/components/HardWordGrid.tsx`。

在文件顶部加入 import：

```tsx
import { FavoriteButton } from './FavoriteButton'
```

在 `Card` 组件中，把标题那一行改为把收藏按钮放在按钮外面（避免嵌套 `<button>`）：

```tsx
  return (
    <li className="rounded border p-3">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => void toggle()} className="flex-1 text-left">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{hw.word}</span>
            {hw.phonetic && (
              <span className="font-mono text-xs text-neutral-500">{hw.phonetic}</span>
            )}
          </div>
          {hw.senses.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-sm text-neutral-700">
              {hw.senses.map((s) => `${s.pos} ${s.meaning}`).join('；')}
            </p>
          ) : (
            <p className="mt-1 text-sm text-neutral-500">词典未收录</p>
          )}
        </button>
        <FavoriteButton word={hw.word} sourceContext={context} />
      </div>

      {open && (
        <div className="mt-2 border-t pt-2 text-sm">
          {busy && <p className="text-neutral-500">正在分析在本句中的含义…</p>}
          {explanation && <p>{explanation}</p>}
        </div>
      )}
    </li>
  )
```

- [ ] **Step 4: 在划词浮层传入上下文**

修改 `src/components/SelectionPopover.tsx`，让浮层里的词卡也能带上原句。

给组件加一个可选属性：

```tsx
export function SelectionPopover({
  children, sourceContext = null,
}: { children: React.ReactNode; sourceContext?: string | null }) {
```

把渲染处改为：

```tsx
          {!busy && detail && <WordCard detail={detail} sourceContext={sourceContext} />}
```

再修改 `src/components/TranslateResult.tsx`，把 `source` 传下去：

```tsx
    <SelectionPopover sourceContext={source}>
```

- [ ] **Step 5: 手动验证**

```bash
npm run dev
```

逐项检查：

1. 查询 `apple` → 词卡右上有 ☆ → 点击变 ★
2. 刷新页面重新查 `apple` → 星标是 ☆（组件不查询初始状态，这是已知的简化，见下方说明）
3. 再点一次 ★ → 变 ☆，且数据库中记录被删除
4. 翻译一段英文 → 每个难词卡片右上有 ☆，点击可收藏
5. 点击难词卡片的**文字区域**仍能展开释义（不被收藏按钮抢走点击）
6. 划词弹出的词卡上也有 ☆，收藏后 `source_context` 存的是那段原文

在 Supabase SQL Editor 验证第 6 点：

```sql
select word, word_key, source_context from wordbook order by created_at desc limit 5;
```

📌 **已知简化**：`FavoriteButton` 挂载时不查询已收藏状态，因此刷新后已收藏的词仍显示 ☆。再次点击会命中 Task 1 的「已存在则返回既有记录」分支，不会产生重复数据，只是星标状态显示不准。修正需要在 `/api/word/:word` 的返回中带上收藏态 —— 属于打磨项，不在本计划范围。若要修，改动点是：`lookupWord` 增加一个可选的 `userId` 参数，查 `wordbook` 后在 `WordDetail` 上加 `wordbookId: string | null` 字段，`FavoriteButton` 接受 `initialEntryId` 属性。

- [ ] **Step 6: Commit**

```bash
git add src/components/
git commit -m "feat: 收藏按钮与词卡、难词卡片集成"
```

---

### Task 3: 复习顺序与熟练度规则

两个纯函数，先于页面实现，因为它们是复习逻辑的核心且完全可测。

随机排序用带种子的 PRNG 而不是 `Math.random()`，这样测试可以断言确定的结果。

**Files:**
- Create: `src/lib/review/order.ts`
- Create: `src/lib/review/mark.ts`
- Test: `src/lib/review/order.test.ts`
- Test: `src/lib/review/mark.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type ReviewMode = 'sequential' | 'random'`
  - `orderCards<T>(items: T[], mode: ReviewMode, seed: number): T[]`
  - `nextFamiliarity(current: number, known: boolean): number`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/review/order.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { orderCards } from './order'

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('orderCards', () => {
  it('顺序模式原样返回', () => {
    expect(orderCards(ITEMS, 'sequential', 42)).toEqual(ITEMS)
  })
  it('顺序模式不修改原数组', () => {
    const copy = [...ITEMS]
    orderCards(copy, 'sequential', 42)
    expect(copy).toEqual(ITEMS)
  })
  it('随机模式打乱顺序', () => {
    expect(orderCards(ITEMS, 'random', 42)).not.toEqual(ITEMS)
  })
  it('随机模式保留全部元素', () => {
    expect([...orderCards(ITEMS, 'random', 42)].sort((a, b) => a - b)).toEqual(ITEMS)
  })
  it('相同种子产生相同结果', () => {
    expect(orderCards(ITEMS, 'random', 7)).toEqual(orderCards(ITEMS, 'random', 7))
  })
  it('不同种子产生不同结果', () => {
    expect(orderCards(ITEMS, 'random', 1)).not.toEqual(orderCards(ITEMS, 'random', 2))
  })
  it('随机模式不修改原数组', () => {
    const copy = [...ITEMS]
    orderCards(copy, 'random', 42)
    expect(copy).toEqual(ITEMS)
  })
  it('空数组返回空数组', () => {
    expect(orderCards([], 'random', 1)).toEqual([])
  })
  it('单元素数组原样返回', () => {
    expect(orderCards([9], 'random', 1)).toEqual([9])
  })
})
```

创建 `src/lib/review/mark.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { nextFamiliarity } from './mark'

describe('nextFamiliarity', () => {
  it('认识则加一', () => {
    expect(nextFamiliarity(2, true)).toBe(3)
  })
  it('不认识则减一', () => {
    expect(nextFamiliarity(2, false)).toBe(1)
  })
  it('上限封顶为 5', () => {
    expect(nextFamiliarity(5, true)).toBe(5)
  })
  it('下限兜底为 0', () => {
    expect(nextFamiliarity(0, false)).toBe(0)
  })
  it('从 0 认识一次到 1', () => {
    expect(nextFamiliarity(0, true)).toBe(1)
  })
  it('从 4 认识一次到 5（进入已掌握）', () => {
    expect(nextFamiliarity(4, true)).toBe(5)
  })
  it('超出范围的输入被夹回区间', () => {
    expect(nextFamiliarity(99, true)).toBe(5)
    expect(nextFamiliarity(-5, false)).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- src/lib/review/
```

预期：两个文件都 FAIL，报无法解析 import

- [ ] **Step 3: 实现**

创建 `src/lib/review/order.ts`：

```ts
export type ReviewMode = 'sequential' | 'random'

/** mulberry32 —— 小巧的确定性 PRNG，让随机顺序在测试中可复现。 */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

创建 `src/lib/review/mark.ts`：

```ts
export const MAX_FAMILIARITY = 5
export const MIN_FAMILIARITY = 0

/**
 * 认识 +1（封顶 5），不认识 -1（兜底 0）。
 * 达到 4 即视为已掌握，会被难词拆解排除（见 Plan 2 的打分规则）。
 */
export function nextFamiliarity(current: number, known: boolean): number {
  const base = Math.min(Math.max(current, MIN_FAMILIARITY), MAX_FAMILIARITY)
  const next = known ? base + 1 : base - 1
  return Math.min(Math.max(next, MIN_FAMILIARITY), MAX_FAMILIARITY)
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npm test -- src/lib/review/
```

预期：16 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/review/
git commit -m "feat: 复习顺序与熟练度更新规则"
```

---

### Task 4: 复习标记接口

**Files:**
- Create: `src/app/api/review/mark/route.ts`

**Interfaces:**
- Consumes: `nextFamiliarity`（Task 3）、`createServerSupabase`
- Produces: `POST /api/review/mark` body `{ id: string; known: boolean }` → `{ familiarity: number; reviewCount: number }`

- [ ] **Step 1: 实现**

创建 `src/app/api/review/mark/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { nextFamiliarity } from '@/lib/review/mark'

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    { id?: unknown; known?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const known = body?.known === true
  if (!id) return NextResponse.json({ error: '缺少记录 id' }, { status: 400 })

  // 先读当前值再算新值。RLS 保证读不到别人的记录。
  const { data: current, error: readErr } = await db
    .from('wordbook').select('review_count, familiarity').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

  const familiarity = nextFamiliarity(current.familiarity as number, known)
  const reviewCount = (current.review_count as number) + 1

  const { error: writeErr } = await db
    .from('wordbook')
    .update({
      familiarity,
      review_count: reviewCount,
      last_reviewed_at: new Date().toISOString(),
      // SM-2 的 due_at / ease_factor / interval_days 第一版不动
    })
    .eq('id', id)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  return NextResponse.json({ familiarity, reviewCount })
}
```

- [ ] **Step 2: 手动验证**

先收藏一个词拿到 id，然后在控制台运行：

```js
const { entry } = await (await fetch('/api/wordbook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ word: 'ephemeral' }),
})).json()

// 认识三次
for (let i = 0; i < 3; i++) {
  console.log(await (await fetch('/api/review/mark', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: entry.id, known: true }),
  })).json())
}
// 不认识一次
console.log(await (await fetch('/api/review/mark', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: entry.id, known: false }),
})).json())
```

预期依次输出：`{familiarity:1,reviewCount:1}`、`{familiarity:2,reviewCount:2}`、`{familiarity:3,reviewCount:3}`、`{familiarity:2,reviewCount:4}`

- [ ] **Step 3: 验证与难词拆解的联动**

把该词标到 familiarity 5：

```js
for (let i = 0; i < 5; i++) {
  await fetch('/api/review/mark', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: entry.id, known: true }),
  })
}
```

然后请求一段含 `ephemeral` 的文本：

```js
await (await fetch('/api/hard-words', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Fame is ephemeral and transient by nature.' }),
})).json()
```

预期：结果中**不含** `ephemeral`（已掌握被排除），但含 `transient`。

清理测试数据：

```js
await fetch(`/api/wordbook/${entry.id}`, { method: 'DELETE' })
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/review
git commit -m "feat: 复习标记接口"
```

---

### Task 5: 导航栏与单词本页

**Files:**
- Create: `src/components/NavBar.tsx`
- Create: `src/app/wordbook/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`（移除页面内的标题，改用 NavBar）

**Interfaces:**
- Consumes: `GET /api/wordbook` / `DELETE /api/wordbook/:id`（Task 1）、`WordbookEntry`（Task 1）
- Produces: `/wordbook` 页面，`<NavBar />`

- [ ] **Step 1: 实现导航栏**

创建 `src/components/NavBar.tsx`：

```tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'

const LINKS = [
  { href: '/', label: '翻译' },
  { href: '/wordbook', label: '单词本' },
]

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()

  if (pathname.startsWith('/login')) return null

  async function signOut() {
    await createBrowserSupabase().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="border-b">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              pathname === l.href
                ? 'font-medium'
                : 'text-neutral-500 hover:text-black'
            }
          >
            {l.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-auto text-sm text-neutral-500 hover:text-black"
        >
          登出
        </button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: 挂到布局上**

修改 `src/app/layout.tsx`，在 `<body>` 内、`{children}` 之前插入：

```tsx
import { NavBar } from '@/components/NavBar'
```

```tsx
        <NavBar />
        {children}
```

同时把 `src/app/page.tsx` 中 `<header>` 里的 `<h1>翻译 · 单词本</h1>` 删掉（导航栏已经承担了这个角色），只保留方向切换按钮，并把 `<header>` 的 `justify-between` 改为 `justify-end`。

- [ ] **Step 3: 实现单词本页**

创建 `src/app/wordbook/page.tsx`：

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { WordbookEntry } from '@/lib/wordbook/types'

export default function WordbookPage() {
  const [entries, setEntries] = useState<WordbookEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wordbook?q=${encodeURIComponent(q)}`)
      if (!res.ok) { setError('加载失败'); return }
      const data = (await res.json()) as { entries: WordbookEntry[] }
      setEntries(data.entries)
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(query), 250)   // 输入防抖
    return () => clearTimeout(t)
  }, [query, load])

  async function remove(id: string) {
    const res = await fetch(`/api/wordbook/${id}`, { method: 'DELETE' })
    if (res.ok) setEntries((list) => list.filter((e) => e.id !== id))
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词…"
          className="flex-1 rounded border px-3 py-2"
        />
        <Link
          href="/review"
          className="shrink-0 rounded bg-black px-4 py-2 text-white"
        >
          开始复习
        </Link>
      </div>

      {loading && <p className="text-sm text-neutral-500">加载中…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && entries.length === 0 && (
        <p className="text-sm text-neutral-500">
          {query ? '没有匹配的单词。' : '单词本还是空的 —— 去翻译页收藏几个词吧。'}
        </p>
      )}

      <ul className="flex flex-col divide-y">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-4 py-3">
            <div className="flex-1">
              <div className="flex items-baseline gap-3">
                <span className="font-medium">{e.word}</span>
                <span className="text-xs text-neutral-500">
                  熟练度 {e.familiarity}/5 · 复习 {e.reviewCount} 次
                </span>
              </div>
              {e.sourceContext && (
                <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                  {e.sourceContext}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void remove(e.id)}
              aria-label={`移除 ${e.word}`}
              className="shrink-0 text-sm text-neutral-400 hover:text-red-600"
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 4: 手动验证**

```bash
npm run dev
```

逐项检查：

1. 收藏几个词后访问 `/wordbook` → 列表显示，含熟练度与复习次数
2. 在搜索框输入部分字母 → 列表实时过滤（有 250ms 防抖）
3. 清空搜索 → 恢复全部
4. 点「移除」→ 该行消失，刷新后仍然不在
5. 清空单词本 → 显示「单词本还是空的」提示
6. 搜索一个不存在的词 → 显示「没有匹配的单词」
7. 导航栏在 `/` 和 `/wordbook` 之间切换正常，当前页高亮
8. 点「登出」→ 跳转 `/login`，再访问 `/wordbook` 被拦截

- [ ] **Step 5: Commit**

```bash
git add src/components/NavBar.tsx src/app/wordbook src/app/layout.tsx src/app/page.tsx
git commit -m "feat: 导航栏与单词本页面"
```

---

### Task 6: 复习页

**Files:**
- Create: `src/app/review/page.tsx`

**Interfaces:**
- Consumes: `orderCards` / `ReviewMode`（Task 3）、`GET /api/wordbook`（Task 1）、`POST /api/review/mark`（Task 4）
- Produces: `/review` 页面

⚠️ 种子必须在**用户点击开始时**生成，不能在渲染期间调用 `Math.random()` —— 否则服务端渲染与客户端水合的结果不一致，React 会报 hydration 错误。

- [ ] **Step 1: 实现复习页**

创建 `src/app/review/page.tsx`：

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { orderCards, type ReviewMode } from '@/lib/review/order'
import type { WordbookEntry } from '@/lib/wordbook/types'

type Phase = 'setup' | 'reviewing' | 'done'

export default function ReviewPage() {
  const [all, setAll] = useState<WordbookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<ReviewMode>('sequential')
  const [queue, setQueue] = useState<WordbookEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const [revealed, setRevealed] = useState(false)
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
    setQueue(orderCards(all, mode, Date.now() % 2147483647))
    setCursor(0)
    setRevealed(false)
    setStats({ known: 0, unknown: 0 })
    setPhase('reviewing')
  }

  const mark = useCallback(async (known: boolean) => {
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
    else { setCursor(cursor + 1); setRevealed(false) }
  }, [queue, cursor])

  // 键盘操作：空格翻面，翻面后 1 / 2 标记
  useEffect(() => {
    if (phase !== 'reviewing') return
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ') { e.preventDefault(); setRevealed((r) => !r); return }
      if (!revealed) return
      if (e.key === '1') void mark(false)
      if (e.key === '2') void mark(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, revealed, mark])

  if (loading) {
    return <main className="mx-auto max-w-2xl p-6 text-sm text-neutral-500">加载中…</main>
  }

  if (phase === 'setup') {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
        <h2 className="text-lg font-medium">复习 · 共 {all.length} 个单词</h2>
        {all.length === 0 ? (
          <p className="text-sm text-neutral-500">
            单词本是空的。<Link href="/" className="underline">去收藏几个词</Link>
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              {(['sequential', 'random'] as ReviewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded border px-4 py-2 text-sm ${
                    mode === m ? 'border-black bg-black text-white' : ''
                  }`}
                >
                  {m === 'sequential' ? '顺序' : '随机'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={start}
              className="self-start rounded bg-black px-5 py-2 text-white"
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
      <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h2 className="text-lg font-medium">本轮完成</h2>
        <p>
          共 {queue.length} 个 · 认识 {stats.known} · 不认识 {stats.unknown}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPhase('setup')}
            className="rounded bg-black px-4 py-2 text-white"
          >
            再来一轮
          </button>
          <Link href="/wordbook" className="rounded border px-4 py-2">
            回单词本
          </Link>
        </div>
      </main>
    )
  }

  const card = queue[cursor]
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
      <p className="text-sm text-neutral-500">
        {cursor + 1} / {queue.length}
      </p>

      <button
        type="button"
        onClick={() => setRevealed(!revealed)}
        className="min-h-56 rounded-lg border p-8 text-left"
      >
        <p className="text-3xl font-semibold">{card.word}</p>
        {revealed ? (
          <div className="mt-5 border-t pt-4">
            {card.sourceContext ? (
              <p className="text-sm text-neutral-600">{card.sourceContext}</p>
            ) : (
              <p className="text-sm text-neutral-400">（收藏时没有记录原句）</p>
            )}
            <p className="mt-3 text-xs text-neutral-500">
              熟练度 {card.familiarity}/5 · 已复习 {card.reviewCount} 次
            </p>
          </div>
        ) : (
          <p className="mt-5 text-sm text-neutral-400">点击或按空格翻面</p>
        )}
      </button>

      {revealed && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void mark(false)}
            className="flex-1 rounded border py-3"
          >
            不认识 <span className="text-xs text-neutral-400">1</span>
          </button>
          <button
            type="button"
            onClick={() => void mark(true)}
            className="flex-1 rounded bg-black py-3 text-white"
          >
            认识 <span className="text-xs text-neutral-400">2</span>
          </button>
        </div>
      )}
    </main>
  )
}
```

📌 **本页的已知简化**：卡片背面显示的是收藏时的原句而非词典释义 —— `wordbook` 表不存释义，要显示释义需要在复习页额外批量查 `dict_entries`。这符合 spec 中「先做简单的」的决定。若要补，改动点是给 `GET /api/wordbook` 加一个 `?withSenses=1` 参数，在服务端 join 一次 `dict_entries` 并返回 `senses`。

- [ ] **Step 2: 手动验证**

```bash
npm run dev
```

逐项检查：

1. 单词本为空时访问 `/review` → 提示去收藏，无「开始」按钮
2. 收藏 5 个词后 → 显示「共 5 个单词」，可选顺序/随机
3. 选「顺序」开始 → 卡片顺序与单词本列表一致
4. 选「随机」开始两次 → 两次顺序不同
5. 点击卡片翻面 → 显示原句与熟练度
6. 按空格 → 翻面；再按空格 → 翻回
7. 翻面后按 `2` → 标记认识并进入下一张
8. 翻面后按 `1` → 标记不认识并进入下一张
9. 走完全部卡片 → 显示统计页，数字与实际操作一致
10. 点「再来一轮」→ 回到模式选择
11. 回到 `/wordbook` → 熟练度与复习次数已更新

- [ ] **Step 3: 构建与测试**

```bash
npm test && npm run build
```

预期：全部通过。

- [ ] **Step 4: Commit**

```bash
git add src/app/review
git commit -m "feat: 复习页，支持顺序与随机翻卡"
```

---

### Task 7: 端到端测试

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/full-flow.spec.ts`
- Modify: `package.json`（追加 `test:e2e` 脚本）
- Modify: `.gitignore`（追加 Playwright 产物目录）
- Modify: `vitest.config.ts`（排除 `e2e/` 目录）

**Interfaces:**
- Consumes: 全部页面与接口
- Produces: `npm run test:e2e` 跑通登录 → 翻译 → 划词 → 收藏 → 单词本 → 复习全链路

- [ ] **Step 1: 准备测试账号**

在 Supabase 控制台 Authentication → Users 中手动创建一个测试用户（勾选 Auto Confirm User，跳过邮箱验证）。

在 `.env.local` 中追加：

```
E2E_EMAIL=e2e@example.com
E2E_PASSWORD=<你设置的密码>
```

同时在 `.env.local.example` 中追加对应的空白项：

```
# E2E 测试账号
E2E_EMAIL=
E2E_PASSWORD=
```

- [ ] **Step 2: 安装并配置 Playwright**

```bash
npm install -D @playwright/test dotenv
npx playwright install chromium
```

创建 `playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test'
import 'dotenv/config'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

在 `package.json` 的 `scripts` 中加入：

```json
"test:e2e": "playwright test"
```

在 `.gitignore` 追加：

```
/test-results/
/playwright-report/
/.playwright/
```

修改 `vitest.config.ts`，避免 Vitest 抓走 Playwright 的用例。把 `test` 段改为：

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
```

- [ ] **Step 3: 编写端到端测试**

创建 `e2e/full-flow.spec.ts`：

```ts
import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!

const PARAGRAPH =
  'The committee deferred the decision pending further review of the ' +
  'unprecedented anomalies discovered in the quarterly reconciliation.'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('邮箱').fill(EMAIL)
  await page.getByPlaceholder('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByPlaceholder('输入单词或段落…')).toBeVisible()
}

/** 清空测试账号的单词本，保证用例之间互不干扰 */
async function clearWordbook(page: Page) {
  const res = await page.request.get('/api/wordbook')
  const { entries } = (await res.json()) as { entries: { id: string }[] }
  for (const e of entries) {
    await page.request.delete(`/api/wordbook/${e.id}`)
  }
}

test.beforeEach(async ({ page }) => {
  await login(page)
  await clearWordbook(page)
})

test('未登录访问被拦截到登录页', async ({ browser }) => {
  const ctx = await browser.newContext()
  const fresh = await ctx.newPage()
  await fresh.goto('/wordbook')
  await expect(fresh).toHaveURL(/\/login/)
  await ctx.close()
})

test('单词查询显示音标与释义', async ({ page }) => {
  await page.getByPlaceholder('输入单词或段落…').fill('apple')
  await page.getByRole('button', { name: /翻译/ }).click()

  await expect(page.getByRole('heading', { name: 'apple' })).toBeVisible()
  await expect(page.getByText('苹果')).toBeVisible()
})

test('段落翻译产出译文与难词', async ({ page }) => {
  await page.getByPlaceholder('输入单词或段落…').fill(PARAGRAPH)
  await page.getByRole('button', { name: /翻译/ }).click()

  // 难词卡片走数据库，通常先于译文出现
  await expect(page.getByRole('heading', { name: /难词/ })).toBeVisible()
  await expect(page.getByText('unprecedented')).toBeVisible()

  // 译文是流式的，等它攒出足够内容
  const translation = page.locator('section', { hasText: '译文' })
  await expect(translation).toContainText(/[一-龥]{8,}/, { timeout: 45_000 })
})

test('收藏后出现在单词本，可移除', async ({ page }) => {
  await page.getByPlaceholder('输入单词或段落…').fill('serendipity')
  await page.getByRole('button', { name: /翻译/ }).click()
  await expect(page.getByRole('heading', { name: 'serendipity' })).toBeVisible()

  await page.getByRole('button', { name: /收藏 serendipity/ }).click()
  await expect(page.getByRole('button', { name: /从单词本移除 serendipity/ })).toBeVisible()

  await page.getByRole('link', { name: '单词本' }).click()
  await expect(page.getByText('serendipity')).toBeVisible()

  await page.getByRole('button', { name: '移除 serendipity' }).click()
  await expect(page.getByText('单词本还是空的')).toBeVisible()
})

test('复习流程走完一轮并更新熟练度', async ({ page }) => {
  // 直接用接口铺数据，避免依赖 UI 收藏路径
  for (const word of ['alpha', 'beta', 'gamma']) {
    await page.request.post('/api/wordbook', {
      data: { word, sourceContext: `A sentence with ${word}.` },
    })
  }

  await page.goto('/review')
  await expect(page.getByText('共 3 个单词')).toBeVisible()

  await page.getByRole('button', { name: '顺序' }).click()
  await page.getByRole('button', { name: '开始' }).click()

  for (let i = 1; i <= 3; i++) {
    await expect(page.getByText(`${i} / 3`)).toBeVisible()
    await page.getByText('点击或按空格翻面').click()
    await page.getByRole('button', { name: /认识/ }).last().click()
  }

  await expect(page.getByText('本轮完成')).toBeVisible()
  await expect(page.getByText(/认识 3/)).toBeVisible()

  await page.getByRole('link', { name: '回单词本' }).click()
  await expect(page.getByText(/熟练度 1\/5 · 复习 1 次/).first()).toBeVisible()
})

test('随机模式打乱顺序', async ({ page }) => {
  for (const w of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
    await page.request.post('/api/wordbook', { data: { word: w } })
  }

  async function firstCardWord(): Promise<string> {
    await page.goto('/review')
    await page.getByRole('button', { name: '随机' }).click()
    await page.getByRole('button', { name: '开始' }).click()
    return (await page.locator('.text-3xl').first().textContent()) ?? ''
  }

  // 8 张卡片，两轮首张相同的概率是 1/8 —— 试三轮，全相同才算失败
  const seen = new Set<string>()
  for (let i = 0; i < 3; i++) seen.add(await firstCardWord())
  expect(seen.size).toBeGreaterThan(1)
})
```

- [ ] **Step 4: 运行端到端测试**

```bash
npm run test:e2e
```

预期：6 个用例全部通过。

若「段落翻译」用例超时，检查 ollama 是否在运行 —— 该用例依赖真实的翻译后端。若 ollama 首字节较慢，把该用例的 `timeout` 调大。

- [ ] **Step 5: 清理测试数据**

```sql
delete from wordbook where user_id = (
  select id from auth.users where email = 'e2e@example.com'
);
delete from usage_counter where user_id = (
  select id from auth.users where email = 'e2e@example.com'
);
```

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e/ package.json package-lock.json .gitignore vitest.config.ts .env.local.example
git commit -m "test: 端到端测试覆盖登录、翻译、收藏与复习全链路"
```

---

### Task 8: 部署到 Vercel

**Files:**
- Create: `README.md`
- Modify: `docs/infra/hardening.md`（追加线上地址）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 线上可访问的站点

- [ ] **Step 1: 推送到远程仓库**

在 GitHub 创建仓库后：

```bash
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```

- [ ] **Step 2: 确认没有密钥被提交**

```bash
git log --all --full-history -- .env.local
grep -rn "SUPABASE_SERVICE_ROLE_KEY\|OLLAMA_TOKEN\|CLOUD_API_KEY" --include="*.ts" --include="*.tsx" src/ | grep -v "process.env"
```

预期：第一条无输出（`.env.local` 从未被提交），第二条无输出（代码里没有硬编码的密钥）。

**若第一条有输出，不要继续** —— 密钥已进入 git 历史，必须先在 Supabase / 云端服务商处轮换所有密钥，再用 `git filter-repo` 清理历史。

- [ ] **Step 3: 在 Vercel 导入项目**

在 https://vercel.com 导入该 GitHub 仓库，框架自动识别为 Next.js。

在 Settings → Environment Variables 中逐个添加（Production 与 Preview 都要）：

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `OLLAMA_BASE_URL` | `https://ollama.<域名>` |
| `OLLAMA_TOKEN` | Task 1 生成的密钥 |
| `OLLAMA_MODEL` | 你的模型名 |
| `CLOUD_BASE_URL` | OpenAI 兼容端点 |
| `CLOUD_API_KEY` | 云端 API key |
| `CLOUD_MODEL` | 云端模型名 |
| `DAILY_QUOTA` | `200` |

⚠️ **不要**添加 `E2E_EMAIL` / `E2E_PASSWORD` —— 那是本地测试用的。

- [ ] **Step 4: 部署并验证**

触发部署，等待完成，然后在**线上地址**逐项验证：

1. 访问根路径 → 跳转 `/login`
2. 用测试账号登录 → 进入主页
3. 查询 `apple` → 显示音标与释义
4. 翻译一段英文 → 译文流式出现，难词卡片显示
5. 打开浏览器开发者工具 Network，检查 `/api/translate` 响应头的 `X-Provider` → 应为 `ollama`
6. 收藏一个词 → 访问 `/wordbook` 能看到
7. 走一轮复习 → 熟练度更新

- [ ] **Step 5: 验证 Supabase 回调地址**

Supabase Auth 的邮件确认链接默认指向 `localhost`。在 Supabase 控制台 Authentication → URL Configuration 中：

- `Site URL` 设为 Vercel 的线上地址
- `Redirect URLs` 追加 `https://<你的域名>/auth/callback`

用一个新邮箱在线上注册，确认邮件里的链接指向线上地址且能正常完成验证。

- [ ] **Step 6: 编写 README**

创建 `README.md`：

```markdown
# 翻译 · 单词本

中英互译工具，翻译结果可直接沉淀为个人单词本并复习。

## 功能

- 中↔英互译，自动识别单词与段落
- 单词详情：美/英音标、发音、按词性分组的中文释义、考试标签
- 段落自动拆解难词，难度随个人单词本自适应
- 划词查询任意英文单词
- 单词本收藏、搜索、移除
- 顺序 / 随机翻卡复习

## 架构

- **前端 + 服务端**：Next.js App Router @ Vercel
- **数据 + 认证**：Supabase（Postgres + Auth + RLS）
- **词典层**：ECDICT 高频子集 + dictionaryapi.dev 音标（带缓存）
- **翻译**：本机 ollama 主用（经 frpc + Caddy 暴露），OpenAI 兼容接口兜底

词典层与 LLM 层完全解耦 —— 翻译后端全部不可用时，单词查询、单词本与复习功能照常工作。

## 开发

```bash
npm install
cp .env.local.example .env.local   # 填入实际值
npx supabase db push               # 应用数据库迁移
npm run import:ecdict              # 导入词典（需先下载 data/stardict.csv）
npm run dev
```

## 测试

```bash
npm test           # 单元测试
npm run test:e2e   # 端到端测试（需 ollama 或云端后端可用）
```

## 文档

- 设计文档：`docs/superpowers/specs/2026-08-06-translate-wordbook-design.md`
- 实施计划：`docs/superpowers/plans/`
- 基础设施：`docs/infra/hardening.md`
```

- [ ] **Step 7: 记录线上地址**

在 `docs/infra/hardening.md` 末尾追加一节「线上部署」，记录 Vercel 地址与部署日期。

- [ ] **Step 8: Commit**

```bash
git add README.md docs/infra/hardening.md
git commit -m "docs: README 与线上部署记录"
git push
```

---

## Plan 3 完成标准

- [ ] `npm test` 全部通过
- [ ] `npm run test:e2e` 6 个用例全部通过
- [ ] `npm run build` 无错误
- [ ] 线上地址可访问，登录后全部功能正常
- [ ] 两个账号互相看不到对方的单词本（RLS 生效）
- [ ] 复习后熟练度更新，达到 4 的词不再出现在难词拆解中
- [ ] `.env.local` 从未被提交到 git，代码中无硬编码密钥
- [ ] Supabase Auth 回调指向线上地址

## 全部三个计划完成后的产品状态

| Spec 需求 | 状态 |
|---|---|
| 中英互译，方向可切换 | ✅ |
| 自动识别单词 / 段落 | ✅ |
| 美/英音标 + 发音 | ✅（受 Wiktionary 覆盖率限制，有降级链） |
| 多条中文释义按词性分组 | ✅ |
| 段落拆解难词并逐个释义 | ✅ |
| 划词查看明细 | ✅ |
| 收藏到单词本 | ✅ |
| 单词本查看、搜索、移除 | ✅ |
| 顺序 / 随机复习 | ✅ |
| 多用户注册登录与数据隔离 | ✅ |
| ollama 主用 + 云端兜底 | ✅ |

**明确未实现（spec 第 1.1 节已排除）**：SM-2 间隔重复（字段已预留）、翻译历史、游客试用、中英之外的语言对、跨设备偏好同步。

**遗留的打磨项**（均已在对应任务中标注改动点）：
- `FavoriteButton` 挂载时不查询已收藏状态（Plan 3 Task 2）
- 复习卡背面显示原句而非词典释义（Plan 3 Task 6）

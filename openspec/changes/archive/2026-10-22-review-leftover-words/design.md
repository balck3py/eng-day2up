## Context

复习页 `src/app/review/page.tsx` 是一个纯客户端页面：开轮时从 `/api/wordbook` 拉全量单词本，在内存里排队（`splitPrevious` 上一批必修 → `splitRecent` 今天背过的巩固词与其余词交替），分题型后逐张作答。离开一张卡时 `commit()` 调 `/api/review/mark` 写熟练度，**不等返回、不看状态码**。结束页的「只练生词 / 全部再来」走 `repeatRound()`，名单来自本轮内存里的 `verdicts`。

现状问题：
- 本轮生词名单只在内存里，页面一刷新或会话过期重定向就没了。
- 会话过期后 `proxy.ts` 对 `/api/*` 返回 401，`commit()` 吞掉了这个失败。
- 出题范围只按「有无中文释义」过滤，熟练度不参与。`nextFamiliarity` 封顶 5，`MASTERED_THRESHOLD`（≥4）只用于难词拆解。

约束：单人使用；网页与桌面客户端解耦，本变更只动网页；`wordbook` 的 SM-2 预留字段继续不启用。

## Goals / Non-Goals

**Goals:**
- 常规复习产生的生词名单跨刷新、跨登录、跨设备保留，且只被下一次常规复习覆盖。
- 熟练度满值的词不再每轮都出，但隔一段时间会回来防遗忘。
- 中断的一轮能接着背；写库失败的判定不丢。

**Non-Goals:**
- 不引入 SM-2 / 完整间隔重复调度。
- 不保留多份历史生词表，只有「上一轮」一份。
- 进行中轮次不跨设备同步（只存当前浏览器）。

## Decisions

### 1. 生词名单存数据库独立表，而不是 wordbook 上加一列

表 `review_leftover(user_id, wordbook_id, created_at)`，主键 `(user_id, wordbook_id)`，`wordbook_id` 外键 `on delete cascade`，RLS 与 `wordbook` 同样按 `auth.uid() = user_id` 隔离。

- 为什么不是 wordbook 加 `last_known` 列：那表达的是「每个词最近一次的判定」，会被「只练生词」里答对的结果改写，正好违背「名单完整保留 10 个、只由常规复习覆盖」的要求。名单是「某一轮的快照」，本质是一个集合，独立表最直接。
- 为什么不是 localStorage：用户明确遇到了登录过期后状态清空，而且名单是长期数据，应跨设备。
- 名单里的词被从单词本删掉时级联删除，名单自然变短，不留悬空 id。

### 2. 整批替换走一个 PUT，服务端在一次 RPC 里完成删 + 插

`PUT /api/review/leftover { ids: string[] }`：`ids` 为空直接 400（「零生词不覆盖」的规则由客户端判断，接口层也拒绝空名单作为兜底）。替换用一个 `security invoker` 的 SQL 函数 `replace_review_leftover(p_ids uuid[])` 在单个事务里 `delete ... where user_id = auth.uid()` 再 `insert ... select from wordbook where id = any(p_ids) and user_id = auth.uid()` —— 只插属于自己的词，删插不会出现半截状态。
- 备选：客户端两次请求先删后插 —— 中途失败会把名单清空，否决。

`GET /api/review/leftover` 返回 `{ ids: string[], createdAt: string | null }`；前端用 ids 去已加载的 `all` 里取词条（已有释义、熟练度），不需要接口再 join 词库。

### 3. 轮次类型显式区分，只有 `regular` 结算写名单

页面状态加 `roundKind: 'regular' | 'leftover' | 'repeat'`：
- `start()` → `regular`；新入口「复习上一轮生词」→ `leftover`；结束页的两个重练按钮 → `repeat`。
- 结算（进入 `done`，或在续背提示里选「结束这一轮」）时，仅当 `roundKind === 'regular'` 且本轮 `verdicts` 里至少一个 `false` 才 PUT 名单。
- `leftover` 轮次：全量出（不设收工线，`limit = Infinity`，等价于整批都是必修），按当前顺序/随机模式排序，题型照常分配；不受冷却过滤。
- 结算写名单失败（离线等）也进 outbox（见决策 6），保证名单不丢。

### 4. 冷却规则：满值 + 14 天，放进纯函数

新增 `src/lib/review/cooldown.ts`：

```ts
export const MASTERED_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
export function inCooldown(e: { familiarity: number; lastReviewedAt: string | null }, now: number): boolean
// familiarity >= MAX_FAMILIARITY 且 lastReviewedAt 可解析且 now - at < 冷却期
```

`start()` 在 `splitRecent` / `splitPrevious` 之前先把 `usable` 过滤掉冷却中的词，因此冷却词既不进必修批也不进巩固词。冷却期满的满值词作为普通词进入 `older`。答对后熟练度仍为 5、`last_reviewed_at` 刷新 → 自动再冷却 14 天；答错降为 4 → 下次就是普通词。
- 为什么 14 天固定值而不是按次数递增：单人使用，先上最简单可解释的规则；常量集中一处，以后要改成递增间隔只改这个函数。
- 为什么阈值是 5 而不是难词拆解用的 4：用户选择「满 5 才降频」；4 的词仍需要练，尤其还要还拼写欠账（`owesSpelling` 在满值前一直有效）。
- 设置页显示「N 个已掌握的词在冷却中」，避免用户以为词丢了。

### 5. 进行中轮次存 localStorage，只存 id 不存词条

`src/lib/review/session.ts` 维护键 `review-session-v1`：

```ts
{ v: 1, kind, mode, cnRatio, limit, mustDo, cursor,
  cards: { id: string; type: QuizType }[],
  verdicts: Record<number, boolean>, marked: Record<number, boolean>,
  startedAt: number }
```

- 每次 `cursor` / `verdicts` / `marked` 变化后写入；进入 `done` 或选择结束时清除。
- 复习页加载完 `all` 后若存在存档：设置页顶部显示「上次有一轮没背完（第 x 张 · 生词 y 个）— 继续 / 结束这一轮」。继续时用 id 映射回 `all` 中的最新词条，找不到的（已删除）连同其下标上的判定一起剔除并重新编号。
- 存档超过 3 天视为过期，直接按「结束这一轮」处理（regular 轮次照常结算名单）。
- 为什么不存服务端：进行中状态写得频繁，单设备够用；名单这种长期数据才进库。
- 为什么只存 id：词条快照会过时（释义补全、熟练度变化），恢复时取最新值，与 `repeatRound` 现有做法一致。

### 6. 写库失败进 outbox，带原始作答时间补写

`src/lib/review/outbox.ts`，localStorage 键 `review-outbox-v1`，元素：
- `{ kind: 'mark', id, known, quizType, reviewedAt }`
- `{ kind: 'leftover', ids, at }`（同类只保留最新一条）

`commit()` 改为：发请求 → 成功（2xx）则结束；返回 401 / 5xx / 网络异常则入队，页面显示「N 条判定未保存」，401 时附「登录已过期，去重新登录」链接（登录页整页跳转回首页后用户再进复习页即可，不改登录页）。4xx 中除 401 外（404 记录已删、400）视为不可重试，直接丢弃。

冲刷时机：复习页挂载、`window` 的 `online` 事件、页面重新获得焦点。按顺序逐条发，遇到 401 停止（会话还没恢复），其余失败保留重试。

`/api/review/mark` 新增可选 `reviewedAt`：ISO 时间，不晚于服务端当前时间 + 1 分钟、不早于 7 天前时采用，否则用 `now()`。这样补写不会把一个三天前背的词记成「刚背过」，避免它被 `splitRecent` 误判成今天的巩固词。

- 已知取舍：网络异常时请求可能其实已到达服务端，补写会多算一次 `review_count` 并让熟练度多走一步。单人场景下发生概率低，不为此引入幂等键（见风险）。

### 7. 本地同步计算保持不变

`commit()` 里现有的「本地按服务端规则同步更新 `all`」逻辑保留 —— 即使写库失败进了 outbox，本地状态也已前进，与补写成功后的服务端最终状态一致。

## Risks / Trade-offs

- [网络异常时请求实际已成功，补写造成重复计数] → 只对网络异常/401/5xx 重试；单人使用影响很小。如以后在意，可给每条判定加客户端 uuid、服务端去重。
- [localStorage 被清或换浏览器，进行中轮次丢失] → 只是丢「接着背」的便利，名单与已成功写库的判定都在服务端。
- [冷却期内的满值词完全不出，用户觉得「词少了」] → 设置页显示冷却中词数；「复习上一轮生词」不受冷却影响。
- [用户在两个标签页同时复习，存档互相覆盖] → 单人使用，接受；以最后写入为准。
- [续背时 `all` 已变（删词），下标错位] → 恢复时按 id 重建并重新编号下标，丢弃找不到的卡及其判定。

## Migration Plan

1. 在 Supabase 执行 `supabase/migrations/0003_review_leftover.sql`（新表 + RLS + RPC），与现有数据无冲突，可先于前端上线。
2. 部署网页（`vercel --prod --scope dennisliu2015fgmailcoms-projects`）。
3. 回滚：前端回退即可；新表留着无副作用，需要时 `drop function replace_review_leftover; drop table review_leftover;`。

## Open Questions

- 冷却期 14 天是否合适，用一段时间再调（只改 `MASTERED_COOLDOWN_MS`）。

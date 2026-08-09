# 工程笔记（二次开发必读）

> 这份文档汇总了本项目的**架构决策、约定规范，以及开发过程中踩过的每一个坑**。
> 二次开发前先通读一遍——很多设计是「反直觉但有意为之」的，改错会引入回归。
> 代码里对应位置一般也有行内注释，这里做集中索引与背景说明。

---

## 1. 技术栈与环境的「反直觉点」

### 1.1 这不是你熟悉的 Next.js
- 版本是 **Next.js 16**（App Router、Turbopack、React 19、Tailwind v4），不是计划文档里写的 15.x。
- 中间件文件叫 **`src/proxy.ts`**（不是 `middleware.ts`），导出的函数叫 `proxy`。
- **不要再写 `export const runtime = 'nodejs'`**：Next 16 里 nodejs 是默认、edge 已废弃，写了会被要求移除。
- 写代码前先读 `node_modules/next/dist/docs/`（从项目目录解析），API 与约定可能和你的记忆不同。
- `AGENTS.md` 顶部那段「This is NOT the Next.js you know」是 `next dev` 自动写入的，提交它能保持工作树干净。

### 1.2 类型检查用 `npm run build`，不要用裸 `tsc`
- 裸 `npx tsc --noEmit` 会对 `src/app/layout.tsx` 报假错 `TS2304: Cannot find name 'LayoutProps'`。
- `LayoutProps` 是 Next 16 构建时生成在 `.next/types` 的全局类型。**权威类型检查是 `npm run build`**。

### 1.3 Tailwind v4
- 无 `tailwind.config.js`；主题在 `src/app/globals.css` 用 `@theme inline` 定义。
- 设计 token（见 §4）都是 CSS 变量，改配色改这里。

### 1.4 Supabase 实例在海外
- 单次往返 ≈ 350ms。**能并行的查询一定并行**（见 `lib/dict/lookup.ts`、`lib/hardwords/extract.ts` 的 `Promise.all`），串行三次往返 = 1 秒起步。

---

## 2. 架构总览

两层解耦是最重要的设计原则：**词典层不依赖 LLM 层**。所有翻译后端挂掉时，查词 / 单词本 / 复习仍然可用。

- **词典层**：ECDICT 高频子集（`dict_entries` / `dict_lemma`）+ dictionaryapi.dev 音标（`dict_cache`）。
- **LLM 层**：调度器（scheduler）管理多个 provider，带熔断器与首字节超时降级。
- **数据/认证**：Supabase Postgres + Auth + RLS，服务端写入用 `service_role`。

### 2.1 查词五级降级链（`lib/dict/lookup.ts` + `app/api/word/[word]/route.ts`）
1. **精确**：`dict_entries.word_key` 命中
2. **词形还原**：`dict_lemma` 把 `running → run`
3. **后缀规则**：`stripSuffixCandidates` 兜底
4. **AI 兜底**：LLM 生成释义并**回写词库**（详见 §5）
5. **未收录**：以上都没有

前四级在 `lookupWord()` 里（纯查询）；**第五级放在路由里编排**，这样 `lookupWord` 保持纯净、不用给所有调用方（含测试、hard-words）传 user/quota。

### 2.2 翻译调度（`lib/translate/`）
- `scheduler.ts` 按优先级（`ollama` → `cloud`）试 provider，命中首字节即锁定。
- `breaker.ts` 熔断：连续失败到阈值后进入冷却期。**冷却时长是构造参数，不是硬编码**（scheduler 用 `5 * 60 * 1000` 注入；测试注入小值）。
- 首字节超时用 `AbortController` 真正掐断卡住的 fetch，光丢弃迭代器不够（生成器卡在 `await fetch()` 上时 `return()` 要等 await 落地）。

---

## 3. 踩过的坑（务必不要再犯）

### 3.1 安全 / 认证
- **Postgres 函数默认 `GRANT EXECUTE TO PUBLIC`**。从 `anon` 撤权碰不到 PUBLIC，必须 `revoke all from public` 再显式 grant 给 `authenticated`/`service_role`。配额 RPC `increment_usage` 就是这么处理的。
- **`PUBLIC_PATHS` 前缀匹配会造成鉴权绕过**（`/loginfoo` 会被当成 `/login`）。必须 `path === p || path.startsWith(p + '/')`。见 `proxy.ts`。
- **注册路由与 proxy 的 fail 语义刻意不对称**：
  - 注册路由（`api/auth/signup`）「白名单未配置」时 **fail-closed**（拒绝一切注册）——它用 `service_role` 建号、不验证邮箱所有权，fail-open 等于开了个无限开户口子。
  - proxy 层 **fail-open**（未配置白名单时放行）——免得某次漏配把所有人（含管理员）锁在门外。
  - **改的时候不要为了「统一」把其中一边掰成另一边。**
- 邮箱白名单变量 `ALLOWED_EMAILS`（逗号分隔，大小写不敏感）。

### 3.2 Next 路由
- **动态段已被 Next 解码过一次**。不要在 `api/word/[word]` 里再 `decodeURIComponent`，否则含字面 `%` 的输入（如 `100%`）会抛 `URIError` 导致 500。
- **静态段会遮蔽同级动态路由**。`api/word/explain` 会挡住 `api/word/[word]`，导致查「explain」这个词命中只有 POST 的静态路由返回 405。所以上下文释义放在 `api/explain`、AI 回写放在 `api/ai-entry`，都**不放在 `api/word/` 下**。

### 3.3 词典数据
- **多候选取 `[0]` 必须保证候选顺序有意义**，不能靠数据库返回行序。`caring` 的后缀候选 `care`/`car` 都是真词，`IN` 查询行序不定 → 用 `pickInOrder` 按语言学优先级挑，否则偶发 `caring → 汽车`。
- **ECDICT 上游 CSV 本身含损坏音标**（`deferred` = `di'f\\:d`，全库约 1320 行含反斜杠）。这**不是导入 bug**，不要再去查它。
- 词典 `translation` 字段格式：每行 `词性 释义`，`parseTranslation` 解析、AI 回写时用同样格式序列化（`serializeSenses`），保证可逆。

### 3.4 LLM / 流式
- **云端 `DeepSeek-V4-Flash` 是推理模型**：流开头会吐约 45 块 `delta.reasoning_content`（`delta.content` 为 null），真正内容在最后几块。
  - 因此**首字节判据不能是「第一个文本增量」**，否则长输入会超时误杀健康后端（且 ollama 未配置时 cloud 是唯一 provider → 整体 503）。
  - 解法：provider 每读到一行 HTTP body 就产出，无内容时产出**空串「心跳」**；调度器认心跳为首字节，并在外传前把空串滤掉。见 `cloud.ts` / `scheduler.ts`。
- **`toLines`（`stream.ts`）两个易漏点**：① 流在多字节字符中途断掉时，尾字节留在 `TextDecoder` 内部，结束时要 `decoder.decode()` 冲刷；② 消费者提前 `break` 时要 `reader.cancel()`，否则底层 HTTP fetch 一直挂着。
- **AI 绝不生成音标**：IPA 幻觉率高、错音标背下来难纠正。AI 兜底只产释义，回写时 `phonetic` 留空；音标继续走 dictionaryapi.dev → ECDICT → 无 的既有链路。

### 3.5 React / 前端
- **StrictMode 下 `mountedRef` 必须在 effect setup 里置回 `true`**。只在 cleanup 里置 false 会导致「假卸载」后 ref 永久为 false，`pronounce()` 一 resolve 就被当成已卸载、按钮永久 loading。见 `WordCard.tsx` 的发音按钮。
- **划词浮层的两处 mousedown/mouseup 竞态**（`SelectionPopover.tsx`）：
  - 点浮层**内部**（如发音按钮）也会冒泡出 `mouseup`，此时选区还在 → 每点一次重查一次。用 `e.target.closest('[data-selection-popover]')` 早退，并用 `wordRef` 记当前词、相同就不重查。
  - 点浮层**外部**关闭时，一次点击的 `mousedown`（关闭、清 wordRef）和 `mouseup`（onSelect）配对：若在 close() 里清 wordRef，而浏览器尚未清旧选区，mouseup 会把它当新选择重查。解法：`close()` 不动 wordRef，改由 `onSelect` 在**选区真正收起（空选区）**时才清。
  - 定位用 **`position: fixed` + 视口坐标**，不是「relative 容器 + absolute + 页面坐标」（后者把页面坐标当容器坐标用，滚动后必偏）。
- **划词与单词查询共用 `lib/dict/clientLookup.ts`**，别各写一份 fetch。它内部按本地模型配置决定是否走浏览器兜底。

### 3.6 部署 / 测试
- **Vercel 部署必须带 `--scope dennisliu2015fgmailcoms-projects`**，否则 `vercel --prod` 返回 `Not authorized`（whoami 的个人身份与项目所属 team 不同）。CLI 不在 PATH，用 `npx vercel`；项目已 link，无需 git push，CLI 直接上传本地目录云端构建。
- **Playwright 的 dotenv 默认只读 `.env`**，E2E 变量在 `.env.local`，config 里要显式 `dotenv.config({ path: '.env.local' })`。
- E2E `baseURL` 默认 `3001`（本机 dev 实际端口，3000 常被占用），`workers: 1` 串行避免共享单词本互踩。
- **E2E 选择器要防 strict-mode 歧义**：`苹果` 会命中多条释义 → `.first()`；`unprecedented` 在输入框/原文/难词展开/收藏按钮里都出现 → 用唯一的 `收藏 unprecedented` aria-label 定位。

---

## 4. 设计系统与 UI 约定

配色 token（`globals.css`，同时定义了 light/dark）：

| token | 含义 |
|---|---|
| `--paper` / `--card` | 页面底 / 卡片底 |
| `--ink` / `--ink-2` / `--ink-3` | 主文 / 次要 / 更弱（ink-2/ink-3 经对比度校验达 WCAG AA） |
| `--rule` | 分隔线 |
| `--seal` | 红系强调（柯林斯星级、收藏星标、错误） |
| `--jade` | 绿系（牛津核心、成功态） |
| `--focus` | 键盘焦点外环 |

约定：
- 圆角统一 `rounded-[10px]`；主按钮 `bg-ink text-card`；边框 `border-rule`。
- 竖线分隔（`bg-rule` 的 1px 列）是本项目的结构装置：词卡「词性 │ 释义」、译文「原文 │ 译文」、难词「本句 │ 释义」用的是同一个装置，表达「同一份内容的两种语域」，不是装饰。
- 流式译文末尾的墨水光标 `.streaming-caret` 是唯一诚实的「还在写」信号（尊重 `prefers-reduced-motion`）。
- 涉及界面时遵循 frontend-design / web-design-guidelines；**新页面一律适配上面的 token**，不要引入 `neutral-*`/`black`/`red-600` 这类通用色。

---

## 5. AI 兜底（未收录词）设计

- **触发**：查词五级里的第四级，仅当前三级 miss。
- **闸门（`isAiFallbackEligible`，在 `lib/dict/ai-parse.ts`）**：长度 ≤ 32、形如 `^[a-z][a-z'-]*$`，挡掉超长/纯数字/乱码。调用前**消耗配额**防刷。
- **生成**：`generateEntry` 复用 `getScheduler().run()` 收集全文（非流式），`parseAiSenses` 防御性解析（剥 ```json 围栏、取首尾大括号、逐字段运行时校验，任何失败返回 null）。
- **非有效英文词**：prompt 要求返回 `{"senses":[]}`，前端显示「未收录」——**不硬编造释义**（比未收录更糟）。所以查 `onnology` 这类拼写错误仍显示未收录，是**正确行为**。
- **回写（`saveAiEntry`）**：写 `dict_entries`（`word` + `translation`，`phonetic` 留空）。这是「天然缓存」——下次查同词第一级精确命中，不再花 LLM。
- **纯函数拆分**：`parseAiSenses` / `isAiFallbackEligible` 放在 `ai-parse.ts`（无服务端依赖），服务端路由和浏览器本地模型路径共用；`ai-entry.ts` 只放需要 scheduler/db 的 `generateEntry`/`saveAiEntry`。
- **未采用 spec 的 `source` 列**：为「零手动 migration」，回写不依赖新列；区分 AI/ECDICT 来源作为「日后」优化省略了。若要加，见 `task-ai-fallback-spec.md`。

---

## 6. 浏览器侧本地模型（`lib/translate/localModel.ts`）

- 配置存 `localStorage`（key `localModelConfig`）：`baseUrl` / `model` / `prompt?` / `apiKey?`。只兼容 OpenAI 协议。设置页 `app/settings/page.tsx`。
- **配了就覆盖服务端**，覆盖范围：
  - 翻译（流式，`streamLocalTranslate`）
  - 划词/单词的 AI 兜底（非流式 `generateLocalWordSenses` + `parseAiSenses`）
  - 难词释义（非流式 `explainLocal`）
- **避免重复花钱**：配了本地模型时，查词请求带 `?ai=skip`，服务端不再花云端 token 兜底；浏览器直连本地模型生成后，经 `POST /api/ai-entry` 回写词库（收录）。
- **限制**：线上 HTTPS 页面直连 `http://localhost` 会被浏览器按「混合内容」拦截，且本地端点需允许本站跨域。解法（设置页有指引）：用隧道（cloudflared/ngrok）暴露成 https，或 `OLLAMA_ORIGINS` 放行本站。本机 http 开发无此限。

---

## 7. 复习与单词本

- **单词本一律走用户会话客户端（`createServerSupabase`）+ RLS 隔离**，不得用 `createAdminSupabase` 绕过 RLS。
- 收藏的是**原型**（`word_key`），不是用户输入的表面形式，否则 `running`/`run` 会存两条。重复收藏返回既有记录、不报错。
- 复习排序 `orderCards` 用**带种子的 PRNG（mulberry32）**而非 `Math.random()`，测试可断言确定结果；**种子在用户点击「开始」时生成**，不能在渲染期算，否则 SSR/水合不一致报 hydration 错误。
- 熟练度 `nextFamiliarity`：认识 +1（封顶 5）、不认识 -1（兜底 0）。达到设定阈值的词会被难词拆解排除。
- 第一版**不实现 SM-2**：只更新 `familiarity`/`review_count`/`last_reviewed_at`，`due_at`/`ease_factor`/`interval_days` 保持默认。
- 已知简化（计划已标注、非 bug）：`FavoriteButton` 挂载时不查已收藏态（刷新后星标回到未收藏样式，但重复收藏由后端兜住不产生脏数据）；复习卡背显示收藏时的原句而非词典释义。

---

## 8. 音标与发音

- 发音：有道 TTS 为主 + Web Speech API 兜底（`lib/audio/pronounce.ts`）。
- **发音按钮不依赖 dictionaryapi.dev 的音标数据**——有道和本地合成只需要词本身，只要查到词就允许发音。
- 音标性能：缓存优先（同步读 `dict_cache`），未命中先用空音标应答，再用 `after()` 在响应送出后补抓并写回缓存（`app/api/word/[word]/route.ts`）。用 `after()` 而非裸 fire-and-forget，因为 serverless 下不被等待的 Promise 可能被回收。

---

## 9. 配额

- `consumeQuota`（`lib/quota.ts`）调 `increment_usage` RPC，**必须用 `service_role`**（该 RPC 已从 PUBLIC 撤权）。
- 这里是 **fail-open**（RPC 报错时放行）：调用方已校验登录态、userId 来自会话而非请求体，配额只是防滥用手段，不该因计数表故障让正常用户完全不能用。与注册路由那处刻意的 fail-closed 不同。

---

## 10. 目录与测试约定

- 单元测试与源码**同目录**（`*.test.ts`），Vitest 跑；`e2e/` 归 Playwright，vitest 已排除。
- API 路由测试用 mock（`createServerSupabase`/`createAdminSupabase`/依赖全 mock），不打网络、不依赖 DB 是否导入数据。改路由逻辑时记得同步更新其 mock（例如加了配额/AI 兜底就要 mock `consumeQuota`/`generateEntry`）。
- 过程记录（SDD ledger、计划、规范）在 `.superpowers/`（本地、gitignore）与 `docs/superpowers/`（入库）。

---

## 11. 二次开发前的检查清单

- [ ] 读过本文 §1（Next 16 反直觉点）与 §3（坑）
- [ ] 类型检查用 `npm run build`，不是裸 `tsc`
- [ ] 改鉴权/白名单：留意 fail-open/fail-closed 的刻意不对称（§3.1）
- [ ] 加 API 路由：别放在 `api/word/` 下形成静态段遮蔽（§3.2）
- [ ] 新页面用设计 token，不用通用色（§4）
- [ ] 动了 LLM/流式：记得推理模型的首字节心跳（§3.4）
- [ ] 部署用 `npx vercel --prod --scope dennisliu2015fgmailcoms-projects`（§3.6）
- [ ] 跑 `npm test` + `npm run test:e2e`（E2E 需 `.env.local` 配 E2E 账号）

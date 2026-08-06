# Plan 1 · 地基与词典层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可登录的网站，输入单个英文单词即可查到美/英音标、发音音频与按词性分组的中文释义；全程不依赖 LLM。

**Architecture:** Next.js App Router 部署于 Vercel，Supabase 提供 Postgres + Auth + RLS。ECDICT 高频子集导入数据库作为确定性词典层，dictionaryapi.dev 补充美/英分离音标并缓存入库。查询链路为四级降级：精确命中 → 词形还原 → 后缀规则 → 在线 API。

**Tech Stack:** TypeScript, Next.js 15 (App Router), React 19, Tailwind CSS, Supabase (`@supabase/supabase-js` + `@supabase/ssr`), Vitest, Caddy, frp

**依赖文档:** `docs/superpowers/specs/2026-08-06-translate-wordbook-design.md`

## Global Constraints

- Node.js 20 或以上；包管理器统一用 `npm`
- TypeScript `strict: true`，不得使用 `any` 绕过类型检查（第三方 JSON 解析处除外，且必须做运行时校验）
- 只用 Next.js App Router，不引入 Pages Router
- 单元测试用 Vitest，测试文件与源码同目录，命名 `<name>.test.ts`
- 数据库表名与列名严格照 spec 第 5 节，**不得改名**：`dict_entries` `dict_lemma` `dict_cache` `wordbook` `usage_counter`
- **任何情况下都不得用 LLM 生成音标**
- 密钥只在服务端读取。凡是 `NEXT_PUBLIC_` 前缀的环境变量都会进浏览器包，`SUPABASE_SERVICE_ROLE_KEY` / `OLLAMA_TOKEN` / `CLOUD_API_KEY` 绝不能加该前缀
- 每个 Task 结束必须 commit，commit message 用中文，前缀 `feat:` / `fix:` / `docs:` / `chore:`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `docs/infra/hardening.md` | VPS 加固操作记录与验证结果 |
| `docs/infra/Caddyfile.example` | Caddy 配置模板 |
| `supabase/migrations/0001_init.sql` | 全部 5 张表 + RLS + 配额 RPC |
| `.env.local.example` | 环境变量清单模板 |
| `src/lib/text/normalize.ts` | 输入类型判定与单词规范化（纯函数） |
| `src/lib/dict/types.ts` | 词典层共享类型 |
| `src/lib/dict/filter.ts` | ECDICT 行过滤（纯函数） |
| `src/lib/dict/exchange.ts` | `exchange` 字段解析为词形对（纯函数） |
| `src/lib/dict/senses.ts` | ECDICT `translation` 解析为分词性释义（纯函数） |
| `src/lib/dict/inflect.ts` | 后缀剥离候选生成（纯函数） |
| `src/lib/dict/dictapi.ts` | dictionaryapi.dev 响应解析 + 带缓存的音标获取 |
| `src/lib/dict/lookup.ts` | 四级降级查询链路 |
| `src/lib/supabase/client.ts` | 浏览器端 Supabase 客户端 |
| `src/lib/supabase/server.ts` | 服务端（cookie 会话）Supabase 客户端 |
| `src/lib/supabase/admin.ts` | service_role 客户端，仅服务端 |
| `scripts/import-ecdict.ts` | ECDICT 导入脚本 |
| `src/middleware.ts` | 路由保护 |
| `src/app/login/page.tsx` | 登录/注册页 |
| `src/app/auth/callback/route.ts` | Supabase Auth 回调 |
| `src/app/api/word/[word]/route.ts` | 单词查询接口 |
| `src/components/WordCard.tsx` | 单词详情卡片 |
| `src/app/page.tsx` | 主页 |

**拆分原则：** 每个纯函数一个文件，因为它们各自独立可测且会被 Plan 2 的难词拆解复用。IO 相关逻辑（`dictapi.ts` / `lookup.ts`）与纯函数分离，保证纯函数测试不需要数据库。

---

### Task 1: VPS 安全加固与 ollama 端到端验证

这是**唯一先于写代码的任务**，因为 `47.117.245.194:1434` 当前对公网开放是正在生效的安全问题。

**Files:**
- Create: `docs/infra/hardening.md`
- Create: `docs/infra/Caddyfile.example`

**Interfaces:**
- Consumes: 无
- Produces: 一个可用的 HTTPS 端点 `https://ollama.<域名>`，需 `Authorization: Bearer <TOKEN>`，仅接受 `POST /api/chat`。Plan 2 的 `OllamaProvider` 依赖它。

- [ ] **Step 1: 确认问题存在**

在本机运行：

```bash
nc -z -v 47.117.245.194 1434
```

预期：`succeeded!` —— 证明端口对公网开放，加固有必要。

- [ ] **Step 2: 在 VPS 上把 1434 收回内网**

编辑 VPS 上的 `frps.toml`，在顶层加入：

```toml
proxyBindAddr = "127.0.0.1"
```

重启：`systemctl restart frps`

⚠️ 此项为全局设置。若 VPS 上还有其他 frp 代理需要公网直连，**改用**按端口封禁，不要加上面这行：

```bash
ufw deny 1434/tcp
```

- [ ] **Step 3: 验证 1434 已不可从公网访问**

在本机运行：

```bash
nc -z -v -w 5 47.117.245.194 1434
```

预期：`Connection refused` 或超时。若仍显示 `succeeded`，说明第 2 步未生效，不要继续。

- [ ] **Step 4: 添加 DNS 记录**

在域名服务商处添加 A 记录：`ollama.<你的域名>` → `47.117.245.194`

验证：`dig +short ollama.<你的域名>` 预期输出 `47.117.245.194`

- [ ] **Step 5: 生成鉴权密钥**

```bash
openssl rand -hex 32
```

保存输出，后续作为 `OLLAMA_TOKEN`。

- [ ] **Step 6: 写入 Caddy 配置模板**

创建 `docs/infra/Caddyfile.example`：

```caddyfile
# 部署到 VPS 的 /etc/caddy/Caddyfile
# 把 <域名> 和 <TOKEN> 替换为实际值后使用
ollama.<域名> {
    @allowed {
        path /api/chat
        method POST
        header Authorization "Bearer <TOKEN>"
    }
    handle @allowed {
        reverse_proxy 127.0.0.1:1434 {
            # 关闭响应缓冲，否则流式输出会被攒着一次性返回
            flush_interval -1
        }
    }
    handle {
        respond 404
    }
}
```

在 VPS 上把替换后的内容写入 `/etc/caddy/Caddyfile`，然后：

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

- [ ] **Step 7: 在家中启动 ollama 与 frpc**

```bash
ollama serve      # 若未作为服务运行
ollama list       # 记录已安装模型，下一步要用
frpc -c ./frpc.toml
```

- [ ] **Step 8: 验证鉴权与路径白名单**

依次运行，四项全部符合预期才算通过：

```bash
# 无 token → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ollama.<域名>/api/chat

# 错 token → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer wrong" https://ollama.<域名>/api/chat

# 正确 token 但访问 /api/tags → 404（路径白名单生效）
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <TOKEN>" https://ollama.<域名>/api/tags

# 正确 token + POST /api/chat → 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"model":"<模型名>","messages":[{"role":"user","content":"hi"}],"stream":false}' \
  https://ollama.<域名>/api/chat
```

预期依次为：`404` `404` `404` `200`

- [ ] **Step 9: 验证流式响应未被缓冲**

```bash
curl -N -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"model":"<模型名>","messages":[{"role":"user","content":"从1数到20，每个数字单独一行"}],"stream":true}' \
  https://ollama.<域名>/api/chat
```

预期：输出**逐块出现**，而非等待数秒后一次性刷出。若是后者，检查 Caddy 的 `flush_interval -1` 是否生效。

- [ ] **Step 10: 翻译质量基线测试**

这一步对应 spec 第 14 节的首要风险。用同一组句子分别测试本机模型，记录结果：

测试句 1（普通句）：`Translate to Chinese, output only the translation: The committee deferred the decision pending further review.`
测试句 2（含习语）：`Translate to Chinese, output only the translation: She let the cat out of the bag at the meeting.`
测试句 3（技术文本）：`Translate to Chinese, output only the translation: The mutex prevents concurrent access to the shared buffer.`

- [ ] **Step 11: 记录加固结果**

创建 `docs/infra/hardening.md`，内容包含：
- 采用的方案（`proxyBindAddr` 还是 ufw）
- 域名
- Step 8 四项验证的实际返回码
- Step 9 是否逐块输出
- `ollama list` 的完整输出（已安装模型及体积）
- Step 10 三句的实际译文，以及主观质量判断（可用 / 勉强 / 不可用）

**若 Step 10 判定为「不可用」，在文档中明确记录，并在 Plan 2 开始前重新评估「ollama 主用」这一前提。**

⚠️ 该文档**不得包含 TOKEN 明文**，写成 `<TOKEN>` 占位。

- [ ] **Step 12: Commit**

```bash
git add docs/infra/
git commit -m "docs: VPS 安全加固方案与 ollama 连通性验证记录"
```

---

### Task 2: 项目脚手架 + Vitest + 输入类型判定

**Files:**
- Create: 由 `create-next-app` 生成的项目骨架
- Create: `vitest.config.ts`
- Create: `src/lib/text/normalize.ts`
- Test: `src/lib/text/normalize.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `isSingleWord(raw: string): boolean` —— 判定输入走单词模式还是段落模式，Plan 2 的翻译接口依赖它
  - `normalizeWord(raw: string): string` —— 去除首尾非字母字符并小写，产出用于 `word_key` 匹配的键

- [ ] **Step 1: 创建项目骨架**

在仓库根目录运行（当前目录已有 `docs/` 和 `.git`，用 `.` 就地创建）：

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

遇到"目录非空"提示时选择继续。

- [ ] **Step 2: 安装并配置 Vitest**

```bash
npm install -D vitest @vitejs/plugin-react jsdom
```

创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

在 `package.json` 的 `scripts` 中加入：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 写失败的测试**

创建 `src/lib/text/normalize.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { isSingleWord, normalizeWord } from './normalize'

describe('isSingleWord', () => {
  it('识别单个单词', () => {
    expect(isSingleWord('hello')).toBe(true)
  })
  it('忽略首尾空白', () => {
    expect(isSingleWord('  hello  ')).toBe(true)
  })
  it('接受撇号', () => {
    expect(isSingleWord("don't")).toBe(true)
  })
  it('接受连字符', () => {
    expect(isSingleWord('well-known')).toBe(true)
  })
  it('多个词判为段落', () => {
    expect(isSingleWord('hello world')).toBe(false)
  })
  it('中文判为段落', () => {
    expect(isSingleWord('你好')).toBe(false)
  })
  it('空串判为段落', () => {
    expect(isSingleWord('')).toBe(false)
  })
  it('带句号判为段落', () => {
    expect(isSingleWord('hello.')).toBe(false)
  })
  it('数字开头判为段落', () => {
    expect(isSingleWord('3d')).toBe(false)
  })
})

describe('normalizeWord', () => {
  it('去除尾部标点并小写', () => {
    expect(normalizeWord('Hello,')).toBe('hello')
  })
  it('去除首尾空白与感叹号', () => {
    expect(normalizeWord('  Running!  ')).toBe('running')
  })
  it('保留词内撇号', () => {
    expect(normalizeWord("Don't")).toBe("don't")
  })
  it('保留词内连字符', () => {
    expect(normalizeWord('Well-Known')).toBe('well-known')
  })
  it('全非字母输入返回空串', () => {
    expect(normalizeWord('!!!')).toBe('')
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm test -- src/lib/text/normalize.test.ts
```

预期：FAIL，报错 `Failed to resolve import "./normalize"`

- [ ] **Step 5: 实现**

创建 `src/lib/text/normalize.ts`：

```ts
const SINGLE_WORD_RE = /^[a-zA-Z][a-zA-Z'-]*$/

/** 判定输入应走单词模式（true）还是段落模式（false）。 */
export function isSingleWord(raw: string): boolean {
  return SINGLE_WORD_RE.test(raw.trim())
}

/**
 * 规范化为可用于 word_key 匹配的键：
 * 剥掉首尾非字母字符（词内的撇号与连字符保留），再转小写。
 */
export function normalizeWord(raw: string): string {
  return raw
    .trim()
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/[^a-zA-Z]+$/, '')
    .toLowerCase()
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -- src/lib/text/normalize.test.ts
```

预期：14 个测试全部 PASS

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: 项目脚手架、Vitest 配置与输入类型判定"
```

---

### Task 3: Supabase 项目与数据库 schema

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `.env.local.example`
- Modify: `.gitignore`（追加 `.env.local`、`data/`）

**Interfaces:**
- Consumes: 无
- Produces: 5 张表（`dict_entries` `dict_lemma` `dict_cache` `wordbook` `usage_counter`）与 RPC `increment_usage(p_user uuid, p_limit int) returns boolean`。Plan 2 的配额检查依赖该 RPC，Plan 3 的单词本依赖 `wordbook` 表。

- [ ] **Step 1: 手动创建 Supabase 项目**

在 https://supabase.com 新建项目，记下：
- Project URL
- `anon` public key
- `service_role` key（Settings → API）
- 数据库密码

- [ ] **Step 2: 安装并链接 Supabase CLI**

```bash
npm install -D supabase
npx supabase init
npx supabase link --project-ref <你的 project ref>
```

- [ ] **Step 3: 写入环境变量模板与本地配置**

创建 `.env.local.example`：

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ollama（Plan 2 使用）
OLLAMA_BASE_URL=
OLLAMA_TOKEN=
OLLAMA_MODEL=

# 云端兜底，OpenAI 兼容接口（Plan 2 使用）
CLOUD_BASE_URL=
CLOUD_API_KEY=
CLOUD_MODEL=

# 每用户每日翻译配额（Plan 2 使用）
DAILY_QUOTA=200
```

复制一份为 `.env.local` 并填入真实值。

在 `.gitignore` 追加：

```
.env.local
data/
```

- [ ] **Step 4: 编写迁移**

创建 `supabase/migrations/0001_init.sql`：

```sql
-- ============ 词典层（全局共享，只读） ============

create table dict_entries (
  id          bigserial primary key,
  word        text not null,
  word_key    text generated always as (lower(word)) stored,
  phonetic    text,
  translation text,
  definition  text,
  pos         text,
  collins     smallint,
  oxford      smallint,
  tag         text,
  bnc         integer,
  frq         integer,
  exchange    text
);
create index dict_entries_word_key_idx on dict_entries (word_key);

create table dict_lemma (
  form  text not null,
  lemma text not null,
  primary key (form, lemma)
);
create index dict_lemma_form_idx on dict_lemma (form);

create table dict_cache (
  word_key    text primary key,
  phonetic_us text,
  phonetic_uk text,
  audio_us    text,
  audio_uk    text,
  found       boolean not null,
  fetched_at  timestamptz not null default now()
);

-- ============ 用户层 ============

create table wordbook (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  word             text not null,
  word_key         text not null,
  source_context   text,
  note             text,
  review_count     int not null default 0,
  familiarity      smallint not null default 0,
  last_reviewed_at timestamptz,
  -- SM-2 预留字段，Plan 1-3 均不参与逻辑
  due_at           timestamptz,
  ease_factor      real not null default 2.5,
  interval_days    int not null default 0,
  created_at       timestamptz not null default now(),
  unique (user_id, word_key)
);
create index wordbook_user_idx on wordbook (user_id, created_at desc);

create table usage_counter (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int not null default 0,
  primary key (user_id, day)
);

-- ============ RLS ============

alter table dict_entries enable row level security;
alter table dict_lemma   enable row level security;
alter table dict_cache   enable row level security;
alter table wordbook     enable row level security;
alter table usage_counter enable row level security;

-- 词典对登录用户只读；写入只走 service_role（service_role 自动绕过 RLS）
create policy dict_entries_read on dict_entries
  for select to authenticated using (true);
create policy dict_lemma_read on dict_lemma
  for select to authenticated using (true);
create policy dict_cache_read on dict_cache
  for select to authenticated using (true);

-- 用户数据严格按 user_id 隔离
create policy wordbook_owner on wordbook
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy usage_owner on usage_counter
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============ 配额 RPC（Plan 2 使用） ============
-- 原子递增当日计数，返回 true 表示未超额

create or replace function increment_usage(p_user uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into usage_counter (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day)
  do update set count = usage_counter.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
```

- [ ] **Step 5: 应用迁移**

```bash
npx supabase db push
```

预期：输出显示 `0001_init.sql` 应用成功，无报错。

- [ ] **Step 6: 验证表与 RLS 已生效**

在 Supabase 控制台的 SQL Editor 中运行：

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

预期：5 行，`rowsecurity` 全部为 `t`。

再运行：

```sql
select proname from pg_proc where proname = 'increment_usage';
```

预期：1 行。

- [ ] **Step 7: Commit**

```bash
git add supabase/ .env.local.example .gitignore
git commit -m "feat: 数据库 schema、RLS 策略与配额 RPC"
```

---

### Task 4: Supabase 客户端封装、登录页与路由保护

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `.env.local` 中的三个 Supabase 变量（Task 3）
- Produces:
  - `createBrowserSupabase(): SupabaseClient` —— 客户端组件使用
  - `createServerSupabase(): Promise<SupabaseClient>` —— Route Handler / Server Component 使用，自动带上 cookie 会话
  - `createAdminSupabase(): SupabaseClient` —— service_role，**仅可在服务端调用**，用于写 `dict_cache`
  - 中间件保护 `/` 与 `/api/*`（`/login`、`/auth/*` 除外），未登录跳转 `/login`

- [ ] **Step 1: 安装依赖**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: 实现三个客户端工厂**

创建 `src/lib/supabase/client.ts`：

```ts
'use client'

import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

创建 `src/lib/supabase/server.ts`：

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** 带 cookie 会话的服务端客户端。受 RLS 约束。 */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {
            // Server Component 中无法写 cookie，由 middleware 负责刷新
          }
        },
      },
    },
  )
}
```

创建 `src/lib/supabase/admin.ts`：

```ts
import { createClient } from '@supabase/supabase-js'

/**
 * service_role 客户端，绕过 RLS。
 * 只能在服务端调用 —— 泄露到浏览器等同于交出整个数据库。
 */
export function createAdminSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 未配置')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false },
  })
}
```

- [ ] **Step 3: 实现中间件**

创建 `src/middleware.ts`：

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/auth']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p))

  if (!user && !isPublic) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|mp3)$).*)'],
}
```

- [ ] **Step 4: 实现登录页**

创建 `src/app/login/page.tsx`：

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const supabase = createBrowserSupabase()
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    if (mode === 'signup') {
      setMessage('注册成功，请查收邮件完成验证后再登录。')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">
        {mode === 'signin' ? '登录' : '注册'}
      </h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email" required value={email} placeholder="邮箱"
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <input
          type="password" required minLength={6} value={password} placeholder="密码"
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <button
          type="submit" disabled={busy}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册'}
        </button>
      </form>
      {message && <p className="text-sm text-red-600">{message}</p>}
      <button
        type="button"
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null) }}
        className="text-sm underline"
      >
        {mode === 'signin' ? '还没有账号？去注册' : '已有账号？去登录'}
      </button>
    </main>
  )
}
```

- [ ] **Step 5: 实现 Auth 回调**

创建 `src/app/auth/callback/route.ts`：

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const supabase = await createServerSupabase()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/', request.url))
}
```

- [ ] **Step 6: 手动验证登录流程**

```bash
npm run dev
```

依次验证：
1. 访问 `http://localhost:3000/` → 应被重定向到 `/login`
2. 在 `/login` 注册一个账号 → 提示查收邮件（若 Supabase 项目关闭了邮箱验证则直接登录）
3. 完成验证后登录 → 应跳转回 `/`
4. 已登录状态下再访问 `/login` → 可正常显示（不做强制跳转）
5. 用无痕窗口访问 `http://localhost:3000/api/word/hello` → 应返回 401 JSON 而非重定向

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase src/middleware.ts src/app/login src/app/auth
git commit -m "feat: Supabase 客户端封装、邮箱登录与路由保护"
```

---

### Task 5: ECDICT 行过滤器

**Files:**
- Create: `src/lib/dict/types.ts`
- Create: `src/lib/dict/filter.ts`
- Test: `src/lib/dict/filter.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface EcdictRow` —— CSV 一行的原始形态，所有字段均为 `string`（CSV 解析产物）
  - `shouldImport(row: EcdictRow): boolean` —— Task 8 的导入脚本依赖

- [ ] **Step 1: 定义共享类型**

创建 `src/lib/dict/types.ts`：

```ts
/** ECDICT stardict.csv 一行的原始形态，所有字段均为字符串。 */
export interface EcdictRow {
  word: string
  phonetic: string
  definition: string
  translation: string
  pos: string
  collins: string
  oxford: string
  tag: string
  bnc: string
  frq: string
  exchange: string
}

/** 分词性的一条中文释义。 */
export interface Sense {
  /** 词性缩写，如 'n.' 'vt.'；无法识别时为空串。 */
  pos: string
  meaning: string
}

/** 词形 → 原型的映射对，两侧均为小写。 */
export interface LemmaPair {
  form: string
  lemma: string
}

/** 美/英分离的音标与发音音频。 */
export interface PhoneticSet {
  phoneticUs: string | null
  phoneticUk: string | null
  audioUs: string | null
  audioUk: string | null
}

/** 词典查询的命中来源。 */
export type MatchSource = 'exact' | 'lemma' | 'suffix' | 'none'

/** 单词查询的完整结果。 */
export interface WordDetail {
  /** 用户原始输入 */
  query: string
  /** 实际命中的词（可能是原型） */
  word: string
  matchedFrom: MatchSource
  /** ECDICT 单一音标，作为美/英音标缺失时的保底显示 */
  phonetic: string | null
  phoneticUs: string | null
  phoneticUk: string | null
  audioUs: string | null
  audioUk: string | null
  senses: Sense[]
  /** 考试标签，如 ['cet4', 'ielts'] */
  tags: string[]
  /** 柯林斯星级 1-5，无则 null */
  collins: number | null
  oxford: boolean
}
```

- [ ] **Step 2: 写失败的测试**

创建 `src/lib/dict/filter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { shouldImport } from './filter'
import type { EcdictRow } from './types'

function row(overrides: Partial<EcdictRow> = {}): EcdictRow {
  return {
    word: 'sample', phonetic: '', definition: '', translation: '',
    pos: '', collins: '', oxford: '', tag: '', bnc: '', frq: '',
    exchange: '', ...overrides,
  }
}

describe('shouldImport', () => {
  it('frq 有排名则导入', () => {
    expect(shouldImport(row({ frq: '1200' }))).toBe(true)
  })
  it('bnc 有排名则导入', () => {
    expect(shouldImport(row({ bnc: '800' }))).toBe(true)
  })
  it('柯林斯星级非零则导入', () => {
    expect(shouldImport(row({ collins: '3' }))).toBe(true)
  })
  it('牛津核心词则导入', () => {
    expect(shouldImport(row({ oxford: '1' }))).toBe(true)
  })
  it('带考试标签则导入', () => {
    expect(shouldImport(row({ tag: 'cet4 ky' }))).toBe(true)
  })
  it('所有指标为空则跳过', () => {
    expect(shouldImport(row())).toBe(false)
  })
  it('所有指标为零则跳过', () => {
    expect(shouldImport(row({ frq: '0', bnc: '0', collins: '0', oxford: '0' })))
      .toBe(false)
  })
  it('空 word 一律跳过', () => {
    expect(shouldImport(row({ word: '', frq: '1200' }))).toBe(false)
  })
  it('纯空白 word 一律跳过', () => {
    expect(shouldImport(row({ word: '   ', frq: '1200' }))).toBe(false)
  })
  it('非数字字段按 0 处理', () => {
    expect(shouldImport(row({ frq: 'NULL', bnc: 'abc' }))).toBe(false)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -- src/lib/dict/filter.test.ts
```

预期：FAIL，`Failed to resolve import "./filter"`

- [ ] **Step 4: 实现**

创建 `src/lib/dict/filter.ts`：

```ts
import type { EcdictRow } from './types'

function toInt(v: string): number {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * 判断一条 ECDICT 记录是否进入高频子集。
 * 保留满足任一条件者：进入词频榜、柯林斯星级词、牛津核心词、带考试标签。
 * 其余生僻词由在线词典 API 与 LLM 兜底，不入库。
 */
export function shouldImport(row: EcdictRow): boolean {
  if (!row.word || !row.word.trim()) return false
  return (
    toInt(row.frq) > 0 ||
    toInt(row.bnc) > 0 ||
    toInt(row.collins) > 0 ||
    toInt(row.oxford) > 0 ||
    row.tag.trim() !== ''
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -- src/lib/dict/filter.test.ts
```

预期：10 个测试全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/dict/types.ts src/lib/dict/filter.ts src/lib/dict/filter.test.ts
git commit -m "feat: 词典层共享类型与 ECDICT 行过滤器"
```

---

### Task 6: exchange 字段解析

ECDICT 的 `exchange` 字段编码了词形变化，格式为 `键:值` 以 `/` 分隔。键的含义：

| 键 | 含义 | 方向 |
|---|---|---|
| `p` | 过去式 | 值是 word 的变形 |
| `d` | 过去分词 | 值是 word 的变形 |
| `i` | 现在分词 | 值是 word 的变形 |
| `3` | 第三人称单数 | 值是 word 的变形 |
| `s` | 复数 | 值是 word 的变形 |
| `r` | 比较级 | 值是 word 的变形 |
| `t` | 最高级 | 值是 word 的变形 |
| `0` | 该词的原型 | **word 是值的变形**（方向相反） |
| `1` | 变形类型说明 | 忽略 |

**Files:**
- Create: `src/lib/dict/exchange.ts`
- Test: `src/lib/dict/exchange.test.ts`

**Interfaces:**
- Consumes: `LemmaPair`（Task 5 的 `types.ts`）
- Produces: `parseExchange(word: string, exchange: string): LemmaPair[]` —— Task 8 的导入脚本用它构建 `dict_lemma` 表

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/dict/exchange.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseExchange } from './exchange'

describe('parseExchange', () => {
  it('把各种变形映射回原型', () => {
    const pairs = parseExchange('say', 'p:said/d:said/i:saying/3:says')
    expect(pairs).toEqual(
      expect.arrayContaining([
        { form: 'said', lemma: 'say' },
        { form: 'saying', lemma: 'say' },
        { form: 'says', lemma: 'say' },
      ]),
    )
  })

  it('去重重复的变形', () => {
    const pairs = parseExchange('say', 'p:said/d:said')
    expect(pairs).toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('键 0 表示方向相反：word 本身是变形', () => {
    expect(parseExchange('said', '0:say/1:p'))
      .toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('忽略键 1', () => {
    const pairs = parseExchange('said', '0:say/1:p')
    expect(pairs.some((p) => p.lemma === 'p')).toBe(false)
  })

  it('处理比较级与最高级', () => {
    expect(parseExchange('good', 'r:better/t:best')).toEqual(
      expect.arrayContaining([
        { form: 'better', lemma: 'good' },
        { form: 'best', lemma: 'good' },
      ]),
    )
  })

  it('统一小写', () => {
    expect(parseExchange('Say', 'p:Said')).toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('跳过与原词相同的映射', () => {
    expect(parseExchange('cut', 'p:cut/d:cut')).toEqual([])
  })

  it('空 exchange 返回空数组', () => {
    expect(parseExchange('word', '')).toEqual([])
  })

  it('忽略没有冒号的片段', () => {
    expect(parseExchange('say', 'garbage/p:said'))
      .toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('忽略值为空的片段', () => {
    expect(parseExchange('say', 'p:/d:said'))
      .toEqual([{ form: 'said', lemma: 'say' }])
  })

  it('忽略未知的键', () => {
    expect(parseExchange('say', 'z:whatever')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/dict/exchange.test.ts
```

预期：FAIL，`Failed to resolve import "./exchange"`

- [ ] **Step 3: 实现**

创建 `src/lib/dict/exchange.ts`：

```ts
import type { LemmaPair } from './types'

/** 这些键的值是 word 的变形形式 */
const FORM_KEYS = new Set(['p', 'd', 'i', '3', 's', 'r', 't'])

/**
 * 把 ECDICT 的 exchange 字段展开为 (词形 → 原型) 映射对。
 * 键 `0` 方向相反：此时 word 自身是变形，值才是原型。
 * 键 `1` 只是变形类型说明，忽略。
 */
export function parseExchange(word: string, exchange: string): LemmaPair[] {
  if (!exchange) return []
  const base = word.trim().toLowerCase()
  if (!base) return []

  const out = new Map<string, LemmaPair>()
  for (const part of exchange.split('/')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim().toLowerCase()
    if (!val) continue

    if (FORM_KEYS.has(key)) {
      if (val !== base) out.set(`${val}|${base}`, { form: val, lemma: base })
    } else if (key === '0') {
      if (val !== base) out.set(`${base}|${val}`, { form: base, lemma: val })
    }
  }
  return [...out.values()]
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/dict/exchange.test.ts
```

预期：11 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dict/exchange.ts src/lib/dict/exchange.test.ts
git commit -m "feat: ECDICT exchange 字段解析为词形映射"
```

---

### Task 7: 中文释义解析

ECDICT 的 `translation` 字段是多行文本，每行形如 `n. 苹果, 苹果树`。CSV 中换行被转义为字面的两字符序列 `\n`，需同时兼容真实换行与字面 `\n`。

**Files:**
- Create: `src/lib/dict/senses.ts`
- Test: `src/lib/dict/senses.test.ts`

**Interfaces:**
- Consumes: `Sense`（Task 5 的 `types.ts`）
- Produces: `parseTranslation(translation: string | null): Sense[]` —— Task 11 的 `lookupWord` 与 Plan 2 的难词卡片依赖

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/dict/senses.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseTranslation } from './senses'

describe('parseTranslation', () => {
  it('按真实换行拆分并提取词性', () => {
    expect(parseTranslation('n. 苹果\nvt. 吃苹果')).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'vt.', meaning: '吃苹果' },
    ])
  })

  it('兼容字面的反斜杠 n', () => {
    expect(parseTranslation('n. 苹果\\nvt. 吃苹果')).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'vt.', meaning: '吃苹果' },
    ])
  })

  it('无词性前缀时 pos 为空串', () => {
    expect(parseTranslation('一个没有词性的释义')).toEqual([
      { pos: '', meaning: '一个没有词性的释义' },
    ])
  })

  it('保留释义中的逗号分隔项', () => {
    expect(parseTranslation('n. 手, 帮助, 指针')).toEqual([
      { pos: 'n.', meaning: '手, 帮助, 指针' },
    ])
  })

  it('丢弃空行', () => {
    expect(parseTranslation('n. 苹果\n\n\nvt. 吃')).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'vt.', meaning: '吃' },
    ])
  })

  it('去除每行首尾空白', () => {
    expect(parseTranslation('  n.   苹果   ')).toEqual([
      { pos: 'n.', meaning: '苹果' },
    ])
  })

  it('null 返回空数组', () => {
    expect(parseTranslation(null)).toEqual([])
  })

  it('空串返回空数组', () => {
    expect(parseTranslation('')).toEqual([])
  })

  it('不把中文开头误判为词性', () => {
    expect(parseTranslation('苹果. 一种水果')).toEqual([
      { pos: '', meaning: '苹果. 一种水果' },
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/dict/senses.test.ts
```

预期：FAIL，`Failed to resolve import "./senses"`

- [ ] **Step 3: 实现**

创建 `src/lib/dict/senses.ts`：

```ts
import type { Sense } from './types'

/** 行首的词性标记，如 'n.' 'vt.' 'adj.'；只匹配 ASCII 字母 */
const POS_PREFIX_RE = /^([a-z]+\.)\s*(.+)$/i

/**
 * 把 ECDICT 的 translation 字段解析为分词性的释义列表。
 * CSV 中换行被转义为字面的 `\n`，此处同时兼容两种形式。
 */
export function parseTranslation(translation: string | null): Sense[] {
  if (!translation) return []
  return translation
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = POS_PREFIX_RE.exec(line)
      return m
        ? { pos: m[1].toLowerCase(), meaning: m[2].trim() }
        : { pos: '', meaning: line }
    })
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/dict/senses.test.ts
```

预期：9 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dict/senses.ts src/lib/dict/senses.test.ts
git commit -m "feat: ECDICT 中文释义解析为分词性列表"
```

---

### Task 8: ECDICT 导入脚本与实际导入

**Files:**
- Create: `scripts/import-ecdict.ts`
- Modify: `package.json`（追加 `import:ecdict` 脚本）
- Modify: `docs/infra/hardening.md`（追加导入统计结果）

**Interfaces:**
- Consumes: `shouldImport`（Task 5）、`parseExchange`（Task 6）、`createAdminSupabase`（Task 4）
- Produces: 填充完毕的 `dict_entries` 与 `dict_lemma` 两张表

- [ ] **Step 1: 下载 ECDICT 数据**

```bash
mkdir -p data
curl -L -o data/ecdict.zip \
  https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-csv-28.zip
unzip -o data/ecdict.zip -d data/
ls -lh data/stardict.csv
```

预期：`data/stardict.csv` 存在，约 700MB。

若下载链接失效，去 https://github.com/skywind3000/ECDICT/releases 找最新的 CSV 包，解压后确保得到 `data/stardict.csv`。

验证表头：

```bash
head -1 data/stardict.csv
```

预期包含这些列名：`word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio`

- [ ] **Step 2: 安装 CSV 解析依赖**

```bash
npm install -D csv-parse tsx dotenv
```

在 `package.json` 的 `scripts` 中加入：

```json
"import:ecdict": "tsx scripts/import-ecdict.ts"
```

- [ ] **Step 3: 编写导入脚本**

创建 `scripts/import-ecdict.ts`：

```ts
import 'dotenv/config'
import fs from 'node:fs'
import { parse } from 'csv-parse'
import { createAdminSupabase } from '../src/lib/dict/../supabase/admin'
import { shouldImport } from '../src/lib/dict/filter'
import { parseExchange } from '../src/lib/dict/exchange'
import type { EcdictRow, LemmaPair } from '../src/lib/dict/types'

const CSV_PATH = 'data/stardict.csv'
const BATCH = 1000

function toIntOrNull(v: string): number | null {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

async function main() {
  const db = createAdminSupabase()

  let total = 0
  let kept = 0
  let entryBatch: Record<string, unknown>[] = []
  let lemmaBatch = new Map<string, LemmaPair>()

  async function flushEntries() {
    if (entryBatch.length === 0) return
    const { error } = await db.from('dict_entries').insert(entryBatch)
    if (error) throw new Error(`dict_entries 写入失败: ${error.message}`)
    entryBatch = []
  }

  async function flushLemmas() {
    if (lemmaBatch.size === 0) return
    const { error } = await db
      .from('dict_lemma')
      .upsert([...lemmaBatch.values()], { onConflict: 'form,lemma' })
    if (error) throw new Error(`dict_lemma 写入失败: ${error.message}`)
    lemmaBatch = new Map()
  }

  const parser = fs.createReadStream(CSV_PATH).pipe(
    parse({ columns: true, skip_empty_lines: true, relax_quotes: true }),
  )

  for await (const raw of parser) {
    total++
    const row = raw as EcdictRow
    if (!shouldImport(row)) continue
    kept++

    entryBatch.push({
      word: row.word.trim(),
      phonetic: row.phonetic || null,
      translation: row.translation || null,
      definition: row.definition || null,
      pos: row.pos || null,
      collins: toIntOrNull(row.collins),
      oxford: toIntOrNull(row.oxford),
      tag: row.tag || null,
      bnc: toIntOrNull(row.bnc),
      frq: toIntOrNull(row.frq),
      exchange: row.exchange || null,
    })

    for (const pair of parseExchange(row.word, row.exchange)) {
      lemmaBatch.set(`${pair.form}|${pair.lemma}`, pair)
    }

    if (entryBatch.length >= BATCH) await flushEntries()
    if (lemmaBatch.size >= BATCH) await flushLemmas()
    if (kept % 10000 === 0) {
      console.log(`已扫描 ${total}，已导入 ${kept}`)
    }
  }

  await flushEntries()
  await flushLemmas()

  console.log('---')
  console.log(`扫描总行数: ${total}`)
  console.log(`导入条数:   ${kept}`)
  console.log(`过滤比例:   ${((1 - kept / total) * 100).toFixed(1)}%`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 4: 小批量试跑**

先只跑前 5 万行验证脚本正确性：

```bash
head -50000 data/stardict.csv > data/stardict-sample.csv
```

临时把脚本里的 `CSV_PATH` 改为 `data/stardict-sample.csv`，运行：

```bash
npm run import:ecdict
```

预期：无报错，输出统计行。

在 Supabase SQL Editor 中抽查：

```sql
select word, phonetic, translation, frq, tag from dict_entries limit 5;
select * from dict_lemma limit 5;
```

预期：`translation` 含中文，`dict_lemma` 有词形映射。

确认无误后清空并把 `CSV_PATH` 改回 `data/stardict.csv`：

```sql
truncate dict_entries, dict_lemma;
```

- [ ] **Step 5: 全量导入**

```bash
npm run import:ecdict
```

预计耗时数十分钟。记录最终输出的三行统计。

- [ ] **Step 6: 验证体积（spec 第 14 节的风险项）**

在 Supabase SQL Editor 中运行：

```sql
select
  (select count(*) from dict_entries) as entries,
  (select count(*) from dict_lemma)   as lemmas,
  pg_size_pretty(pg_total_relation_size('dict_entries')) as entries_size,
  pg_size_pretty(pg_total_relation_size('dict_lemma'))   as lemma_size;
```

预期：`entries` 在 6–10 万之间，两表合计远小于 500MB。

**若合计超过 300MB**，说明过滤门槛过松。处理方式：在 `shouldImport` 中把 `toInt(row.frq) > 0` 改为 `toInt(row.frq) > 0 && toInt(row.frq) < 50000`，同步更新 `filter.test.ts`，`truncate` 后重跑。

- [ ] **Step 7: 验证词形还原可用**

```sql
select * from dict_lemma where form in ('said', 'running', 'better', 'studies');
```

预期：至少能查到 `said → say`、`better → good`。若某些形式缺失，属正常（ECDICT 的 exchange 字段本身不完整），Task 9 的后缀规则会兜底。

- [ ] **Step 8: 记录结果**

在 `docs/infra/hardening.md` 末尾追加一节「ECDICT 导入结果」，写入 Step 5 的统计输出与 Step 6 的体积查询结果。

- [ ] **Step 9: Commit**

```bash
git add scripts/import-ecdict.ts package.json package-lock.json docs/infra/hardening.md
git commit -m "feat: ECDICT 导入脚本与高频子集导入"
```

---

### Task 9: 后缀剥离候选生成

`dict_lemma` 覆盖不全时的第三级兜底。给定一个词，生成它可能的原型候选，交给调用方批量查库。

**Files:**
- Create: `src/lib/dict/inflect.ts`
- Test: `src/lib/dict/inflect.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `stripSuffixCandidates(word: string): string[]` —— 返回去重后的候选原型（不含原词本身），顺序不保证。Task 11 的 `lookupWord` 依赖。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/dict/inflect.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { stripSuffixCandidates } from './inflect'

describe('stripSuffixCandidates', () => {
  it('双写辅音的现在分词还原', () => {
    expect(stripSuffixCandidates('running')).toContain('run')
  })
  it('普通现在分词还原', () => {
    expect(stripSuffixCandidates('working')).toContain('work')
  })
  it('去 e 的现在分词还原', () => {
    expect(stripSuffixCandidates('making')).toContain('make')
  })
  it('ies 复数还原', () => {
    expect(stripSuffixCandidates('studies')).toContain('study')
  })
  it('es 复数还原', () => {
    expect(stripSuffixCandidates('boxes')).toContain('box')
  })
  it('s 复数还原', () => {
    expect(stripSuffixCandidates('cats')).toContain('cat')
  })
  it('过去式还原', () => {
    expect(stripSuffixCandidates('worked')).toContain('work')
  })
  it('去 e 的过去式还原', () => {
    expect(stripSuffixCandidates('loved')).toContain('love')
  })
  it('ily 副词还原为 y 结尾', () => {
    expect(stripSuffixCandidates('happily')).toContain('happy')
  })
  it('ly 副词还原', () => {
    expect(stripSuffixCandidates('quickly')).toContain('quick')
  })
  it('比较级还原', () => {
    expect(stripSuffixCandidates('smaller')).toContain('small')
  })
  it('最高级还原', () => {
    expect(stripSuffixCandidates('smallest')).toContain('small')
  })
  it('不把 ss 结尾误判为复数', () => {
    expect(stripSuffixCandidates('glass')).not.toContain('glas')
  })
  it('太短的词不处理', () => {
    expect(stripSuffixCandidates('is')).toEqual([])
  })
  it('结果不含原词本身', () => {
    expect(stripSuffixCandidates('running')).not.toContain('running')
  })
  it('结果去重', () => {
    const out = stripSuffixCandidates('studies')
    expect(out.length).toBe(new Set(out).size)
  })
  it('大写输入按小写处理', () => {
    expect(stripSuffixCandidates('Running')).toContain('run')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/dict/inflect.test.ts
```

预期：FAIL，`Failed to resolve import "./inflect"`

- [ ] **Step 3: 实现**

创建 `src/lib/dict/inflect.ts`：

```ts
/**
 * 生成一个词可能的原型候选，供 dict_lemma 未命中时批量查库。
 * 宁可多给候选也不要漏 —— 调用方会用一次 IN 查询筛掉不存在的。
 * 返回结果不含原词本身。
 */
export function stripSuffixCandidates(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>()
  const add = (s: string) => {
    if (s.length >= 2 && s !== w) out.add(s)
  }

  if (w.endsWith('ies') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es') && w.length > 3) add(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) add(w.slice(0, -1))

  if (w.endsWith('ed') && w.length > 4) {
    add(w.slice(0, -2))       // worked → work
    add(w.slice(0, -1))       // loved  → love
  }

  if (w.endsWith('ing') && w.length > 5) {
    const b = w.slice(0, -3)
    add(b)                    // working → work
    add(b + 'e')              // making  → make
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) {
      add(b.slice(0, -1))     // running → run
    }
  }

  if (w.endsWith('ily') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ly') && w.length > 4) add(w.slice(0, -2))

  if (w.endsWith('est') && w.length > 5) {
    add(w.slice(0, -3))
    add(w.slice(0, -3) + 'e')
  }
  if (w.endsWith('er') && w.length > 4) {
    add(w.slice(0, -2))
    add(w.slice(0, -1))
  }

  return [...out]
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/dict/inflect.test.ts
```

预期：17 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dict/inflect.ts src/lib/dict/inflect.test.ts
git commit -m "feat: 后缀剥离规则生成原型候选"
```

---

### Task 10: dictionaryapi.dev 响应解析

dictionaryapi.dev 的响应形如：

```json
[{
  "word": "hello",
  "phonetics": [
    { "text": "/həˈləʊ/", "audio": "https://.../hello-uk.mp3" },
    { "text": "/həˈloʊ/", "audio": "https://.../hello-us.mp3" }
  ]
}]
```

美/英区分靠音频文件名中的 `-us.` / `-uk.` 后缀。数据源是 Wiktionary，质量参差 —— **不是每个词都能分出美英**，解析器必须优雅降级而不是编造。

**Files:**
- Create: `src/lib/dict/dictapi.ts`
- Test: `src/lib/dict/dictapi.test.ts`

**Interfaces:**
- Consumes: `PhoneticSet`（Task 5 的 `types.ts`）
- Produces:
  - `parseDictApi(json: unknown): PhoneticSet` —— 纯函数，可单测
  - `getPhonetics(admin: SupabaseClient, wordKey: string): Promise<PhoneticSet>` —— 带 `dict_cache` 读写的取数函数，Task 11 依赖

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/dict/dictapi.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseDictApi } from './dictapi'

describe('parseDictApi', () => {
  it('按音频文件名区分美英', () => {
    const json = [{
      phonetics: [
        { text: '/həˈləʊ/', audio: 'https://x/hello-uk.mp3' },
        { text: '/həˈloʊ/', audio: 'https://x/hello-us.mp3' },
      ],
    }]
    expect(parseDictApi(json)).toEqual({
      phoneticUs: '/həˈloʊ/',
      phoneticUk: '/həˈləʊ/',
      audioUs: 'https://x/hello-us.mp3',
      audioUk: 'https://x/hello-uk.mp3',
    })
  })

  it('只有无标记音标时，美英同时回退到它', () => {
    const json = [{ phonetics: [{ text: '/wɜːd/', audio: '' }] }]
    expect(parseDictApi(json)).toEqual({
      phoneticUs: '/wɜːd/',
      phoneticUk: '/wɜːd/',
      audioUs: null,
      audioUk: null,
    })
  })

  it('只有美音时英音回退到无标记音标', () => {
    const json = [{
      phonetics: [
        { text: '/fɔːlbæk/', audio: '' },
        { text: '/ˈjuːɛs/', audio: 'https://x/w-us.mp3' },
      ],
    }]
    const r = parseDictApi(json)
    expect(r.phoneticUs).toBe('/ˈjuːɛs/')
    expect(r.audioUs).toBe('https://x/w-us.mp3')
    expect(r.phoneticUk).toBe('/fɔːlbæk/')
    expect(r.audioUk).toBeNull()
  })

  it('有音频无文本时不编造音标', () => {
    const json = [{ phonetics: [{ text: '', audio: 'https://x/w-us.mp3' }] }]
    const r = parseDictApi(json)
    expect(r.audioUs).toBe('https://x/w-us.mp3')
    expect(r.phoneticUs).toBeNull()
  })

  it('取每个方言的第一个音标，忽略后续', () => {
    const json = [{
      phonetics: [
        { text: '/first/', audio: 'https://x/a-us.mp3' },
        { text: '/second/', audio: 'https://x/b-us.mp3' },
      ],
    }]
    const r = parseDictApi(json)
    expect(r.phoneticUs).toBe('/first/')
    expect(r.audioUs).toBe('https://x/a-us.mp3')
  })

  it('跨多个词条合并', () => {
    const json = [
      { phonetics: [{ text: '/uk/', audio: 'https://x/a-uk.mp3' }] },
      { phonetics: [{ text: '/us/', audio: 'https://x/a-us.mp3' }] },
    ]
    const r = parseDictApi(json)
    expect(r.phoneticUk).toBe('/uk/')
    expect(r.phoneticUs).toBe('/us/')
  })

  it('空数组返回全 null', () => {
    expect(parseDictApi([])).toEqual({
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  })

  it('非数组输入返回全 null', () => {
    expect(parseDictApi({ title: 'No Definitions Found' })).toEqual({
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  })

  it('缺少 phonetics 字段不抛异常', () => {
    expect(() => parseDictApi([{ word: 'x' }])).not.toThrow()
  })

  it('phonetics 非数组不抛异常', () => {
    expect(() => parseDictApi([{ phonetics: 'oops' }])).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/dict/dictapi.test.ts
```

预期：FAIL，`Failed to resolve import "./dictapi"`

- [ ] **Step 3: 实现**

创建 `src/lib/dict/dictapi.ts`：

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhoneticSet } from './types'

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en'
const FETCH_TIMEOUT_MS = 3000
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000

const EMPTY: PhoneticSet = {
  phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
}

/**
 * 解析 dictionaryapi.dev 响应，按音频文件名的 -us. / -uk. 后缀区分方言。
 * 数据源为 Wiktionary，覆盖不全时优雅降级 —— 绝不编造音标。
 */
export function parseDictApi(json: unknown): PhoneticSet {
  if (!Array.isArray(json) || json.length === 0) return { ...EMPTY }

  const result: PhoneticSet = { ...EMPTY }
  let fallbackText: string | null = null

  for (const entry of json) {
    const phonetics = (entry as { phonetics?: unknown })?.phonetics
    if (!Array.isArray(phonetics)) continue

    for (const p of phonetics) {
      const rec = p as { text?: unknown; audio?: unknown }
      const text = typeof rec.text === 'string' && rec.text ? rec.text : null
      const audio = typeof rec.audio === 'string' ? rec.audio : ''

      if (audio.includes('-us.')) {
        if (result.audioUs === null) result.audioUs = audio
        if (result.phoneticUs === null && text) result.phoneticUs = text
      } else if (audio.includes('-uk.')) {
        if (result.audioUk === null) result.audioUk = audio
        if (result.phoneticUk === null && text) result.phoneticUk = text
      } else if (text && fallbackText === null) {
        fallbackText = text
      }
    }
  }

  if (result.phoneticUs === null) result.phoneticUs = fallbackText
  if (result.phoneticUk === null) result.phoneticUk = fallbackText
  return result
}

/**
 * 取音标，优先读 dict_cache。
 *
 * 缓存策略上区分两种失败：
 * - API 明确返回 404（词不存在）→ 写 found=false 负缓存，避免反复空请求
 * - 网络错误 / 超时 → 不写缓存，下次重试
 */
export async function getPhonetics(
  admin: SupabaseClient,
  wordKey: string,
): Promise<PhoneticSet> {
  const { data: cached } = await admin
    .from('dict_cache')
    .select('*')
    .eq('word_key', wordKey)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      if (!cached.found) return { ...EMPTY }
      return {
        phoneticUs: cached.phonetic_us as string | null,
        phoneticUk: cached.phonetic_uk as string | null,
        audioUs: cached.audio_us as string | null,
        audioUk: cached.audio_uk as string | null,
      }
    }
  }

  let json: unknown
  let notFound = false
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(wordKey)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 404) {
      notFound = true
    } else if (!res.ok) {
      return { ...EMPTY }   // 5xx 等临时故障，不写缓存
    } else {
      json = await res.json()
    }
  } catch {
    return { ...EMPTY }     // 网络错误或超时，不写缓存
  }

  const parsed = notFound ? { ...EMPTY } : parseDictApi(json)

  await admin.from('dict_cache').upsert({
    word_key: wordKey,
    phonetic_us: parsed.phoneticUs,
    phonetic_uk: parsed.phoneticUk,
    audio_us: parsed.audioUs,
    audio_uk: parsed.audioUk,
    found: !notFound,
    fetched_at: new Date().toISOString(),
  })

  return parsed
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/dict/dictapi.test.ts
```

预期：10 个测试全部 PASS

- [ ] **Step 5: 抽样验证美英覆盖率（spec 第 14 节的风险项）**

创建临时脚本 `scripts/check-phonetic-coverage.ts`：

```ts
import { parseDictApi } from '../src/lib/dict/dictapi'

const WORDS = `the be to of and a in that have it for not on with he as you do at
this but his by from they we say her she or an will my one all would there their
what so up out if about who get which go me when make can like time no just him
know take people into year your good some could them see other than then now look
only come its over think also back after use two how our work first well way even
new want because any these give day most us schedule tomato advertisement either
neither privacy vitamin leisure route herb`.split(/\s+/)

let us = 0, uk = 0, both = 0, none = 0
for (const w of WORDS) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`)
  if (!res.ok) { none++; continue }
  const p = parseDictApi(await res.json())
  const hasUs = p.audioUs !== null
  const hasUk = p.audioUk !== null
  if (hasUs) us++
  if (hasUk) uk++
  if (hasUs && hasUk) both++
  if (!hasUs && !hasUk) none++
  await new Promise((r) => setTimeout(r, 200))
}
console.log(`总数 ${WORDS.length} / 有美音 ${us} / 有英音 ${uk} / 美英俱全 ${both} / 都没有 ${none}`)
```

运行 `npx tsx scripts/check-phonetic-coverage.ts`，把结果记入 `docs/infra/hardening.md` 的「音标覆盖率抽样」一节，然后删除该临时脚本。

**判定标准**：若「美英俱全」低于 40%，说明大部分词只能显示单一音标。这不阻塞交付（UI 已设计为有几个显示几个），但需在文档中如实记录，避免后续误以为是 bug。

- [ ] **Step 6: Commit**

```bash
git add src/lib/dict/dictapi.ts src/lib/dict/dictapi.test.ts docs/infra/hardening.md
git commit -m "feat: dictionaryapi.dev 音标解析与缓存获取"
```

---

### Task 11: 四级降级查询链路

**Files:**
- Create: `src/lib/dict/lookup.ts`
- Test: `src/lib/dict/lookup.test.ts`

**Interfaces:**
- Consumes: `normalizeWord`（Task 2）、`parseTranslation`（Task 7）、`stripSuffixCandidates`（Task 9）、`getPhonetics`（Task 10）、`WordDetail` / `MatchSource`（Task 5）
- Produces: `lookupWord(admin: SupabaseClient, raw: string): Promise<WordDetail>` —— Task 12 的接口与 Plan 2 的难词卡片依赖

查询顺序（任一级命中即停）：

1. `word_key` 精确命中 `dict_entries` → `matchedFrom: 'exact'`
2. 查 `dict_lemma` 得原型，再查 `dict_entries` → `'lemma'`
3. `stripSuffixCandidates` 批量查 `dict_entries` → `'suffix'`
4. 全部未命中 → `'none'`，`senses` 为空数组

无论哪一级命中（含未命中），都会调用 `getPhonetics` 补充美/英音标。

- [ ] **Step 1: 写失败的测试**

本任务的测试用 mock 的 Supabase 客户端，不连真实数据库。

创建 `src/lib/dict/lookup.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupWord } from './lookup'

vi.mock('./dictapi', () => ({
  getPhonetics: vi.fn(async () => ({
    phoneticUs: '/us/', phoneticUk: '/uk/',
    audioUs: 'a-us.mp3', audioUk: 'a-uk.mp3',
  })),
}))

type EntryRow = {
  word: string; phonetic: string | null; translation: string | null
  collins: number | null; oxford: number | null; tag: string | null
}

/**
 * 构造一个只支持本模块所用查询形态的假客户端。
 * entries 按 word_key 索引，lemmas 是 form → lemma 列表。
 */
function fakeDb(entries: Record<string, EntryRow>, lemmas: Record<string, string[]>) {
  return {
    from(table: string) {
      if (table === 'dict_entries') {
        return {
          select: () => ({
            in: (_col: string, keys: string[]) => Promise.resolve({
              data: keys.map((k) => entries[k]).filter(Boolean), error: null,
            }),
          }),
        }
      }
      if (table === 'dict_lemma') {
        return {
          select: () => ({
            eq: (_col: string, form: string) => Promise.resolve({
              data: (lemmas[form] ?? []).map((lemma) => ({ lemma })), error: null,
            }),
          }),
        }
      }
      throw new Error(`未预期的表: ${table}`)
    },
  } as unknown as SupabaseClient
}

const APPLE: EntryRow = {
  word: 'apple', phonetic: '/ˈæpl/', translation: 'n. 苹果\nn. 苹果树',
  collins: 5, oxford: 1, tag: 'zk gk cet4',
}
const SAY: EntryRow = {
  word: 'say', phonetic: '/seɪ/', translation: 'vt. 说', collins: 5,
  oxford: 1, tag: 'zk',
}
const RUN: EntryRow = {
  word: 'run', phonetic: '/rʌn/', translation: 'vi. 跑', collins: 5,
  oxford: 1, tag: '',
}

describe('lookupWord', () => {
  it('第一级：精确命中', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    const r = await lookupWord(db, 'apple')
    expect(r.matchedFrom).toBe('exact')
    expect(r.word).toBe('apple')
    expect(r.senses).toEqual([
      { pos: 'n.', meaning: '苹果' },
      { pos: 'n.', meaning: '苹果树' },
    ])
  })

  it('精确命中前先规范化输入', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    const r = await lookupWord(db, '  Apple!  ')
    expect(r.matchedFrom).toBe('exact')
    expect(r.query).toBe('  Apple!  ')
  })

  it('第二级：经 dict_lemma 命中原型', async () => {
    const db = fakeDb({ say: SAY }, { said: ['say'] })
    const r = await lookupWord(db, 'said')
    expect(r.matchedFrom).toBe('lemma')
    expect(r.word).toBe('say')
  })

  it('第三级：后缀规则兜底', async () => {
    const db = fakeDb({ run: RUN }, {})
    const r = await lookupWord(db, 'running')
    expect(r.matchedFrom).toBe('suffix')
    expect(r.word).toBe('run')
  })

  it('第四级：全部未命中', async () => {
    const db = fakeDb({}, {})
    const r = await lookupWord(db, 'zzzznotaword')
    expect(r.matchedFrom).toBe('none')
    expect(r.senses).toEqual([])
    expect(r.phonetic).toBeNull()
  })

  it('未命中时仍返回在线音标', async () => {
    const db = fakeDb({}, {})
    const r = await lookupWord(db, 'zzzznotaword')
    expect(r.phoneticUs).toBe('/us/')
    expect(r.phoneticUk).toBe('/uk/')
  })

  it('把 tag 拆成数组', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    const r = await lookupWord(db, 'apple')
    expect(r.tags).toEqual(['zk', 'gk', 'cet4'])
  })

  it('tag 为空串时 tags 为空数组', async () => {
    const db = fakeDb({ run: RUN }, {})
    const r = await lookupWord(db, 'run')
    expect(r.tags).toEqual([])
  })

  it('oxford 转为布尔', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    expect((await lookupWord(db, 'apple')).oxford).toBe(true)
  })

  it('保留 ECDICT 单一音标作为保底', async () => {
    const db = fakeDb({ apple: APPLE }, {})
    expect((await lookupWord(db, 'apple')).phonetic).toBe('/ˈæpl/')
  })

  it('空输入直接返回未命中，不查库', async () => {
    const db = fakeDb({}, {})
    const r = await lookupWord(db, '!!!')
    expect(r.matchedFrom).toBe('none')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/lib/dict/lookup.test.ts
```

预期：FAIL，`Failed to resolve import "./lookup"`

- [ ] **Step 3: 实现**

创建 `src/lib/dict/lookup.ts`：

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWord } from '@/lib/text/normalize'
import { parseTranslation } from './senses'
import { stripSuffixCandidates } from './inflect'
import { getPhonetics } from './dictapi'
import type { MatchSource, WordDetail } from './types'

const ENTRY_COLUMNS = 'word, phonetic, translation, collins, oxford, tag'

interface EntryRow {
  word: string
  phonetic: string | null
  translation: string | null
  collins: number | null
  oxford: number | null
  tag: string | null
}

async function findEntries(
  db: SupabaseClient, keys: string[],
): Promise<EntryRow[]> {
  if (keys.length === 0) return []
  const { data } = await db.from('dict_entries').select(ENTRY_COLUMNS).in('word_key', keys)
  return (data ?? []) as unknown as EntryRow[]
}

async function findLemmas(db: SupabaseClient, form: string): Promise<string[]> {
  const { data } = await db.from('dict_lemma').select('lemma').eq('form', form)
  return ((data ?? []) as { lemma: string }[]).map((r) => r.lemma)
}

function build(
  query: string, key: string, entry: EntryRow | null,
  matchedFrom: MatchSource, phonetics: Awaited<ReturnType<typeof getPhonetics>>,
): WordDetail {
  return {
    query,
    word: entry?.word ?? key,
    matchedFrom,
    phonetic: entry?.phonetic ?? null,
    phoneticUs: phonetics.phoneticUs,
    phoneticUk: phonetics.phoneticUk,
    audioUs: phonetics.audioUs,
    audioUk: phonetics.audioUk,
    senses: parseTranslation(entry?.translation ?? null),
    tags: (entry?.tag ?? '').split(/\s+/).filter(Boolean),
    collins: entry?.collins ?? null,
    oxford: (entry?.oxford ?? 0) > 0,
  }
}

/**
 * 四级降级查询：精确 → 词形还原 → 后缀规则 → 未命中。
 * 任一级命中即停；无论结果如何都会补充在线音标。
 */
export async function lookupWord(
  db: SupabaseClient, raw: string,
): Promise<WordDetail> {
  const key = normalizeWord(raw)
  if (!key) {
    // 空键不查库也不调在线 API —— 否则会往 dict_cache 写一条 word_key='' 的垃圾负缓存
    return build(raw, '', null, 'none', {
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  }

  // 第一级：精确命中
  const exact = await findEntries(db, [key])
  if (exact.length > 0) {
    return build(raw, key, exact[0], 'exact', await getPhonetics(db, key))
  }

  // 第二级：dict_lemma 词形还原
  const lemmas = await findLemmas(db, key)
  if (lemmas.length > 0) {
    const viaLemma = await findEntries(db, lemmas)
    if (viaLemma.length > 0) {
      const hit = viaLemma[0]
      return build(raw, hit.word, hit, 'lemma', await getPhonetics(db, hit.word))
    }
  }

  // 第三级：后缀规则兜底
  const candidates = stripSuffixCandidates(key)
  const viaSuffix = await findEntries(db, candidates)
  if (viaSuffix.length > 0) {
    const hit = viaSuffix[0]
    return build(raw, hit.word, hit, 'suffix', await getPhonetics(db, hit.word))
  }

  // 第四级：未命中，仍返回在线音标
  return build(raw, key, null, 'none', await getPhonetics(db, key))
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/lib/dict/lookup.test.ts
```

预期：11 个测试全部 PASS

- [ ] **Step 5: 运行完整测试套件**

```bash
npm test
```

预期：Task 2、5、6、7、9、10、11 的全部测试通过，共 72 个。

- [ ] **Step 6: Commit**

```bash
git add src/lib/dict/lookup.ts src/lib/dict/lookup.test.ts
git commit -m "feat: 词典四级降级查询链路"
```

---

### Task 12: 单词查询接口

**Files:**
- Create: `src/app/api/word/[word]/route.ts`

**Interfaces:**
- Consumes: `createServerSupabase` / `createAdminSupabase`（Task 4）、`lookupWord`（Task 11）
- Produces: `GET /api/word/:word` → `200` 返回 `WordDetail` JSON；`401` 未登录；`400` 参数为空

注意：Next.js 15 中动态路由的 `params` 是 Promise，必须 `await`。

- [ ] **Step 1: 实现路由**

创建 `src/app/api/word/[word]/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { lookupWord } from '@/lib/dict/lookup'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  const auth = await createServerSupabase()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const { word } = await params
  const decoded = decodeURIComponent(word ?? '').trim()
  if (!decoded) {
    return NextResponse.json({ error: '缺少查询词' }, { status: 400 })
  }

  // 用 admin 客户端是因为需要写 dict_cache（RLS 只允许登录用户读）
  const db = createAdminSupabase()
  const detail = await lookupWord(db, decoded)
  return NextResponse.json(detail)
}
```

- [ ] **Step 2: 手动验证已登录路径**

```bash
npm run dev
```

在浏览器中先登录，然后依次访问，检查返回：

| URL | 预期 |
|---|---|
| `/api/word/apple` | `matchedFrom: "exact"`，`senses` 非空，`tags` 含 `cet4` |
| `/api/word/said` | `matchedFrom: "lemma"`，`word: "say"` |
| `/api/word/running` | `matchedFrom` 为 `lemma` 或 `suffix`，`word: "run"` |
| `/api/word/zzzznotaword` | `matchedFrom: "none"`，`senses: []`，HTTP 仍为 200 |
| `/api/word/Apple!` | 与 `apple` 结果一致 |

- [ ] **Step 3: 验证未登录被拒**

在无痕窗口中访问 `http://localhost:3000/api/word/apple`

预期：HTTP 401，body 为 `{"error":"未登录"}`

- [ ] **Step 4: 验证缓存已写入**

首次查询某个之前没查过的词（例如 `/api/word/serendipity`）之后，在 Supabase SQL Editor 中运行：

```sql
select word_key, phonetic_us, phonetic_uk, audio_us, found, fetched_at
from dict_cache order by fetched_at desc limit 5;
```

预期：能看到刚查过的词，`found` 为 `true`。再查一次同一个词，`fetched_at` 应保持不变（走了缓存）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/word
git commit -m "feat: 单词查询接口"
```

---

### Task 13: 单词详情卡片与主页

Plan 1 的主页只做单词查询。输入段落时提示「段落翻译将在下一阶段提供」—— 这是本计划范围的诚实边界，不做假实现。

**Files:**
- Create: `src/components/WordCard.tsx`
- Modify: `src/app/page.tsx`（替换 create-next-app 默认内容）

**Interfaces:**
- Consumes: `WordDetail`（Task 5）、`isSingleWord`（Task 2）、`GET /api/word/:word`（Task 12）
- Produces: `<WordCard detail={...} />` —— Plan 2 的划词浮层与难词明细复用该组件

- [ ] **Step 1: 实现单词卡片组件**

创建 `src/components/WordCard.tsx`：

```tsx
'use client'

import type { WordDetail } from '@/lib/dict/types'

function Pronunciation({
  label, phonetic, audio,
}: { label: string; phonetic: string | null; audio: string | null }) {
  if (!phonetic && !audio) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-neutral-500">{label}</span>
      {phonetic && <span className="font-mono text-sm">{phonetic}</span>}
      {audio && (
        <button
          type="button"
          aria-label={`播放${label}发音`}
          onClick={() => void new Audio(audio).play()}
          className="text-neutral-500 hover:text-black"
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

  return (
    <article className="rounded-lg border p-5">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="text-3xl font-semibold">{detail.word}</h2>
        {detail.matchedFrom === 'lemma' || detail.matchedFrom === 'suffix' ? (
          <span className="text-xs text-neutral-500">
            由「{detail.query.trim()}」还原
          </span>
        ) : null}
      </header>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {bothSame ? (
          <Pronunciation label="" phonetic={detail.phoneticUs} audio={detail.audioUs ?? detail.audioUk} />
        ) : (
          <>
            <Pronunciation label="美" phonetic={detail.phoneticUs} audio={detail.audioUs} />
            <Pronunciation label="英" phonetic={detail.phoneticUk} audio={detail.audioUk} />
          </>
        )}
        {/* 在线音标全缺失时，回落到 ECDICT 的单一音标 */}
        {!detail.phoneticUs && !detail.phoneticUk && detail.phonetic && (
          <span className="font-mono text-sm">{detail.phonetic}</span>
        )}
      </div>

      {(detail.tags.length > 0 || detail.oxford || detail.collins) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {detail.oxford && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">牛津核心</span>
          )}
          {detail.collins ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
              柯林斯 {'★'.repeat(detail.collins)}
            </span>
          ) : null}
          {detail.tags.map((t) => (
            <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs uppercase">
              {t}
            </span>
          ))}
        </div>
      )}

      {detail.senses.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {detail.senses.map((s, i) => (
            <li key={i} className="flex gap-2">
              {s.pos && (
                <span className="w-12 shrink-0 font-mono text-sm text-neutral-500">
                  {s.pos}
                </span>
              )}
              <span>{s.meaning}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-neutral-500">
          词典中未收录该词。
        </p>
      )}
    </article>
  )
}
```

- [ ] **Step 2: 实现主页**

替换 `src/app/page.tsx` 的全部内容：

```tsx
'use client'

import { useState } from 'react'
import { isSingleWord } from '@/lib/text/normalize'
import { WordCard } from '@/components/WordCard'
import type { WordDetail } from '@/lib/dict/types'

export default function HomePage() {
  const [input, setInput] = useState('')
  const [detail, setDetail] = useState<WordDetail | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const text = input.trim()
    if (!text) return

    setDetail(null)
    setNotice(null)

    if (!isSingleWord(text)) {
      setNotice('段落翻译将在下一阶段提供，当前仅支持查询单个英文单词。')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/word/${encodeURIComponent(text)}`)
      if (!res.ok) {
        setNotice(res.status === 401 ? '登录已过期，请重新登录。' : '查询失败，请重试。')
        return
      }
      setDetail((await res.json()) as WordDetail)
    } catch {
      setNotice('网络错误，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">翻译 · 单词本</h1>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        rows={4}
        placeholder="输入单词…"
        className="w-full rounded border p-3"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="self-end rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? '查询中…' : '查询  ⌘↵'}
      </button>

      {notice && <p className="text-sm text-neutral-600">{notice}</p>}
      {detail && <WordCard detail={detail} />}
    </main>
  )
}
```

- [ ] **Step 3: 手动验证**

```bash
npm run dev
```

逐项检查：

1. 输入 `apple` → 显示音标、标签（牛津核心 / CET4 等）、多条分词性释义
2. 点击 🔊 → 有发音（若该词有音频）
3. 输入 `said` → 显示 `say`，并标注「由「said」还原」
4. 输入 `running` → 显示 `run`
5. 输入 `zzzznotaword` → 显示「词典中未收录该词」，页面不崩
6. 输入 `hello world` → 提示「段落翻译将在下一阶段提供」
7. 输入框中按 `⌘↵` → 触发查询
8. 输入 `Apple!` → 与 `apple` 结果相同

- [ ] **Step 4: 构建检查**

```bash
npm run build
```

预期：构建成功，无 TypeScript 错误、无 ESLint 错误。

- [ ] **Step 5: 运行完整测试套件**

```bash
npm test
```

预期：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/WordCard.tsx src/app/page.tsx
git commit -m "feat: 单词详情卡片与主页查询界面"
```

---

## Plan 1 完成标准

全部 13 个任务完成后，应当满足：

- [ ] `47.117.245.194:1434` 从公网**不可访问**
- [ ] `https://ollama.<域名>/api/chat` 需 Bearer token，其余路径返回 404
- [ ] `docs/infra/hardening.md` 记录了 ollama 已装模型与翻译质量基线
- [ ] `npm test` 全部通过
- [ ] `npm run build` 无错误
- [ ] 登录后能查询单词，看到音标、标签与分词性释义
- [ ] 未登录访问 `/` 跳转 `/login`，访问 `/api/*` 返回 401
- [ ] `dict_entries` 与 `dict_lemma` 已填充，合计体积远小于 500MB

## 移交给 Plan 2 的产物

| 产物 | 位置 |
|---|---|
| ollama HTTPS 端点 + token | `.env.local` 的 `OLLAMA_BASE_URL` / `OLLAMA_TOKEN` / `OLLAMA_MODEL` |
| 配额 RPC | `increment_usage(p_user, p_limit)` |
| 输入类型判定 | `isSingleWord()` |
| 词典查询 | `lookupWord()` |
| 释义解析 | `parseTranslation()` |
| 词形还原 | `stripSuffixCandidates()`、`dict_lemma` 表 |
| 词频与难度数据 | `dict_entries` 的 `frq` / `bnc` / `collins` / `oxford` 列 |
| 单词卡片组件 | `<WordCard />` |
| 空的 `wordbook` 表 | 供难词拆解做个性化过滤（Plan 3 才有写入） |

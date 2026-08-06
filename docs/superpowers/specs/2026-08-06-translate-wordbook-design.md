# 翻译 + 单词本服务 设计文档

日期：2026-08-06
状态：已确认，待编写实施计划

---

## 1. 目标

一个中英互译工具，翻译结果直接沉淀为个人单词本，并支持复习。

核心能力：

1. **翻译**：中↔英双向，输入框自动识别"单个单词"还是"一段文本"
2. **单词详解**：美/英音标、发音音频、按词性分组的多条中文释义、考试标签
3. **段落难词拆解**：自动从段落中挑出对当前用户而言的难词，逐个给出释义
4. **划词查询**：在原文或译文中选中任意英文单词，弹出词详情
5. **单词本**：收藏、查看、搜索、筛选、移除
6. **复习**：顺序或随机翻卡，标记"认识 / 不认识"
7. **多用户**：注册登录，数据按用户隔离

### 1.1 非目标（第一版明确排除）

- 中英之外的语言对
- 间隔重复算法（SM-2）——只预留数据字段，不实现调度逻辑
- 翻译历史记录
- 游客免登录试用
- 跨设备的用户偏好同步（偏好存 localStorage）

---

## 2. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 + 服务端 | Next.js (App Router) @ Vercel | 原生支持，DX 最好，零配置部署 |
| 数据库 + 认证 | Supabase (Postgres + Auth + RLS) | 自带多用户认证与行级安全，省掉整个 auth 层 |
| 翻译主力 | 本机 ollama，经 frpc 隧道暴露 | 零成本，利用现有算力 |
| 翻译兜底 | 任意 OpenAI 兼容接口 | `base_url` / `model` / `api_key` 全部环境变量化，换供应商不改代码 |
| 词典数据 | ECDICT 高频子集，导入 Supabase | 确定性数据，零延迟零成本，不依赖 LLM |
| 音标补全 | dictionaryapi.dev + 数据库缓存 | 免费、无需 key，提供美/英分离音标与发音音频 |

---

## 3. 架构

```
浏览器 (Next.js App Router @ Vercel)
   │  Supabase Auth (JWT 存 cookie)
   ▼
Next.js Route Handlers (Node runtime)
   │
   ├──► Supabase Postgres (RLS)
   │      ├─ dict_entries    ECDICT 子集，全局只读
   │      ├─ dict_lemma      词形 → 原型索引
   │      ├─ dict_cache      在线词典 API 结果缓存
   │      ├─ wordbook        用户收藏
   │      └─ usage_counter   每日配额
   │
   └──► TranslationProvider（抽象接口）
          ├─ OllamaProvider ─┐
          └─ CloudProvider   │
                             ▼
        HTTPS → Caddy@VPS → frps@VPS(127.0.0.1:1434)
                             → frpc@家 → ollama(127.0.0.1:11434)
```

**核心解耦原则：词典层与 LLM 层完全独立。LLM 全部不可用时，单词查询、单词本、复习功能必须照常工作。**

---

## 4. 基础设施与安全

### 4.1 现状与问题

VPS：`47.117.245.194`。家中 frpc 已配置：

```toml
[[proxies]]
name = "ollama-serve"
type = "tcp"
localIP = "127.0.0.1"
localPort = 11434
remotePort = 1434
```

**已验证的安全缺陷**：`47.117.245.194:1434` 当前对公网开放（TCP 握手成功，当时 frpc 未连接故无 HTTP 响应）。一旦 frpc 连上且 ollama 运行，任何人可调用 `/api/delete` 删除模型、`/api/pull` 塞满硬盘、以及无限制占用 GPU。端口 1434 是 MS-SQL 常见端口，被扫描概率高。

### 4.2 加固方案

家中 frpc 配置**保持不变**，全部改动在 VPS 上。

**第 1 层 · 把 1434 收回内网**

`frps.toml` 增加：

```toml
proxyBindAddr = "127.0.0.1"
```

此项为全局设置。若 VPS 上还有其他 frp 代理需要公网直连，改用按端口封禁：

```bash
ufw deny 1434/tcp
# 或: iptables -A INPUT -p tcp --dport 1434 -j DROP
```

**第 2 层 · Caddy 做 TLS + 鉴权 + 路径白名单**

```caddyfile
ollama.<域名>.com {
    @allowed {
        path /api/chat
        method POST
        header Authorization "Bearer <长随机密钥>"
    }
    handle @allowed {
        reverse_proxy 127.0.0.1:1434 {
            flush_interval -1
        }
    }
    handle {
        respond 404
    }
}
```

- Let's Encrypt 证书由 Caddy 自动签发与续期
- `flush_interval -1` 关闭响应缓冲，否则流式输出会被攒着一次性返回
- 仅放行 `POST /api/chat`；`/api/delete`、`/api/pull`、`/api/create`、`/api/tags` 一律 404。即使密钥泄露，最坏后果也只是被白嫖推理

**第 3 层 · Vercel 侧**

`OLLAMA_BASE_URL`、`OLLAMA_TOKEN`、`OLLAMA_MODEL` 存于 Vercel 环境变量，仅在 Route Handler 中读取，绝不下发至浏览器。

### 4.3 环境变量清单

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      # 仅服务端，用于写 dict_cache

OLLAMA_BASE_URL                # https://ollama.<域名>.com
OLLAMA_TOKEN
OLLAMA_MODEL

CLOUD_BASE_URL                 # OpenAI 兼容端点
CLOUD_API_KEY
CLOUD_MODEL

DAILY_QUOTA                    # 默认 200
```

---

## 5. 数据模型

### 5.1 词典层（全局共享，只读）

```sql
create table dict_entries (
  id          bigserial primary key,
  word        text not null,
  word_key    text generated always as (lower(word)) stored,
  phonetic    text,
  translation text,          -- 中文释义（ECDICT，含换行分隔的多义）
  definition  text,          -- 英文释义
  pos         text,          -- 词性占比
  collins     smallint,      -- 柯林斯星级 1-5
  oxford      smallint,      -- 是否牛津核心 3000
  tag         text,          -- zk/gk/cet4/cet6/ky/toefl/ielts/gre
  bnc         integer,       -- BNC 词频排名
  frq         integer,       -- 当代语料词频排名
  exchange    text           -- 词形变化编码
);
create index on dict_entries (word_key);

create table dict_lemma (
  form  text not null,
  lemma text not null,
  primary key (form, lemma)   -- 一个词形可能对应多个原型，如 saw → see / saw
);
create index on dict_lemma (form);

create table dict_cache (
  word_key     text primary key,
  phonetic_us  text,
  phonetic_uk  text,
  audio_us     text,
  audio_uk     text,
  found        boolean not null,   -- false 即负缓存
  fetched_at   timestamptz not null default now()
);
```

RLS：三张表对 `authenticated` 角色开放 `SELECT`；写入仅通过 `service_role`。

### 5.2 用户层

```sql
create table wordbook (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  word             text not null,      -- 存原型（lemma）
  word_key         text not null,
  source_context   text,               -- 收藏时所在的原句，复习时展示
  note             text,               -- 用户笔记
  review_count     int not null default 0,
  familiarity      smallint not null default 0,   -- 0-5
  last_reviewed_at timestamptz,
  -- 以下为 SM-2 预留字段，第一版不参与逻辑
  due_at           timestamptz,
  ease_factor      real not null default 2.5,
  interval_days    int not null default 0,
  created_at       timestamptz not null default now(),
  unique (user_id, word_key)
);

create table usage_counter (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int not null default 0,
  primary key (user_id, day)
);
```

RLS：两张表全部操作均以 `auth.uid() = user_id` 为条件。

---

## 6. 词典层设计

### 6.1 ECDICT 导入策略

ECDICT 全量 340 万词条，加索引后超过 Supabase 免费版 500MB 限额。因此只导入高频子集，保留满足**任一**条件的词条：

- `frq > 0` 或 `bnc > 0`（进入词频榜）
- `collins > 0`（柯林斯星级词）
- `oxford = 1`（牛津核心 3000）
- `tag` 非空（各类考试词表）

预估 6–10 万条，数十 MB。导入脚本需输出实际条数与占用体积；若超出预期则提高词频门槛。

被过滤掉的生僻词与专业术语，由"在线词典 API → LLM"链路兜底，不影响可用性。

### 6.2 词形还原

导入时展开 `exchange` 字段（`p:` 过去式 `d:` 过去分词 `i:` 现在分词 `3:` 三单 `s:` 复数 `r:` 比较级 `t:` 最高级 `0:` 原型）生成 `dict_lemma` 表。

查询链路：

```
1. word_key 精确命中 dict_entries          → 返回
2. miss → 查 dict_lemma 得原型 → 重查      → 返回
3. miss → 规则兜底（剥 -s/-es/-ed/-ing/-ly）→ 重查 → 返回
4. miss → 调 dictionaryapi.dev             → 返回
5. miss → 交给 LLM 生成释义（不生成音标）   → 返回
```

### 6.3 难词判定（纯 SQL，零 LLM）

段落模式下的难词提取全程不调用 LLM：

1. 正则切词 `[a-zA-Z][a-zA-Z'-]*`，小写化，去停用词
2. 批量词形还原（单次 `IN` 查询覆盖全部候选词）
3. 打分：
   - 词频排名（`frq` / `bnc`）越靠后，得分越高
   - **完全不在词库中的词得分最高**（生僻/专业词）
   - 非 `oxford` 核心词加权
4. 个性化调整：
   - 已在用户 `wordbook` 且 `familiarity >= 4` → 排除
   - 已收藏但 `familiarity < 4` → 提权靠前
5. 取 Top N（默认 12），按在原文中出现的先后顺序排列

难词列表随用户单词本增长自动适应其水平，且此过程零成本。

### 6.4 音标与发音

ECDICT 仅有单一 `phonetic` 字段，无法区分美/英。叠加 dictionaryapi.dev：

- 首次查询某词时异步拉取，写入 `dict_cache`，TTL 90 天
- 查不到也写入 `found = false` 的负缓存，避免重复空请求

**降级链**：dictionaryapi.dev 的美/英音标 → 其单一音标 → ECDICT `phonetic` → 不显示。

任何情况下都**不得让 LLM 生成音标**——LLM 生成 IPA 的幻觉率高，且错误音标一旦被背下来难以纠正。

---

## 7. 翻译层设计

### 7.1 Provider 抽象

```ts
interface TranslationProvider {
  name: 'ollama' | 'cloud'
  translate(req: TranslateRequest): AsyncIterable<string>
}
```

两个实现共用同一套 prompt 与输出契约。调度器负责选择与降级。

### 7.2 熔断与降级

- 进程内维护 ollama 健康状态：连续失败次数、熔断截止时间
- **首字节超时 5 秒**（不是总超时——流式响应总时长不可控，但隧道是否连通在首字节即可判定）
- 首字节超时或连接失败 → 立即切换 CloudProvider，用户无感知
- **连续失败 3 次 → 熔断 5 分钟**，期间直连云端不再试探；熔断期满后下一次请求恢复试探 ollama
- 响应头返回 `X-Provider: ollama | cloud`，前端角落显示小标记，便于排查

注：Vercel 无状态函数实例间不共享熔断状态，各实例独立维护。这是可接受的——最坏情况是每个新实例多试探一次。

### 7.3 输入类型判定

去除首尾空白后匹配 `^[a-zA-Z][a-zA-Z'-]*$` → 单词模式；否则文本模式。前端不提供模式开关。

### 7.4 Prompt 契约

| 场景 | 输出要求 |
|---|---|
| 段落翻译 | 仅输出译文，不加解释、不加标记 |
| 单词兜底（词库未命中） | JSON：`{ senses: [{ pos, meaning }] }`，不含音标字段 |
| 上下文释义（按需触发） | 一句话说明该词在给定句子中的具体含义 |

### 7.5 LLM 调用次数控制

段落模式下，难词卡片**直接展示词典释义**（瞬时返回，不等 LLM）。仅当用户点开某个词查看明细时，才发起一次上下文释义请求。

因此：**段落模式的 LLM 调用次数恒为 1（整段翻译），不随难词数量增长。**

---

## 8. API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/translate` | SSE 流式。body `{ text, direction }`。返回 `X-Provider` 头 |
| GET | `/api/word/[word]` | 词详情（词典层 + dict_cache），不调 LLM |
| POST | `/api/hard-words` | 段落难词提取。body `{ text }`。纯数据库查询，不调 LLM，不消耗配额 |
| POST | `/api/word/explain` | 上下文释义。body `{ word, context }`，调 LLM |
| GET | `/api/wordbook` | 列表，支持搜索与标签筛选 |
| POST | `/api/wordbook` | 收藏。body `{ word, source_context }` |
| DELETE | `/api/wordbook/[id]` | 移除 |
| POST | `/api/review/mark` | 标记。body `{ id, known: boolean }`。`review_count += 1`，`last_reviewed_at = now()`，`familiarity` 按 `known ? min(5, f+1) : max(0, f-1)` 调整 |

所有接口要求登录。`/api/translate` 与 `/api/word/explain` 额外检查每日配额。

---

## 9. 页面与交互

### 9.1 `/` 主页

```
┌─────────────────────────────────────────┐
│  英 → 中  [⇄]              👤  单词本    │
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │ 输入单词或段落…                    │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│                       [翻译] ⌘↵          │
├─────────────────────────────────────────┤
│  结果区（随输入类型切换形态）             │
└─────────────────────────────────────────┘
```

- **单词模式结果**：大字单词 / 美 🔊 `/ˈwɜːrd/` · 英 🔊 `/wɜːd/` / 按词性分组的中文释义（多义全列）/ 考试标签 / ☆ 收藏按钮
- **段落模式结果**：上方译文流式逐字显示；下方难词卡片网格立即显示（词典层，不等 LLM）。点击卡片展开明细，此时才触发上下文释义请求
- **划词**：在原文或译文中选中单个英文单词 → 浮层词卡 → 可直接收藏

方向切换为 `中→英` / `英→中` 两态按钮，偏好存 localStorage。

### 9.2 `/wordbook` 单词本

列表展示：单词 + 音标 + 释义摘要 + 收藏时间。支持关键词搜索、按考试标签筛选、移除、进入复习。

### 9.3 `/review` 复习

选择顺序或随机 → 卡片正面仅显示单词与音标 → 空格或点击翻面，背面显示释义与 `source_context` 原句 → 「认识 / 不认识」按钮更新记录并进入下一张 → 顶部显示进度 `7/20` → 结束页给出本轮统计。

### 9.4 `/login`

Supabase Auth 邮箱注册登录。

---

## 10. 容错策略

| 故障 | 行为 |
|---|---|
| ollama 首字节 5s 超时 / 连接失败 | 静默切云端，角落显示 `cloud` 标记 |
| ollama 连续失败 3 次 | 熔断 5 分钟，期间直连云端 |
| 云端亦失败 | 明确报错 + 重试按钮；**单词模式下词典结果照常显示** |
| dictionaryapi.dev 失败/超时 | 降级至 ECDICT 单音标，不显示美/英区分 |
| 流式传输中断 | 保留已收到文本 + 提示"响应中断" |
| 超出每日配额 | 提示剩余额度与重置时间 |
| 未登录访问受保护页面 | 跳转 `/login` |

---

## 11. 滥用防护

翻译接口背后是自有 GPU 与云端 API 额度，必须防止被脚本刷。

方案：**登录后方可使用** + 每用户每日配额（`DAILY_QUOTA`，默认 200 次）。`usage_counter` 按 `(user_id, day)` 原子 upsert 递增，超额返回明确提示。

第一版不做 IP 维度限流，因为不开放游客访问。

---

## 12. 测试策略

- **纯函数单元测试**（覆盖重点）：分词、词形还原链路、难词打分与排序、输入类型判定
- **Provider 集成测试**：mock ollama 的超时、连接拒绝、中途断流三种失败，验证熔断与切换行为
- **词典查询链路测试**：跑在测试库上，覆盖精确命中 / 词形还原 / 规则兜底 / 彻底 miss 四条分支
- **E2E（Playwright）**：登录 → 翻译段落 → 划词 → 收藏 → 单词本 → 完成一轮复习

---

## 13. 实施顺序

1. **基础设施加固**（最优先，因为是正在生效的安全问题）：frps 收回内网、Caddy 配置、验证 ollama 端到端可达
2. 项目脚手架 + Supabase 项目 + Auth 登录流程
3. ECDICT 导入脚本 + `dict_lemma` 构建 + 实测体积
4. 词典查询链路 + 单词详情卡片 UI
5. Provider 抽象 + 熔断 + `/api/translate` 流式接口
6. 段落模式 + 难词拆解 + 划词
7. 单词本 CRUD
8. 复习页
9. 配额 + 容错打磨
10. E2E 测试

---

## 14. 待验证的风险

| 风险 | 验证方式 | 时机 |
|---|---|---|
| 本机 ollama 模型的中英翻译质量未知（探测时服务不可达，未能确认已安装模型） | 隧道打通后，用一组固定测试句对比 ollama 与云端输出 | 第 1 步之后 |
| ECDICT 子集实际体积可能超预期 | 导入脚本输出条数与体积统计 | 第 3 步 |
| dictionaryapi.dev 的美/英音标覆盖率未知 | 抽样 200 个常用词统计命中率 | 第 4 步 |
| 家宽上行带宽与单机推理并发能力 | 多用户并发下的实测延迟 | 第 5 步之后 |

上述任一风险若不达标，降级路径均已在设计中就位（云端兜底、提高词频门槛、音标降级链），不会阻塞交付。

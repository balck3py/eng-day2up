## Context

- 现有网页版（Next.js 16 + Supabase，部署在 Vercel）已实现查词、段落翻译、难词拆解、单词本、复习、历史。网页是主要工作区，手机上也用。
- 单一用户使用；工作机为 Windows：浏览器 Edge、Markdown 用 VS Code、Office 网页版与桌面版并用。
- 数据库：`wordbook(user_id, word, word_key, source_context, …, unique(user_id, word_key))`，RLS 以 `auth.uid() = user_id` 隔离；`dict_entries` / `dict_lemma` / `dict_cache` 对 `authenticated` 只读。**本次不改任何表结构。**
- 现状缺陷：三处收藏入口把整段原文作为 `sourceContext`，服务端 `slice(0, 500)` 从开头截断，长段落中靠后的词所在句子会丢失。
- 约束：
  - 客户端与网页**代码完全解耦**，只共享数据库；网页改动最小化。
  - 测试写库只用 E2E 专用测试账号，绝不触碰个人主账号数据。
  - 设计与基础工作在 macOS 完成，Windows 专属部分在 Windows 机器上接着做。

## Goals / Non-Goals

**Goals:**
- 在 Edge、VS Code、Word 桌面版、Word 网页版中，「选中 + 快捷键」即可查词/翻译，并一键收藏到同一个单词本。
- 收藏时自动带上该词所在句子；网页端行为同步修正。
- 平时零干扰：不按快捷键就不存在。
- 低资源、稳定：空闲时只有一个轻量 Rust 进程。

**Non-Goals:**
- 多例句 / 表结构变更。
- 第三方插件渲染的文档（Canvas、扩展页）。
- AI 释义回写词库、配额计数（单用户，且需要 service_role）。
- macOS / Linux 客户端（Tauri 可跨平台，但选区读取只实现 Windows）。
- 离线词库。
- 自动更新、代码签名。

## Decisions

### D1 桌面框架：Tauri v2
- **选择**：Tauri v2（Rust 主进程 + 系统 WebView2 渲染界面）。
- **理由**：
  - 主进程原生且轻量，空闲时只有托盘 + 快捷键。
  - Windows 11 自带 WebView2，安装包只有几 MB。
  - 全局快捷键、托盘、单实例、开机自启、HTTP 都有官方插件。
  - Rust 的 `windows` crate 能直接调用 UI Automation 与剪贴板 API。
- **备选**：
  - Electron：自带 Chromium，常驻内存数百 MB，否决。
  - C# WPF：UIA 生态更成熟，但界面要整体重写，且与网页的 React/Tailwind 技能栈分裂，否决。
  - 加载网页 `/popup` 页面（原方案 A）：违反解耦约束，否决。

### D2 客户端直连 Supabase，与网页零代码依赖
- **选择**：客户端前端（`desktop/src/`）用 `@supabase/supabase-js`，以登录用户身份直连 Supabase。
- **配置方式**：在设置页填写 Supabase URL 与 anon key，再用现有账号的邮箱 + 密码登录一次。session 由 supabase-js 持久化在 WebView2 用户数据目录里，之后自动刷新。
- **理由**：
  - 网页无需新增任何 API、CORS 或鉴权路径。
  - RLS 已足以保证只能读写自己的 `wordbook`。
  - 客户端功能演进不会波及网页。
- **代价**：需要的逻辑复制一份到客户端，不抽共享包；两边行为一致靠同一份测试向量保证（见 D9）。涉及的逻辑有：
  - `normalizeWord` / `isSingleWord`
  - `stripSuffixCandidates`
  - `parseTranslation`
  - 查词降级链
  - 分词与难词打分
  - 切句
- **安全**：客户端里绝不出现 service_role key。anon key 本身是公开值。

### D3 选区读取：UIA 优先，剪贴板兜底，绝不改动原程序选区
流程（Rust，在专用 COM 线程上执行，整体超时 800ms）：

1. 快捷键触发时，记录前台窗口 HWND 与鼠标位置。
2. **UIA**：`GetFocusedElement`，向上查找支持 `TextPattern` 的元素，然后：
   - 用 `GetSelection()` 取第一个非空 range，得到选中文本。
   - 克隆这个 range，调用 `ExpandToEnclosingUnit(Paragraph)`，得到段落文本。
   - 构造一个从段落起点到选区起点的 range，其文本长度就是选中文本在段落内的偏移。
   - 选区的屏幕矩形取自 `GetBoundingRectangles`，用于定位弹窗。
3. **剪贴板兜底**（UIA 不可用、超时或取到空文本时）：
   - 等待快捷键的修饰键全部松开（最多 500ms）。
   - 快照剪贴板全部格式。
   - 用 `SendInput` 模拟 Ctrl+C，等待 `GetClipboardSequenceNumber` 变化（最多 300ms），读取 Unicode 文本。
   - **无论成功与否，都把快照恢复回剪贴板。**
   - 这条路径只能拿到选中文本，没有段落。
4. 都失败时，在弹窗里提示「未读取到选中内容」，不做其他事。

- **明确不做**：模拟 Shift+方向键等方式扩选段落。这会改动用户的选区和光标，违背「不打扰」原则。
- **备选**：
  - 只用剪贴板：没有段落上下文。
  - 只用 UIA：VS Code 等程序可能读不到。
  - 两者结合是覆盖面与质量的最佳折中。

### D4 句子由前端切，Rust 只负责交付「段落 + 偏移」
- Rust 向前端发出 `selection` 事件：`{ text, paragraph: string | null, offset: number | null, rect, source: 'uia' | 'clipboard' }`。
- 切句、500 字裁剪等规则在 TypeScript 中实现（规则见 `context-sentence` spec），和网页的实现一致，测试也可在 macOS 上跑。
- 没有段落时（剪贴板路径）：
  - 选中的是单个词：上下文为空，收藏时 `source_context = null`。
  - 选中的是一句或一段：选中文本本身就是上下文来源。在文本模式下点难词收藏时，取该难词在选中文本里所在的句子。

### D5 弹窗生命周期与焦点
- 主窗口不预创建。首次触发时创建弹窗 WebView，之后关闭只是**隐藏**，闲置达到 `idleDestroyMinutes`（默认 10 分钟）后**销毁**，释放 WebView2 进程内存。下次触发时重建，冷启动预计 < 1s，Windows 实测后确认。
- 弹窗定位：优先放在 UIA 选区矩形下方，否则放在鼠标位置附近。要夹在当前显示器的工作区内，并处理多显示器与 DPI 缩放。
- 弹窗需要取得焦点，才能响应 Esc 和点击。以下三种情况会隐藏弹窗，并把焦点 `SetForegroundWindow` 还给 D3 记录的原窗口：
  - 按下 Esc
  - 点击弹窗外部（窗口失焦）
  - 再按一次快捷键
- 弹窗不出现在任务栏，置顶，无标题栏。

### D6 全局快捷键
- 用 `tauri-plugin-global-shortcut`，默认 `Ctrl+Alt+Space`，可在设置中修改。
- 注册失败（被其他程序占用）时，在托盘气泡和设置页提示，不静默失败。
- 默认键在 Edge、VS Code、Word 中的冲突情况，在 Windows 实测阶段确认，有冲突就换默认值（见 Open Questions）。

### D7 翻译与 LLM 调用
- 客户端配置一个 OpenAI 兼容端点：`baseUrl`、`model`、可选的 `apiKey` 和自定义 prompt。可以指向家里的 ollama，也可以指向云端。
- 请求通过 `tauri-plugin-http` 发出，由 Rust 侧网络栈代发，绕开 WebView 的 CORS 与混合内容限制。返回流式结果。
- 兼容推理模型：忽略 `delta.reasoning_content`，只拼接 `delta.content`。
- 若端点指向 aiping.cn 的 `DeepSeek-V4-Flash`（与网页线上相同），请求应带 `thinking: { "type": "disabled" }`：实测不带时每句先输出 600–1300 字思考，首个译文字多等 1.4–5.7s（见 `translation-scheduling` spec 与归档 `2026-10-22-translate-latency`）。设置里提供开关，因为不认识该字段的严格端点会报 400。
- 不做多 provider 熔断（单端点、单用户），失败就显示错误 + 重试按钮。
- **单词模式不依赖 LLM**：词典查不到时，才可选地调用 LLM 生成释义仅作展示，不回写词库，并标注「AI 释义，未收录」。

### D8 查词、音标与发音
- 查词降级链与网页一致：精确匹配 → `dict_lemma` → 后缀规则 → 未命中。
- 能并行的查询必须并行（Supabase 在海外，一次往返约 350ms）。
- 音标：读 `dict_cache`（美/英），否则用 ECDICT 的 `phonetic`，都没有就不显示。客户端不调用 dictionaryapi.dev，也不写缓存。
- 发音：有道 TTS 音频 URL，失败时退回 Web Speech API。

### D9 两份实现的一致性：共享测试向量（复制，不引用）
- `context-sentence` 的测试用例写成同一份数据表，网页（`src/lib/text/sentence.test.ts`）与客户端（`desktop/src/lib/sentence.test.ts`）各放一份副本。
- 规则变更时，两边同步修改。
- 这是对「不共享代码」约束的有意妥协：只复制数据，不建立依赖。
- **阅读页（`web-reader`，已上线）先行用 `Intl.Segmenter` 实现了一份切句**：`src/lib/reader/sentence.ts`（`sentenceAt` / `sentenceContaining` / `sentencesCovering`）。它对缩写、小数的处理比本 spec 粗糙。`src/lib/text/sentence.ts` 落地后，阅读页 SHALL 改为调用它并删除 `src/lib/reader/sentence.ts`，保证网页只有一套切句行为（任务 1.6）。
- `HardWordGrid` 已有可选 `contextFor(hw)` prop（阅读页用来按词传所在句）。任务 1.4 在不传 `contextFor` 时才用 `sentenceOf(context, hw.surface)`，传了就以它为准。

### D10 收藏语义（与网页一致）
- 写入字段：
  - `word`：查词命中的原型
  - `word_key`：`normalizeWord(word)`
  - `source_context`：所在句子，≤ 500 字，可能为 null
- 先按 `word_key` 查询：已存在就直接显示「已在单词本」，**不覆盖既有 `source_context`**。
- 插入时如遇唯一约束冲突（`23505`），按已存在处理。
- 不使用 `upsert`，避免覆盖已有记录。

### D11 仓库隔离
- `desktop/` 是独立项目，有自己的 `package.json`、`tsconfig`、`vite`、`vitest` 和 `src-tauri/Cargo.toml`。
- 网页侧只追加忽略项，不改其他配置：
  - 根 `tsconfig.json` 的 `exclude` 加入 `desktop`。
  - `eslint.config.mjs` 的 `globalIgnores` 加入 `desktop/**`。
  - 新增 `.vercelignore` 排除 `desktop/`，避免 Vercel CLI 上传 Rust 构建产物。
- `vitest` 已只扫描 `src/**`，无需改动。

### D12 配置与敏感信息存储
- 非敏感配置存 `tauri-plugin-store`，位于 `%APPDATA%/<app>/settings.json`。包括 Supabase URL / anon key、LLM `baseUrl` / `model`、快捷键、闲置销毁分钟数、难词熟练度阈值。
- LLM `apiKey` 同样放在 store 里。单用户本机使用，不进仓库。
- Supabase session 由 supabase-js 存在 WebView2 的 localStorage 中，数据目录在弹窗销毁后仍然保留。
- 仓库只提供 `desktop/.env.example` 形式的字段说明，不提交任何真实值。

### D13 测试策略
- **纯逻辑（macOS 可跑）**，用 Vitest：
  - 切句
  - 规范化
  - 后缀候选
  - 释义解析
  - 分词与难词打分
  - 查词降级链（mock supabase client）
  - 收藏流程（mock：新建 / 已存在 / 23505）
  - SSE 行解析（含 reasoning 块与多字节截断）
- **Rust 单元测试**：只测与平台无关的部分，例如选区结果的合并与降级决策逻辑（把 UIA 和剪贴板的读取结果作为输入）。
- **集成测试（真实 Supabase，测试账号）**：
  - 读取 `.env.local` 中的 `E2E_EMAIL` / `E2E_PASSWORD` 登录，**登录后断言当前用户邮箱等于 `E2E_EMAIL`，不等就立即中止**。
  - 只插入以 `zzqa` 前缀构造的测试词，测试结束只删除这些行（按 `word_key` + 当前 user_id 限定）。
  - 默认跳过，需显式设置 `DESKTOP_IT=1` 才运行。
- **Windows 手工验收矩阵**：在 Edge 网页、VS Code Markdown、Word 桌面版、Word 网页版四处，分别验证以下项目，结果记入 `desktop/docs/windows-matrix.md`：
  - 单词能否读到
  - 段落能否读到
  - 剪贴板是否恢复
  - 焦点是否归还
  - 弹窗定位是否正确

### D14 macOS / Windows 分工
- **macOS（本次完成）**：
  - OpenSpec 设计
  - 网页切句改动 + 测试
  - `desktop/` 骨架，包括 Tauri 配置、前端界面、纯逻辑 + 测试、Supabase 与 LLM 客户端
  - Rust 侧的平台无关部分与 `cfg(windows)` 接口桩
- **Windows（后续会话）**：
  - UIA 与剪贴板的真实实现
  - 快捷键实测
  - 弹窗定位与焦点归还
  - 打包
  - 资源占用实测
  - 验收矩阵

## Risks / Trade-offs

- [VS Code（Electron/Monaco）的 UIA 可能只暴露可见行，或根本没有 TextPattern] → 退回剪贴板路径。选中单词时无上下文，用户可以选中整句后在难词列表里收藏。验收矩阵如实记录。
- [剪贴板快照恢复对延迟渲染格式、超大数据可能失败] → 快照失败时至少恢复 Unicode 文本，并在日志中记录。只在兜底路径触碰剪贴板。
- [UIA 在无响应的目标程序上阻塞] → 放在专用线程，带 800ms 超时；超时后放弃 UIA 走兜底，绝不阻塞快捷键线程。
- [WebView2 常驻内存较大] → 闲置后销毁弹窗窗口；Rust 主进程常驻。具体数字 Windows 实测后写入矩阵文档。
- [切句启发式误切（缩写、小数、省略号）] → 用缩写白名单 + 测试向量约束；误切的最坏结果只是上下文偏短或偏长，不影响收藏本身。
- [两份逻辑实现漂移] → 共享测试向量（D9）；客户端只复制必要子集。
- [anon key + 账号密码存在本机] → 密码不落盘，只保存 refresh token（supabase-js 默认行为）。单用户本机可接受。
- [`tauri-plugin-http` 流式响应能力与版本相关] → Windows 阶段第一步验证；不行就改为 Rust 命令通过事件逐块推送。
- [测试误触主账号数据] → 集成测试登录后强制校验邮箱，默认跳过，只删除自己插入的 `zzqa*` 行。

## Migration Plan

- 网页改动只涉及前端，部署方式不变（`npx vercel --prod --scope dennisliu2015fgmailcoms-projects`）。回滚 = revert 对应提交。
- 客户端：本地构建安装包，自行安装；卸载即回滚，数据库无残留变更。
- 无数据迁移；历史收藏的 `source_context` 保持原样，不回填。

## Open Questions

- 默认快捷键 `Ctrl+Alt+Space` 在 Edge、VS Code、Word（含中文输入法）下是否冲突？Windows 实测后定稿。
- VS Code 与 Word 网页版能否通过 UIA 拿到段落？以验收矩阵为准，结论只影响上下文是否可用，不影响主流程。
- 弹窗冷启动耗时与 WebView2 内存实测值，决定 `idleDestroyMinutes` 的默认值。

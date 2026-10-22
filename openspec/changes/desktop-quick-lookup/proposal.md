## Why

工作中大量英文内容分散在 Edge 网页、VS Code 里的 Markdown、Office（网页版与桌面版）中。遇到生词或长句时，现在只能复制 → 打开翻译站 → 粘贴 → 再手动收藏，既慢又打断思路；收藏时存下的上下文还是整段原文（并从开头截断到 500 字），长段落里靠后的词往往连所在句子都没存住，复习时帮助有限。

## What Changes

- **新增 Windows 桌面客户端**（`desktop/`，Tauri v2），后台常驻托盘：
  - 平时完全不介入：**只在「选中文本 + 按全局快捷键」时**才弹出，选中文本做其他用途时零干扰；不监听剪贴板、不在选区旁弹图标。
  - 读取当前任意程序的选中文本，优先用 UI Automation 同时拿到所在段落，失败时退回模拟 Ctrl+C（并恢复原剪贴板）。
  - 光标旁弹出小窗：单词 → 词典释义/音标/发音 + 收藏；句子/段落 → 流式译文 + 难词列表，点任一难词即收藏。
  - 收藏时把**该词所在的句子**写入 `wordbook.source_context`。
  - 客户端**直连 Supabase**（自己配置 URL / anon key，用现有账号登录一次），翻译直连客户端里配置的 OpenAI 兼容接口；**不调用网页的任何 API、不加载网页页面、不 import 网页代码**。
  - 资源与稳定性约束：弹窗窗口按需创建、闲置后销毁；选区读取在独立线程并带超时；单实例；可开机自启。
- **网页端最小改动**：三处收藏入口（翻译结果划词浮层、难词卡片、历史页挑词）的 `sourceContext` 由「整段原文截前 500 字」改为「该词所在的句子」。不改 API、不改表结构、不改页面结构。
- 不做：多例句、表结构变更、第三方插件渲染文档的支持、AI 释义回写词库（需要 service_role，不能进客户端）、多用户/注册。

## Capabilities

### New Capabilities

- `context-sentence`: 给定一段文本与选中位置（或一个目标词），确定其所在句子并裁剪到不超过 500 字的规则。网页与客户端各自实现一份，行为必须一致。
- `desktop-selection-capture`: 全局快捷键触发；读取前台程序选中文本与所在段落；剪贴板兜底与恢复；不打扰原则。
- `desktop-lookup-popup`: 弹窗的单词模式与文本模式、收藏（含上下文）、关闭与焦点归还。
- `desktop-client-shell`: 托盘常驻、设置（Supabase 连接、账号登录、LLM 接口、快捷键）、单实例、开机自启、资源占用策略、与网页代码的隔离边界。
- `web-favorite-context`: 网页端三处收藏入口写入「所在句子」作为 `source_context`。

### Modified Capabilities

（无。`openspec/specs/` 现有 `reader-document-loading`、`reader-selection-translate`、`translation-scheduling`，本变更不改变其中任何要求；阅读页改用 `context-sentence` 的实现属于同一要求下的实现替换，见 design D9。）

## Impact

- **新增目录** `desktop/`：独立的 Tauri v2 项目（Rust + Vite + React + TypeScript），独立 `package.json` / `Cargo.toml`，不进入网页的构建、lint、测试与 Vercel 部署。
- **网页代码**：新增 `src/lib/text/sentence.ts`（+ 测试）；修改 `src/components/SelectionPopover.tsx`、`src/components/HardWordGrid.tsx`、`src/components/HistoryWordPicker.tsx` 中传入的上下文。API、`supabase/migrations/`、表结构均不变。
- **数据库**：无 schema 变更。客户端以登录用户身份通过既有 RLS 读取 `dict_entries` / `dict_lemma` / `dict_cache` / `wordbook`，写入 `wordbook`。
- **测试数据**：涉及写库的测试只使用 `.env.local` 中的 E2E 专用测试账号，并在执行前校验登录身份；绝不读写个人主账号的数据。
- **开发环境**：网页改动与客户端纯逻辑可在 macOS 完成；UI Automation、全局快捷键、打包与资源实测必须在 Windows 上完成。

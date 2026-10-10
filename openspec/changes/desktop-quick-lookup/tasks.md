> 标注说明：**[mac]** 可在 macOS 完成并验证；**[win]** 必须在 Windows 上实现或验证。
> 写库测试只用 `E2E_EMAIL` 测试账号，登录后校验身份；绝不触碰个人主账号数据。

## 1. 网页：切句工具与三处收藏上下文 [mac]

- [ ] 1.1 编写切句测试向量 `src/lib/text/sentence.vectors.ts`（覆盖 context-sentence spec 全部场景：普通、换行、无标点、缩写、小数、首字母缩写、省略号、中文标点、词边界、找不到、超长截取）
- [ ] 1.2 TDD 实现 `src/lib/text/sentence.ts`：`sentenceAt(text, start, end)`、`sentenceOf(text, surface)`、500 字居中截取，`sentence.test.ts` 跑通全部向量
- [ ] 1.3 `SelectionPopover.tsx`：选中时从选区所在文本节点 + 偏移计算句子，传给 `WordCard` 的 `sourceContext`（保持组件对外 props 不变）
- [ ] 1.4 `HardWordGrid.tsx`：收藏时用 `sentenceOf(context, hw.surface)`，失败退回原值
- [ ] 1.5 `HistoryWordPicker.tsx`：每个候选用 `sentenceOf(text, c.surface)`，失败退回 `text.slice(0, 500)`
- [ ] 1.6 验证：`npm test`、`npm run lint`、`npm run build` 通过；`git diff --stat` 确认 `src/app/api/**`、`supabase/**` 无改动

## 2. 网页侧隔离配置 [mac]

- [ ] 2.1 根 `tsconfig.json` 的 `exclude` 加入 `desktop`；`eslint.config.mjs` 的 `globalIgnores` 加入 `desktop/**`；新增 `.vercelignore` 排除 `desktop/`
- [ ] 2.2 验证：放入 `desktop/` 骨架后再次运行网页 `npm run build` / `npm run lint` / `npm test`，结果不变

## 3. 客户端骨架 [mac]

- [ ] 3.1 在 `desktop/` 初始化 Tauri v2 + Vite + React + TypeScript + Tailwind v4 项目（独立 `package.json`、`tsconfig`、`vitest`、`src-tauri/`），`.gitignore` 排除 `src-tauri/target`、`node_modules`、`dist`
- [ ] 3.2 接入插件：`global-shortcut`、`single-instance`、`autostart`、`store`、`http`；`tauri.conf.json` 设置弹窗为无边框/置顶/不进任务栏/默认不创建
- [ ] 3.3 两个前端入口：`popup`（弹窗）与 `settings`（设置），共用设计 token（复制网页 `globals.css` 中的 token 值，不引用）
- [ ] 3.4 `desktop/README.md`：开发、配置字段说明、Windows 构建步骤；`desktop/.env.example` 只列集成测试所需变量名
- [ ] 3.5 验证：macOS 上 `npm run tauri dev` 能启动托盘与设置窗口（快捷键与选区为桩实现）

## 4. 客户端纯逻辑（复制，不引用网页）[mac]

- [ ] 4.1 复制切句实现与测试向量到 `desktop/src/lib/sentence.ts` / `sentence.vectors.ts`，测试通过
- [ ] 4.2 复制并适配 `normalizeWord` / `isSingleWord`、`stripSuffixCandidates`、`parseTranslation`，带测试
- [ ] 4.3 实现 `lookupWord(db, raw)`：精确与 lemma 并行查询 → 后缀候选按优先级挑选（`pickInOrder`）→ 未命中；音标读 `dict_cache` 降级 ECDICT；mock supabase 覆盖四条分支
- [ ] 4.4 复制分词/停用词/难词打分与提取，接入单词本熟练度阈值排除，带测试
- [ ] 4.5 收藏服务 `favorite(db, { word, sourceContext })`：先查 → 存在返回「已在单词本」→ 插入 → 23505 视为已存在；不使用 upsert；mock 覆盖三种分支
- [ ] 4.6 LLM 客户端：OpenAI 兼容流式解析（逐行 SSE、忽略 `reasoning_content`、多字节截断冲刷、提前中止时 cancel），带测试；翻译 prompt 与单词 AI 释义 prompt（禁止音标）
- [ ] 4.7 上下文决策函数 `resolveContext(selection, mode, surface?)`：实现 desktop-lookup-popup spec 中三种来源规则，带测试

## 5. 客户端界面 [mac]

- [ ] 5.1 弹窗状态机：未配置/未登录 → 读取中 → 无选区提示 → 单词模式 / 文本模式 → 错误重试
- [ ] 5.2 单词模式词卡：原型、还原提示、美/英音标、释义分组、标签、发音（有道 TTS → Web Speech）、收藏按钮（打开即显示已收藏状态）、未收录 + 「AI 释义」
- [ ] 5.3 文本模式：流式译文 + 并行难词列表，难词点击收藏并带句子
- [ ] 5.4 设置页：Supabase 连接与登录/登出、LLM 端点、快捷键、阈值、闲置分钟数、开机自启；密码不落盘
- [ ] 5.5 前端以「模拟 selection 事件」的开发模式可在 macOS 浏览器/Tauri 中完整走通 UI（用测试账号）

## 6. Rust 主进程：平台无关部分 [mac]

- [ ] 6.1 定义 `Selection { text, paragraph, offset, rect, source }` 与 `SelectionReader` trait；`cfg(not(windows))` 提供桩实现
- [ ] 6.2 降级编排：UIA 结果 → 兜底 → 空提示的决策逻辑与超时组合（800ms / 1500ms），用假实现做 Rust 单元测试
- [ ] 6.3 窗口管理：按需创建弹窗、隐藏、闲置计时销毁、设置窗口关闭即销毁；托盘菜单（设置/暂停快捷键/退出）；单实例转打开设置
- [ ] 6.4 弹窗定位纯函数：给定选区矩形/鼠标点与显示器工作区，计算位置（含底部翻转），单元测试

## 7. 集成测试（测试账号）[mac]

- [ ] 7.1 `desktop` 集成测试：读取 `E2E_EMAIL`/`E2E_PASSWORD`，登录后断言邮箱一致否则中止；默认跳过，`DESKTOP_IT=1` 才运行
- [ ] 7.2 覆盖：查词真实命中、插入 `zzqa*` 词（带句子）、重复收藏不覆盖、结束时只删除本用户 `zzqa*` 行
- [ ] 7.3 提交 1–7 的成果到 `feat/desktop-quick-lookup` 分支并推送，便于在 Windows 上继续

## 8. Windows：选区读取 [win]

- [ ] 8.1 实现 UIA 读取：专用 COM 线程、`GetFocusedElement` → 祖先链找 `TextPattern` → 选区文本 / 段落扩展 / 偏移 / 矩形；跨段时 `paragraph = null`
- [ ] 8.2 实现剪贴板兜底：等修饰键松开 → 全格式快照 → `SendInput` Ctrl+C → 等序列号变化 → 读 Unicode 文本 → 恢复快照（失败至少恢复文本）
- [ ] 8.3 记录并归还前台窗口焦点（`SetForegroundWindow`）
- [ ] 8.4 验证 `tauri-plugin-http` 流式响应；不可用则改为 Rust 命令 + 事件逐块推送

## 9. Windows：验收与打包 [win]

- [ ] 9.1 快捷键默认值实测（Edge、VS Code、Word 桌面、Word 网页、中文输入法下），确定默认键
- [ ] 9.2 验收矩阵 `desktop/docs/windows-matrix.md`：四个场景 × {单词读取、段落读取、剪贴板恢复、焦点归还、弹窗定位、收藏带句子}
- [ ] 9.3 资源实测：空闲常驻内存、弹窗存活时内存、冷启动耗时；据此确定 `idleDestroyMinutes` 默认值并更新 design
- [ ] 9.4 稳定性：目标程序无响应、快捷键被占用、网络断开、Supabase session 过期刷新等场景验证
- [ ] 9.5 `npm run tauri build` 产出安装包，安装、开机自启验证；README 补充安装说明
- [ ] 9.6 回填 design.md 的 Open Questions 结论，`openspec validate desktop-quick-lookup --strict` 通过

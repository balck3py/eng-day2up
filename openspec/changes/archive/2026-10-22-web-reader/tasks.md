> 已全部实现并上线（a0297a7、e88b8d8）。写库验证只用 E2E 测试账号，收藏后已取消。

## 1. 地址与安全

- [x] 1.1 `src/lib/reader/url.ts`：`toFetchUrl`（GitHub blob → raw、缺协议补 https、非 http(s) 拒绝）、`resolveAgainst`（相对地址补全、危险协议丢弃），带测试
- [x] 1.2 `src/lib/reader/ssrf.ts`：`isBlockedIp` 覆盖 IPv4 私有/保留段与 IPv6 回环/唯一本地/链路本地/映射地址，带测试
- [x] 1.3 只填路径时补默认文档站 `qiniu.aiquannei.com`；首段为文档文件名时视为路径，带测试

## 2. 代抓接口

- [x] 2.1 `POST /api/fetch-page`：登录校验、逐跳校验的手动重定向（≤3）、2MB 上限、10s 超时、拒绝 `text/html` 与非文本类型
- [x] 2.2 验证：127.0.0.1、localhost、169.254.169.254、`[::1]` 返回「不允许访问内网地址」，`file://` 返回「地址无效」

## 3. 渲染

- [x] 3.1 安装 `react-markdown`、`remark-gfm`；`MarkdownView` 不启用原始 HTML，`urlTransform` 补全链接与图片，外链新开标签
- [x] 3.2 `.reader-prose` 排版（标题、列表、引用、代码、表格、图片），全部使用现有颜色 token
- [x] 3.3 `/reader?url=` 页面与 `Reader` 组件；导航新增「加载第三方网站」
- [x] 3.4 输入框改为 `type="text"` + `inputMode="url"`，避免浏览器拦截无协议输入

## 4. 划词翻译

- [x] 4.1 `src/lib/reader/sentence.ts`：`sentenceAt`、`sentenceContaining`、`sentencesCovering`（基于 `Intl.Segmenter`，500 字截断），带测试
- [x] 4.2 抽出 `src/lib/translate/client.ts`（`streamTranslate`、`fetchHardWords`），翻译页改用它且行为不变
- [x] 4.3 `HardWordGrid` 新增可选 `contextFor`、`compact`
- [x] 4.4 `ReaderSelection`：`selectionchange` 防抖、选区下方「译」按钮、滚动重算、Esc/点外部关闭、桌面浮窗与窄屏底部面板
- [x] 4.5 `SelectionPanel`：单词 → 词卡 +「收藏时连同此句」；句子 → 流式译文 + 难词（各带所在句）

## 5. 验证

- [x] 5.1 Playwright 脚本（拦截代抓接口、阻断第三方请求）：渲染、相对地址补全、单词与半句两种浮窗、收藏请求体中的 `sourceContext` 为整句、390px 宽无横向滚动、导航单行
- [x] 5.2 `npm test`、`tsc --noEmit`、`npm run build` 通过；新增代码无 lint 警告
- [x] 5.3 推送、合并进 `worktree-translate-wordbook`、Vercel 部署；线上 `/reader` 未登录跳登录页、`/api/fetch-page` 未登录返回 401

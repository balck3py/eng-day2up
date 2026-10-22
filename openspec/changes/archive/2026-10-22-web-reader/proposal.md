## Why

平时要读的英文资料不少是 Markdown 文档（自己文档站 qiniu.aiquannei.com 上的播客稿、GitHub 上的 README 等）。之前只能把段落复制到翻译页里翻，遇到生词再手动收藏，读完一篇要来回切很多次，收藏时也没能带上这个词所在的句子。

## What Changes

- 顶部导航新增「加载第三方网站」入口，进入阅读页 `/reader`：粘贴文档地址后在本站页面内渲染 Markdown，地址写进 `?url=`，刷新或收藏书签都能回到同一篇。
- 地址补全：只填路径（如 `podcast/deep-dive/deep-dive-2.md`）时自动补成 `https://qiniu.aiquannei.com/…`；缺协议补 `https://`；GitHub `blob` 链接自动换成 raw 地址。
- 新增服务端代抓接口 `POST /api/fetch-page`：浏览器直连第三方会被跨域挡住，iframe 嵌入又读不到选区，所以由服务端抓回原文。带 SSRF 防护（逐跳校验重定向、拒绝内网地址）、2MB 上限、10s 超时，需要登录才能用。
- 划词翻译：在文档里选中文字后，选区下方出现「译」按钮；点开浮窗——单词显示词卡，句子显示流式译文与难词卡片。难词收藏时把**该词所在的完整句子**写入 `wordbook.source_context`（只选了半句也补成整句）。
- 手机窄屏（< 640px）浮窗改为底部面板；监听 `selectionchange` 以支持手机长按选词。
- 重构：翻译页的流式翻译与难词请求抽成 `src/lib/translate/client.ts`，翻译页与阅读页共用；翻译页行为不变。
- 不做：普通 HTML 网页的正文抽取（`text/html` 直接提示暂不支持）、阅读历史、渲染原始 HTML。

## Capabilities

### New Capabilities

- `reader-document-loading`：阅读页入口、地址规范化与补全、服务端代抓（含安全限制）、Markdown 渲染规则。
- `reader-selection-translate`：阅读页内的选区识别、「译」按钮、单词/句子两种浮窗、收藏时的所在句子规则、窄屏布局。

### Modified Capabilities

（无。`openspec/specs/` 在本次之前为空。）

## Impact

- **新增**：`src/app/reader/page.tsx`、`src/app/api/fetch-page/route.ts`、`src/components/reader/*`（`Reader`、`MarkdownView`、`ReaderSelection`、`SelectionPanel`）、`src/lib/reader/{url,ssrf,sentence}.ts`（+ 测试）、`src/lib/translate/client.ts`。
- **修改**：`NavBar.tsx`（新入口；窄屏隐藏品牌字、收紧间距以保持单行）、`HardWordGrid.tsx`（新增可选 `contextFor`、`compact` props）、`src/app/page.tsx`（改用共享的流式翻译函数）、`globals.css`（`.reader-prose` 排版）。
- **依赖**：新增 `react-markdown`、`remark-gfm`。
- **数据库**：无 schema 变更，沿用 `wordbook.source_context`。
- **桌面客户端**：不涉及。

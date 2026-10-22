## Context

- 网页版（Next.js 16 + Supabase，部署在 Vercel）已有翻译页：单词走词典，段落走 `/api/translate` 流式翻译 + `/api/hard-words` 难词拆解；`SelectionPopover` 支持在结果里划单个词弹词卡；`FavoriteButton` 收藏时可带 `sourceContext`。
- 要读的文档主要是 Markdown：自己的文档站 `qiniu.aiquannei.com`（返回 `text/markdown`）与 GitHub。
- 单一用户；桌面与手机都用。

## Goals / Non-Goals

**Goals:**
- 粘贴地址（或只填路径）即可在站内阅读 Markdown。
- 选中词或句子 → 一键看翻译 → 难词连同所在句子收进单词本。
- 手机长按选词可用。

**Non-Goals:**
- 普通 HTML 网页的正文抽取（Readability 一类）。
- 阅读历史、书签管理。
- 渲染文档中的原始 HTML。

## Decisions

### D1 服务端代抓 + 站内渲染，不用 iframe
iframe 嵌入第三方页面时，跨域限制使父页面读不到其中的选区，划词无从实现；浏览器直接 `fetch` 第三方又会被 CORS 挡住。所以由 `POST /api/fetch-page` 在服务端抓回原文，前端用 `react-markdown` 渲染在本站 DOM 里。

### D2 SSRF 防护
代抓接口是一个「替用户访问任意地址」的入口，必须防止被用来探测内网：
- 只允许 http/https；需要登录。
- 解析主机名的**全部**地址，任一落在回环、私有、链路本地（含 169.254.169.254 元数据地址）、CGNAT、保留或组播段即拒绝；IPv4 映射的 IPv6 按其 IPv4 判断。逻辑在 `src/lib/reader/ssrf.ts`（依赖 `node:net`，只在服务端引用）。
- 重定向 `redirect: 'manual'` 手动跟随，最多 3 跳，每跳重新校验。
- 2MB 上限（先看 `content-length`，再边读边计），10s 超时。
- 已知残余风险：解析与连接之间存在 DNS 重绑定窗口。单人自用场景下接受。

### D3 Markdown 渲染不开 rehype-raw
`react-markdown` 默认不执行原始 HTML，这就是消毒策略；不要随手加 `rehype-raw`。相对链接与图片用 `urlTransform` 按文档最终地址补全，`javascript:` 等协议丢弃；外链新开标签页，避免丢掉阅读页。图片用原生 `<img>`（第三方任意域名，`next/image` 需要逐域配置）。

### D4 地址补全
`toFetchUrl`（`src/lib/reader/url.ts`，前后端可共用、无 Node 依赖）：
- 有协议：只接受 http/https。
- 无协议：首段像主机名（带点的域名、`localhost`，可带端口）就补 `https://`；否则视为路径，补默认文档站 `https://qiniu.aiquannei.com/`。首段是 `.md/.markdown/.mdx/.txt` 文件名时视为路径而非域名。
- GitHub `blob` 链接换成 `raw.githubusercontent.com`。
- 输入框用 `type="text"` + `inputMode="url"`：`type="url"` 会被浏览器以「请输入网址」拦下无协议输入，请求根本发不出去（上线后踩过）。

### D5 选区识别用 selectionchange
手机长按选词、拖动选区手柄都不会可靠触发 `touchend`，但一定触发 `selectionchange`。停手 250ms 后判定；选区须落在文档容器内；超过 2000 字截断。页面滚动时按新位置重算按钮。「译」按钮放在选区**下方**——上方是手机系统复制菜单的位置。按钮 `pointerdown` 时 `preventDefault` 以免桌面端清掉选区；手机端选区仍可能被收起，所以内容在出现按钮时就已存好。

### D6 所在句子
- 选单个词：取它所在块元素（p/li/td/h1–h6/blockquote/pre/dt/dd）的文本与偏移，用 `Intl.Segmenter`（sentence 粒度）切出所在句。
- 选句子或半句：取覆盖选区的全部整句（`sentencesCovering`），每个难词再从中挑出包含它的那一句（`sentenceContaining`，整词、大小写不敏感）。
- 结果截到 500 字，与 `/api/wordbook` 对 `source_context` 的截断一致。
- 与 `desktop-quick-lookup` 的关系：那边规划的 `context-sentence`（自写边界规则、缩写/小数处理、居中截取、双端共享测试向量）尚未实现。本次用浏览器自带的 `Intl.Segmenter` 先满足阅读页；等 `context-sentence` 落地时，阅读页应改为调用它，统一行为。

### D7 浮窗布局
桌面：贴选区下方，宽 440px，下方空间不足时翻到上方，高度限制在可用空间内。窄屏（< 640px）：底部面板，最高 70vh。Esc、点外部、× 关闭。

### D8 复用而非复制翻译逻辑
把翻译页里约 70 行的流式翻译（本地模型直连 / `/api/translate` SSE 解析）抽成 `streamTranslate`，难词请求抽成 `fetchHardWords`，两页共用。`HardWordGrid` 加可选 `contextFor`（按词给上下文）与 `compact`（单列），默认行为不变。

## Risks / Trade-offs

- DNS 重绑定窗口（见 D2）。
- `Intl.Segmenter` 对缩写（`e.g.`、`Mr.`）可能误切，比 `context-sentence` 的规则粗糙（见 D6）。
- 句子模式翻译的是用户选中的原文；存进单词本的是补全后的整句，两者可能不同。

## Migration Plan

无数据迁移。上线即用；回滚只需回退代码。

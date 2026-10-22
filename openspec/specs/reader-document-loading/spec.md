# reader-document-loading Specification

## Purpose
阅读页（`/reader`）如何把用户给出的地址变成一篇可读的文档：地址规范化与默认文档站补全、服务端代抓及其安全限制、Markdown 的安全渲染与窄屏排版。实现见 `src/lib/reader/{url,ssrf}.ts`、`src/app/api/fetch-page/route.ts`、`src/components/reader/{Reader,MarkdownView}.tsx`。

## Requirements
### Requirement: 阅读页入口与地址持久化
系统 SHALL 在顶部导航提供「加载第三方网站」入口，指向 `/reader`。阅读页提供地址输入框与「打开」按钮；打开后地址写入查询参数 `?url=`，直接访问带该参数的 `/reader` 时 SHALL 自动加载对应文档。

#### Scenario: 打开文档后可刷新回到同一篇
- **WHEN** 用户在阅读页输入地址并点「打开」，随后刷新页面
- **THEN** 页面地址为 `/reader?url=<编码后的输入>`，刷新后自动加载同一文档

#### Scenario: 未登录访问
- **WHEN** 未登录用户访问 `/reader`
- **THEN** 跳转到登录页

### Requirement: 地址规范化与补全
系统 SHALL 按以下规则把用户输入转换为实际抓取地址：
- 带协议时只接受 `http`/`https`，其余协议拒绝；
- 无协议且首段像主机名（含点的域名或 `localhost`，可带端口）时补 `https://`；
- 无协议且首段不像主机名（含首段为 `.md` `.markdown` `.mdx` `.txt` 文件名、或以 `/` 开头）时，视为默认文档站 `qiniu.aiquannei.com` 上的路径，补成 `https://qiniu.aiquannei.com/<路径>`；
- `https://github.com/<owner>/<repo>/blob/<rest>` 转为 `https://raw.githubusercontent.com/<owner>/<repo>/<rest>`。

输入框 MUST NOT 使用浏览器原生的 URL 类型校验，以免无协议输入被浏览器拦截。

#### Scenario: 只填路径
- **WHEN** 输入 `podcast/deep-dive/deep-dive-2.md`
- **THEN** 抓取 `https://qiniu.aiquannei.com/podcast/deep-dive/deep-dive-2.md`

#### Scenario: 以斜杠开头的路径或单个文件名
- **WHEN** 输入 `/podcast/a.md` 或 `deep-dive-2.md`
- **THEN** 分别抓取 `https://qiniu.aiquannei.com/podcast/a.md` 与 `https://qiniu.aiquannei.com/deep-dive-2.md`

#### Scenario: 缺协议的域名
- **WHEN** 输入 `example.com/a.md`
- **THEN** 抓取 `https://example.com/a.md`

#### Scenario: GitHub 文件页
- **WHEN** 输入 `https://github.com/vercel/next.js/blob/canary/README.md`
- **THEN** 抓取 `https://raw.githubusercontent.com/vercel/next.js/canary/README.md`

#### Scenario: 非法协议
- **WHEN** 输入 `file:///etc/passwd` 或 `javascript:alert(1)`
- **THEN** 返回 400「地址无效，只支持 http(s)」，不发起任何请求

### Requirement: 服务端代抓与访问限制
系统 SHALL 由服务端接口 `POST /api/fetch-page`（请求体 `{ url }`，响应 `{ url: 最终地址, text }`）抓取文档，并 MUST 满足：
- 仅登录用户可调用，否则 401；
- 主机名解析出的任一地址属于回环、私有、链路本地、CGNAT、保留或组播地址段（IPv4 映射的 IPv6 按其 IPv4 判断）时拒绝；
- 重定向手动跟随，最多 3 次，每一跳重新执行地址校验，且只允许跳到 http/https；
- 响应体超过 2MB 时中止；单次请求 10 秒超时；
- `Content-Type` 为 `text/html` 时拒绝并提示暂只支持 Markdown/纯文本；其他非 `text/*`、非 markdown、非 `octet-stream` 的类型拒绝。

#### Scenario: 拒绝内网地址
- **WHEN** 请求 `http://127.0.0.1/`、`http://localhost/`、`http://169.254.169.254/x` 或 `http://[::1]/`
- **THEN** 返回 400「不允许访问内网地址」

#### Scenario: 重定向到内网
- **WHEN** 公网地址返回 302 指向内网地址
- **THEN** 在跟随前的校验中拒绝

#### Scenario: 普通网页
- **WHEN** 目标返回 `text/html`
- **THEN** 返回 400，提示这是网页、目前只支持 Markdown/纯文本地址

#### Scenario: 超时
- **WHEN** 目标 10 秒内未响应
- **THEN** 返回 502「抓取超时」

### Requirement: Markdown 安全渲染
系统 SHALL 以 GFM（表格、任务列表、删除线等）渲染抓回的文本，并 MUST NOT 执行或渲染文档中的原始 HTML。相对链接与图片地址 SHALL 按文档最终地址补全；`http`/`https`/`mailto` 以外的链接协议丢弃；页内锚点保留；外链在新标签页打开。

#### Scenario: 相对图片与链接
- **WHEN** 文档地址为 `https://example.com/repo/docs/guide.md`，其中含 `![](img/a.png)` 与 `[x](../appendix.md)`
- **THEN** 图片地址为 `https://example.com/repo/docs/img/a.png`，链接为 `https://example.com/repo/appendix.md` 且在新标签页打开

#### Scenario: 原始 HTML 不执行
- **WHEN** 文档中含 `<script>` 或 `<img onerror=…>`
- **THEN** 不执行任何脚本

### Requirement: 窄屏不横向滚动
阅读页在 390px 宽的视口下 MUST NOT 出现页面级横向滚动；代码块与表格在自身容器内横向滚动。导航栏在窄屏 SHALL 保持单行。

#### Scenario: 手机宽度
- **WHEN** 在 390px 宽视口中打开含长代码行与宽表格的文档
- **THEN** `document.documentElement.scrollWidth` 等于视口宽度，导航栏只占一行


# Design

## Context

目标见 proposal.md。当前 `/podcast` 直接渲染 Daily News 剧集，`PodcastCatalog` 只有标题是链接；`loadCatalog` 固定 FEED_URL，`resourceUrl` 限制为 `/podcast/daily-news/`。`PodcastDetail` 将 Playback 和中文开关放在标题下方；播放器由详情 effect 创建，已有媒体时间检查、单句/连续模式、事件代次保护，但没有 rate 状态。

2026-11-02 直接读取四份 feed：Daily News、AI Digest、Talk Today 各 18 集，最新一集声明英文与 zh-CN SRT；How It Works 有 5 集，最新一集仅英文。四个频道均有同目录 cover.jpg，音频为 MP3，feed 都声明一年缓存。数量与语言可用性仅是本次观察，不作为代码常量。

上一播客变更已按用户要求于 2026-11-02 同步主规格并归档，保留两项真机验收未完成记录。新能力聚焦节目层级与控制区，对既有点播、双语和顶部翻译只规定兼容约束，旧变更的真机验收记录仍予保留。特别保留用户决定：按修正后的 SRT 播放，不加 0.5 秒尾部补偿。

## Goals / Non-Goals

**Goals:** 节目范围可追踪，旧链接不失效；控制区与音频实例分离；速度改变与折叠均不干扰媒体时间、字幕目标及选词翻译。

**Non-Goals:** 不增加任意源订阅/编辑、跨页后台播放、自动续播下一集、播放进度同步、拖拽移动面板、整期字幕自动生成或数据库迁移。不改变阅读页顶部四行翻译框。

## Decisions

### 1. 节目注册表和地址约定

新增 `src/lib/podcast/programs.ts`，维护固定 id、名称、feed URL、资源目录和封面后备地址：

| id | 显示名 | 固定 feed |
| --- | --- | --- |
| daily-news | Daily News 10 Mins | https://qiniu.aiquannei.com/podcast/daily-news/feed.xml |
| ai-digest | AI Digest | https://qiniu.aiquannei.com/podcast/ai-digest/feed.xml |
| topic | Talk Today | https://qiniu.aiquannei.com/podcast/topic/feed.xml |
| deep-dive | How It Works | https://qiniu.aiquannei.com/podcast/deep-dive/feed.xml |

首页可立即用登记信息和后备封面显示四入口；进入某节目时仅加载该 feed，使用其实际频道元数据补充展示。避免一次打开首页就下载所有剧集/字幕，也避免一份 feed 失败阻塞其他入口。

新页面：
- `/podcast`：节目选择。
- `/podcast/shows/[programId]`：该节目剧集列表。
- `/podcast/shows/[programId]/[episodeId]`：该节目详情。

使用固定 shows 段，避免新增 `[programId]` 与现有 `[episodeId]` 同级动态段冲突。旧 `/podcast/[episodeId]` 跳转至 daily-news 新详情；保留原 GUID/enclosure 摘要算法，不改变原 episodeId。节目 id 和 episodeId 共同决定资源身份和组件 key，禁止跨 feed 查找同 id 后兜底。

API 同样增加 `/api/podcast/shows/[programId]` 和 `/api/podcast/shows/[programId]/[episodeId]`；旧 `/api/podcast` 与 `/api/podcast/[episodeId]` 继续作为 Daily News 兼容入口，不在旧路径突然换响应结构。无须节目首页聚合 API。

### 2. 数据加载与资源限制

给现有 feed 解析和加载函数显式传 program 配置，保留 XML 实体防护、10 秒、2MiB、3 次重定向和每跳校验。资源仍只接受 HTTPS 的 qiniu.aiquannei.com、标准端口、无凭据，路径限制为当前节目的规范化目录。不能直接放开整个 `/podcast/` 或任意用户提供 URL。图片也沿用各节目频道封面回退。

延续 no-store 和受控破缓存参数；只刷新当前节目。SRT 双语配对逻辑不变，How It Works 的英文单轨无需特殊猜测文件名。目录请求取消/代次保护继续使用 usePodcastData；节目详情 key 保证切期停止旧音频，旧请求不覆盖新节目。

### 3. 信息架构与视觉方向

复用现有 Geist 字体和色板，不引入新字体或依赖：背景 #F5F7FA、面板 #FFFFFF、正文 #14213D、次级文字 #5C6A87、分隔 #DDE3EC、交互焦点 #2B5CE6，深色模式使用既有 token。蓝色只用于焦点和当前状态，不做彩色分区或渐变。

标题 24px/600，卡片名称 16px/500，正文字幕沿用现状，日期与辅助标签 12–13px；数字使用等宽数字以稳定当前倍速与时间宽度。所有内容左对齐，详情控制区播放主按钮是唯一强对比操作。

节目首页：max-width 768px，24px 页边距（手机 20px），360px 起双列 2×2，320px 改单列，间距 16px。按用户追加要求，卡片只显示填满卡片的正方形节目封面，不再显示独立名称行或内边距；Link 的 aria-label 保留节目名，支持读屏、焦点和键盘导航。无大横幅、统计卡片或装饰性副标题，整张卡片一个 Link。

剧集列表：顶部为返回节目入口、频道名和右侧刷新。剧集为纵向列表中的整卡链接：80px 封面，右侧标题和日期，内边距 16px，标题换行、日期较淡。可点击留白不夹杂其他按钮，键盘聚焦整卡有明确外环。

```text
播客
┌──────────────────┐ ┌──────────────────┐
│                  │ │                  │
│   [节目封面]     │ │   [节目封面]     │
└──────────────────┘ └──────────────────┘
┌──────────────────┐ ┌──────────────────┐
│                  │ │                  │
│   [节目封面]     │ │   [节目封面]     │
└──────────────────┘ └──────────────────┘

返回节目   Daily News 10 Mins          刷新
┌──────────────────────────────────────┐
│ [剧集图] Holiday, Housing...          │
│          2026/11/02                   │
└──────────────────────────────────────┘
```

对照简洁诉求后的取舍：节目才用网格卡片，长剧集列表维持轻边框/分隔，不把每条字幕做成大卡；面板不重复放封面和长剧集名，不增设控制按钮之外的状态装饰。

封面由 `next/image` 输出适配 sizes/srcset 的优化图；首页按卡片宽度，剧集列表按 64/80px 请求，保留频道后备与占位。2026-11-02 检查四张原图合计约 4MB，源站已返回一年 max-age；优化可同时缩小首次下载量和复用后续结果。`next.config.ts` 将图片 minimumCacheTTL 设七天（与上游 TTL 取较大值），Vercel 自动使用图片优化缓存，本地生产使用 `.next/cache/images`，浏览器按实际响应缓存。remotePatterns 仅允许四节目目录、HTTPS 标准端口，maximumRedirects=0 防止优化器跳转到范围外。当前固定封面更新时应更换 URL 或添加版本参数，使长缓存可更新。

Next 内容哈希 JS/CSS/字体继续使用框架的一年 immutable 缓存。根目录 public 图片/图标/字体配置浏览器一天、共享 CDN 三十天缓存；Next 配置同时用于本地生产和 Vercel，不叠加 vercel.json。目录、字幕和鉴权 JSON 的 no-store/刷新规则保留，音频继续直接使用源站缓存。缓存验收必须使用 `next build` + `next start`，开发模式不作为生产缓存证据。

### 4. 底部悬浮播放器

从 PodcastDetail 抽出 `PlayerDock`，它只订阅/调用既有 controller，媒体实例和 effect 仍由详情父级持有，不放在折叠内容里创建。中文显隐状态也保留在父级并传给 Dock。这样面板内容卸载、隐藏都不触发播放器清理或字幕状态重置。

固定在视口底部，左右 12px、底部 12px 加 safe-area；桌面居中 max-width 720px。白/深色面板、1px 细边、12px 圆角、轻阴影，无透明毛玻璃或背景遮罩。移动端三行紧凑布局，约 152–180px（由可读性与内容决定，不硬裁错误提示），窄/低视口必要时面板内部滚动。

```text
┌────────────────────────────────────┐
│ 单句 / 连续    [播放/暂停]  从头   ⌄ │
│ 01:23 / 06:50            ☑ 显示中文 │
│ 速度 0.50× ─────●──── 1.20×  0.85× │
│                         恢复 1.0× │
└────────────────────────────────────┘
折叠后：                           [⌃]
```

上述线框表示分组，实施时恢复默认速度可并入速度标签附近小按钮，不为它单独占一整行。折叠按钮位于右上角，折叠后在同一右侧锚点仅保留 44×44px 的向上箭头。无迷你条、播放按钮或时间残留。默认展开，不自动因正文滚动而折叠；每个新详情重新默认展开，不保存折叠状态。

正文末尾预留约一个展开面板的高度（用测量或共享尺寸 token），确保最后一条能滚动至控件上方。折叠不动态改变正文 padding，以免滚动位置跳变。面板区域本身覆盖正文而不重排正文。顶部只留下返回、标题、日期和简短选词提示，播放相关开关全部集中到底部。

aria-expanded/aria-controls、箭头可读名称、slider 名称和值、可见焦点与至少 44px 点击范围作为实现要求。折叠后内部控件不可聚焦，焦点转到展开按钮，展开后保持合理焦点。动画至多 120–160ms，尊重 reduced-motion。正常操作无论折叠与否均不启动或停止媒体。

### 5. 倍速与媒体时钟

给 PlayerState 加 rate，controller 提供 setRate；range min=0.5、max=1.2、step=0.05，文本显示两位小数（1.00×）。对输入做有限数检查、边界限制及步长归一；值非法回退 1.0。设置 HTMLAudioElement.playbackRate，浏览器支持时启用 preservesPitch。维护 ratechange 与当前状态一致，加载/错误重试重申 rate，避免 media.load 导致速度回到默认。

使用浏览器本地偏好键记录速度，读取失败、旧值非法或越界则 1.0；首次挂载后再读取，避免 SSR 访问 localStorage。只保存速度，不保存进度。默认展开和偏好持久化是本提案采用的产品默认值，可在实施前调整。

继续用 actual currentTime 判断 SRT 高亮与单句终点，不把时间戳乘除 rate；25ms 检查在 1.2× 仍需验证原有 150ms 媒体时间误差。切速不 seek、pause/play 或重新选择 cue；从头播放和点击字幕保留 rate。

### 6. 与顶部翻译的关系

保持现有选中即翻译、最多四行、正文滚动关闭的行为。Dock 标记为 selection-ignore；ReaderSelection 的全局 pointerdown、selectionchange 和 scroll 监听也需识别 Dock 来源并跳过关闭/查询，避免点击底部控件意外关闭顶部翻译；正文实际滚动仍关闭顶部翻译。range 拖动和控制文字选择不发起翻译，也不冒泡成字幕点播。顶部翻译和底部播放器独立显示，顶部层级更高；底部展开不关闭顶部结果。使用低高度视口和字体放大检查两者同时可用；必要时各自内容内部滚动，不改变四行翻译内容上限或锁住正文。

## Risks / Trade-offs

- [路由/剧集标识冲突] → 固定 shows 路径段、节目范围解析与旧链接映射，补同 GUID 跨 feed 夹具。
- [目录长缓存] → 延续当前刷新策略；验证四源，发布方 CDN 缓存策略仍影响更新时效。
- [底部遮挡/安全区] → 按面板高度留尾部空间、稳定 padding、390px/320px/横屏及字体缩放验收。
- [倍速重试重置或停止误差] → 媒体加载重申 rate，单元测试加真实 MP3 的 0.5/1.2× 前台验证。
- [基础播放行为回归] → 对照已同步的主规格运行单句/连续和翻译回归，旧变更真机验收说明保留在归档中。

## Migration Plan

无需数据迁移。先加节目配置和兼容数据接口，再加入分层页面、整卡链接，最后接入倍速与 Dock。实施前阅读实际 node_modules/next/dist/docs 的路由、组件、数据加载指南，并在 codex/ 前缀功能分支开发。

实施验证使用现有隔离鉴权 Playwright 配置，替换单源夹具并保留旧链接回归；四个真实 feed 作为可选网络测试，不运行删除真实生词本的旧套件。回滚时恢复单源入口和旧控件布局，旧详情 API 和标识从始至终保持兼容。仅规划完成不触发实现、合并或部署。

# reader-selection-translate Specification

## Purpose
阅读页内「选中 → 译 → 收藏」的交互：何时出现翻译按钮、单词与句子两种浮窗的内容、收藏时写入 `wordbook.source_context` 的所在句子规则、桌面浮窗与窄屏底部面板。实现见 `src/components/reader/{ReaderSelection,SelectionPanel}.tsx`、`src/lib/reader/sentence.ts`。

## Requirements
### Requirement: 选中后自动翻译
在阅读页文档及播客详情的加载内容区选中非空英文文本、停止调整选区 250ms 后，系统 SHALL 自动查询并展示顶部翻译浮窗，不再显示中间「译」按钮。选区识别 MUST 支持 selectionchange、手机长按与拖动手柄及桌面/键盘选择。内容区外、输入框内或浮窗内部的选择 SHALL 不触发正文查询。超过 2000 字时 SHALL 仅处理前 2000 字并提示截断。

#### Scenario: 桌面拖选
- **WHEN** 用户在文档段落中拖选一个词并停止调整 250ms
- **THEN** 自动打开顶部浮窗并查询该词，不需要点击「译」

#### Scenario: 选区不在文档内
- **WHEN** 用户在地址输入框或浮窗内选中文字
- **THEN** 不触发正文翻译，也不替换已展示的浮窗查询

#### Scenario: 滚动
- **WHEN** 正文选区的浮窗显示时用户滚动下方正文
- **THEN** 浮窗立即关闭，旧选区不因后续 selectionchange 或旧响应自动重开

#### Scenario: 手机长按
- **WHEN** 用户长按英文并拖动选区手柄后停止
- **THEN** 稳定后自动翻译最终选择，调整过程不连续发起中间查询

### Requirement: 单词浮窗
选中内容为单个英文词时，系统 SHALL 自动展示紧凑的词头、中文释义、音标、发音图标和加入生词本按钮；不展示大词卡、等级徽章、难词列表或收藏原句说明。收藏写入的 sourceContext SHALL 为该词所在英文句子。缺失音标或释义时 SHALL 如实提示，不伪造字段；加载失败可重试。

#### Scenario: 收藏单词连同句子
- **WHEN** 文档段落为 `The ubiquitous smartphone has fundamentally altered how we consume information. Researchers remain skeptical about its long-term effects on attention.`，用户选中 `skeptical`
- **THEN** 自动显示紧凑词条；收藏时 sourceContext 为 `Researchers remain skeptical about its long-term effects on attention.`，界面不额外展示该上下文说明

### Requirement: 句子浮窗
选中内容不是单个英文词而为英文短语、句子或段落时，系统 SHALL 自动流式显示所选原文的中文译文，复用现有翻译服务与本地模型配置。内容 SHALL 仅为中文翻译，不显示音标、发音、收藏、难词卡片或原文大段摘要；允许显示关闭、加载、错误及重试控件。

#### Scenario: 只选了半句
- **WHEN** 用户选中 `fundamentally altered how we consume`
- **THEN** 自动翻译选中的片段，不扩大至整句；不请求或显示难词与收藏按钮

#### Scenario: 跨句选择
- **WHEN** 用户选区横跨两句
- **THEN** 翻译选中的完整片段，仅显示中文译文，不拆出可收藏的难词卡片

### Requirement: 所在句子的切分与长度
阅读页单词上下文 SHALL 在选区起点所在块（段落、列表项、表格单元格、标题、引用、代码块、定义项）内切分；跨块时以内容区为范围。播客上下文 SHALL 仅从英文字幕文本取所在句子，不混入辅助中文、说话人标签或按钮文字。存入的句子 MUST 不超过 500 字。

#### Scenario: 列表项中的词
- **WHEN** 用户选中列表项中的一个词
- **THEN** 所在句子从该列表项文本切出，不混入相邻列表项

#### Scenario: 超长句
- **WHEN** 所在句子超过 500 字
- **THEN** 存入的上下文长度不超过 500 字

#### Scenario: 双语字幕中的单词
- **WHEN** 用户选择一条英文字幕中的词并收藏
- **THEN** 上下文为对应英文句子，不包含下面中文译文或说话人标签

### Requirement: 浮窗布局与关闭
桌面及手机端浮窗 SHALL 固定在当前视口顶部，兼顾安全区且不推移正文或改变正文滚动位置。内容区 SHALL 按当前实际行高限制为最多 4 行，短内容自然收缩，超出内部滚动；字体略小于正文且可读，操作控件紧凑排列。浮窗 SHALL 可由 Esc、外部点击、关闭按钮或正文实际滚动关闭；内部点击、复制、发音、收藏及内部滚动 SHALL 保持浮窗且不带动正文。

#### Scenario: 手机
- **WHEN** 在 390px 宽视口中选词
- **THEN** 顶部自动显示紧凑浮窗，内容区最多 4 行，不使用底部面板或屏幕高度百分比上限，页面不横向溢出

#### Scenario: 点击外部关闭
- **WHEN** 浮窗打开时点击正文区域
- **THEN** 浮窗关闭，同一次点击不能因遗留选区重新打开浮窗

#### Scenario: 长译文内部滚动
- **WHEN** 译文超过 4 行，用户滚动浮窗内容直至边缘
- **THEN** 浮窗保持显示且可读到后续内容，正文位置不变，不向正文传递滚动

#### Scenario: 正文滚动关闭
- **WHEN** 用户滚动页面或下方正文滚动容器
- **THEN** 浮窗立即消失，选择和结果事件不能在没有新选择动作时再次打开它

### Requirement: 自动查询的结果一致性
系统 SHALL 仅展示最新有效选区的查询结果；选区改变后旧结果不得覆盖新结果，关闭后旧结果不得重新显示。相同选区的重复通知 SHALL 不重复查询，重新主动选择同词 SHALL 可以重新打开。浮窗内操作导致原选区收起 SHALL 不清除当前结果或触发新请求。

#### Scenario: 请求乱序
- **WHEN** 用户先选 A 再选 B，A 的响应晚于 B
- **THEN** 仅显示 B 的结果

#### Scenario: 请求中滚动
- **WHEN** 自动翻译尚未返回，用户滚动正文关闭浮窗
- **THEN** 请求结果到达后不重新打开浮窗；用户再次主动选择时才可发起新查询

#### Scenario: 浮窗内收藏
- **WHEN** 用户点击浮窗内收藏按钮，浏览器清除了正文原选区
- **THEN** 浮窗保留并显示收藏状态，正文位置不变，也不重复查词

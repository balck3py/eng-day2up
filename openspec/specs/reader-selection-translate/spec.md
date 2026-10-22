# reader-selection-translate Specification

## Purpose
阅读页内「选中 → 译 → 收藏」的交互：何时出现翻译按钮、单词与句子两种浮窗的内容、收藏时写入 `wordbook.source_context` 的所在句子规则、桌面浮窗与窄屏底部面板。实现见 `src/components/reader/{ReaderSelection,SelectionPanel}.tsx`、`src/lib/reader/sentence.ts`。

## Requirements
### Requirement: 选中后出现翻译按钮
在阅读页的文档区域内选中非空文本、且停止调整选区 250ms 后，系统 SHALL 在选区**下方**显示「译」按钮（`aria-label="翻译选中内容"`）。选区不在文档区域内、或选区被收起时 SHALL 隐藏按钮。选区识别 MUST 基于 `selectionchange`，以支持手机长按选词与拖动选区手柄。选中文本超过 2000 字时截断到 2000 字。

#### Scenario: 桌面拖选
- **WHEN** 用户在文档段落中拖选一个词
- **THEN** 选区下方出现「译」按钮，且点击按钮不会清掉选区

#### Scenario: 选区不在文档内
- **WHEN** 用户在地址输入框或浮窗内选中文字
- **THEN** 不出现「译」按钮

#### Scenario: 滚动
- **WHEN** 按钮显示时页面滚动
- **THEN** 按钮跟随选区的新位置

### Requirement: 单词浮窗
点「译」时若选中内容为单个英文词，系统 SHALL 打开浮窗展示该词词卡（释义、音标、发音、收藏），并在词卡下方显示「收藏时连同此句：<所在句子>」。收藏写入的 `sourceContext` SHALL 为该词在文档中所在的句子。

#### Scenario: 收藏单词连同句子
- **WHEN** 文档段落为 `The ubiquitous smartphone has fundamentally altered how we consume information. Researchers remain skeptical about its long-term effects on attention.`，用户选中 `skeptical` 并点「译」
- **THEN** 浮窗显示 `skeptical` 词卡，下方提示所在句为 `Researchers remain skeptical about its long-term effects on attention.`；点收藏时请求体中的 `sourceContext` 为该句

### Requirement: 句子浮窗
点「译」时若选中内容不是单个词，系统 SHALL 打开浮窗：流式显示选中原文的中文译文（复用翻译页的后端与本地模型配置），并并行显示难词卡片。每个难词收藏时写入的 `sourceContext` SHALL 为「覆盖选区的完整句子」中包含该词（整词、大小写不敏感）的那一句。

#### Scenario: 只选了半句
- **WHEN** 用户选中 `fundamentally altered how we consume` 并点「译」，再收藏难词 `fundamentally`
- **THEN** 译文为这几个词的翻译；收藏请求体 `{"word":"fundamentally","sourceContext":"The ubiquitous smartphone has fundamentally altered how we consume information."}`

#### Scenario: 跨句选择
- **WHEN** 选区横跨两句，难词出现在第二句
- **THEN** 该难词的 `sourceContext` 为第二句

### Requirement: 所在句子的切分与长度
所在句子 SHALL 在选区起点所在的块元素（段落、列表项、表格单元格、标题、引用、代码块、定义项）的文本内切分；选区横跨多个块时以整个文档容器为范围。存入的句子 MUST 不超过 500 字。

#### Scenario: 列表项中的词
- **WHEN** 用户选中列表项中的一个词
- **THEN** 所在句子从该列表项文本中切出，不会混入相邻列表项

#### Scenario: 超长句
- **WHEN** 所在句子超过 500 字
- **THEN** 存入的上下文长度不超过 500 字

### Requirement: 浮窗布局与关闭
桌面端（视口宽度 ≥ 640px）浮窗 SHALL 贴在选区下方、宽度不超过 440px 且不超出视口；下方空间不足时显示在选区上方。窄屏（< 640px）SHALL 以底部面板显示，最高为视口高度的 70%。浮窗 SHALL 可通过 Esc、点击浮窗外部、或顶部 × 按钮关闭；顶部显示所选原文。

#### Scenario: 手机
- **WHEN** 在 390px 宽视口中选词并点「译」
- **THEN** 浮窗从底部弹出，页面不出现横向滚动

#### Scenario: 点击外部关闭
- **WHEN** 浮窗打开时点击文档区域
- **THEN** 浮窗关闭


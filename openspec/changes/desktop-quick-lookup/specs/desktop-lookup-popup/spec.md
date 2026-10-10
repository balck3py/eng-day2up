## ADDED Requirements

### Requirement: 按选中内容自动选择模式
弹窗 SHALL 对选中文本去首尾空白后判断：匹配 `^[a-zA-Z][a-zA-Z'-]*$` 为单词模式，否则为文本模式。选中文本超过 5000 字符时 SHALL 截断到 5000 字符并提示。

#### Scenario: 单词
- **WHEN** 选中 `"ubiquitous,"`
- **THEN** 进入单词模式查询 `ubiquitous`

#### Scenario: 句子
- **WHEN** 选中 `"The cache is stale."`
- **THEN** 进入文本模式

### Requirement: 单词模式展示词典结果
单词模式 SHALL 按「精确 → dict_lemma 词形还原 → 后缀规则」查询 `dict_entries`，展示原型词、美/英音标（`dict_cache`，否则 ECDICT `phonetic`，否则不显示）、按词性分组的全部中文释义、考试标签与发音按钮。词典未命中时 SHALL 显示「未收录」，并提供「AI 释义」按钮；AI 释义仅展示、标注「AI 释义，未收录」、不写库。

#### Scenario: 词形还原命中
- **WHEN** 查询 `running`
- **THEN** 展示原型 `run` 的释义，并标明由 `running` 还原

#### Scenario: 未收录
- **WHEN** 查询 `zzqanotaword`
- **THEN** 显示「未收录」与「AI 释义」按钮，不自动调用 LLM

#### Scenario: AI 不生成音标
- **WHEN** 用户点击「AI 释义」
- **THEN** 只展示释义，不显示任何由 LLM 产生的音标

### Requirement: 文本模式展示译文与难词
文本模式 SHALL 流式显示译文（调用客户端配置的 OpenAI 兼容端点，忽略 `reasoning_content`），并同时（不等译文）显示从选中文本中提取的难词列表；难词提取规则与网页一致（分词、去停用词、批量词形还原、按词频打分、排除单词本中熟练度 ≥ 阈值的词、取前 12 个按出现顺序排列）。

#### Scenario: 译文与难词并行
- **WHEN** 选中一段英文并触发
- **THEN** 难词列表在译文结束前出现，译文逐步追加

#### Scenario: LLM 失败
- **WHEN** 翻译端点不可达
- **THEN** 显示错误与「重试」按钮，难词列表照常可用

### Requirement: 收藏并附带所在句子
弹窗中的收藏 SHALL 向 `wordbook` 写入 `word`（原型）、`word_key`（规范化）、`source_context`。`source_context` 的来源：
- 单词模式且有段落：用 `context-sentence` 规则按 `paragraph` + `offset` 提取；
- 单词模式且无段落：null；
- 文本模式点难词：在选中文本（若有段落则在段落）中按该难词 `surface` 定位句子。

#### Scenario: Word 中收藏单词带句子
- **WHEN** 在 Word 段落 `"First point. The approach is pragmatic and fast. Done."` 中选中 `pragmatic` 并点收藏
- **THEN** 写入 `source_context = "The approach is pragmatic and fast."`

#### Scenario: 剪贴板路径收藏单词
- **WHEN** 通过剪贴板路径读到单词 `pragmatic` 并收藏
- **THEN** 写入 `source_context = null`

#### Scenario: 文本模式收藏难词
- **WHEN** 选中两句英文，点击第二句中的难词收藏
- **THEN** `source_context` 为第二句

### Requirement: 重复收藏不覆盖
若该 `word_key` 已在单词本中，弹窗 SHALL 显示「已在单词本」，SHALL NOT 修改该行任何字段；插入遇到唯一约束冲突时按同样方式处理。

#### Scenario: 已收藏的词
- **WHEN** 收藏一个已存在的词，且新的上下文与旧的不同
- **THEN** 数据库中该行 `source_context` 保持旧值，界面显示「已在单词本」

#### Scenario: 打开时显示收藏状态
- **WHEN** 单词模式查询到一个已收藏的词
- **THEN** 收藏按钮直接呈现已收藏状态

### Requirement: 关闭与焦点归还
按 Esc、点击弹窗外部、或再次按快捷键时，弹窗 SHALL 隐藏，并 SHALL 把前台焦点还给触发前的窗口。

#### Scenario: Esc 关闭
- **WHEN** 在 VS Code 中触发后按 Esc
- **THEN** 弹窗消失，VS Code 重新获得焦点，可直接继续输入

### Requirement: 弹窗定位
弹窗 SHALL 出现在选区矩形下方（无矩形时在鼠标附近），并完整位于当前显示器工作区内，正确处理多显示器与 DPI 缩放。

#### Scenario: 选区在屏幕底部
- **WHEN** 选区位于屏幕最下方
- **THEN** 弹窗翻转到选区上方，不超出屏幕

### Requirement: 未就绪状态引导
未配置 Supabase 或未登录时，弹窗 SHALL 提示并提供打开设置的入口，SHALL NOT 发起数据库请求；未配置 LLM 端点时，文本模式 SHALL 只显示难词并提示配置翻译端点。

#### Scenario: 首次使用
- **WHEN** 安装后未做任何配置就触发
- **THEN** 弹窗提示「请先在设置中连接 Supabase 并登录」，带「打开设置」按钮

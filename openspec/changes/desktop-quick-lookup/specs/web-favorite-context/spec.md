## ADDED Requirements

### Requirement: 翻译结果划词收藏存所在句子
在翻译结果区选中单词并通过浮层收藏时，网页 SHALL 以「选区所在文本块（原文或译文）中包含该选区的句子」作为 `sourceContext`，而不是整段原文。

#### Scenario: 长段落靠后的词
- **WHEN** 原文为 3 句、共 800 字符，用户在第 3 句中选中 `meticulous` 并收藏
- **THEN** 请求体的 `sourceContext` 为第 3 句全文（≤ 500 字符），不是原文前 500 字符

### Requirement: 难词卡片收藏存所在句子
难词卡片收藏时，网页 SHALL 用该难词的原文词形（`surface`）在原文中定位所在句子作为 `sourceContext`；定位失败时退回原文按 500 字截断（现有行为）。

#### Scenario: 难词在第二句
- **WHEN** 原文 `"It works. The protocol is idempotent by design."`，收藏难词 `idempotent`
- **THEN** `sourceContext` 为 `"The protocol is idempotent by design."`

### Requirement: 历史页挑词收藏存所在句子
历史页从段落记录中挑词批量收藏时，网页 SHALL 为每个词分别以其 `surface` 定位所在句子作为 `sourceContext`；定位失败时退回现有行为。

#### Scenario: 一次收藏多个不同句子里的词
- **WHEN** 历史段落含两句，用户分别从两句中各挑一个词收藏
- **THEN** 两条请求的 `sourceContext` 各自为对应的那一句

### Requirement: 网页改动边界
本变更 SHALL NOT 修改任何 API 路由、数据库 schema、页面结构或组件对外 props 形状以外的行为；新增逻辑限于 `src/lib/text/sentence.ts` 及上述三处调用点。

#### Scenario: 回归
- **WHEN** 运行网页 `npm test` 与 `npm run build`
- **THEN** 全部通过，且 `src/app/api/**` 与 `supabase/**` 无 diff

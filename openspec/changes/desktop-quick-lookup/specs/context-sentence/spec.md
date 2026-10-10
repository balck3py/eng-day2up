## ADDED Requirements

### Requirement: 按选中位置提取所在句子
系统 SHALL 提供函数：输入一段文本 `text` 与选中区间 `[start, end)`，返回包含该区间的完整句子（去除首尾空白）。句子边界为：`.` `!` `?` `。` `！` `？` 后跟空白或文本结尾（中文句末标点无需后跟空白），以及任意换行符。分号不视为句子边界。

#### Scenario: 段落中间的句子
- **WHEN** text 为 `"I like tea. The ubiquitous phones distract us. We know."`，选区落在 `ubiquitous` 上
- **THEN** 返回 `"The ubiquitous phones distract us."`

#### Scenario: 换行分隔
- **WHEN** text 为 `"Title line\nThe word is here"`，选区落在 `word` 上
- **THEN** 返回 `"The word is here"`

#### Scenario: 文本只有一句且无结尾标点
- **WHEN** text 为 `"just a fragment with ephemeral"`，选区落在 `ephemeral`
- **THEN** 返回整个 text

### Requirement: 不在缩写、小数与省略号处误切
句子边界判定 SHALL 跳过：常见缩写（至少 `e.g.` `i.e.` `etc.` `vs.` `Mr.` `Mrs.` `Ms.` `Dr.` `St.` `U.S.` `U.K.` `No.` `Fig.`，大小写不敏感）、数字间的小数点（如 `3.14`）、单个大写字母加点的首字母缩写（如 `J. K.`），以及省略号 `...` / `…` 后紧跟小写字母的情况。

#### Scenario: 缩写不断句
- **WHEN** text 为 `"Use tools, e.g. linters, to enforce style."`，选区落在 `enforce`
- **THEN** 返回整句 `"Use tools, e.g. linters, to enforce style."`

#### Scenario: 小数不断句
- **WHEN** text 为 `"Version 3.14 deprecated the flag."`，选区落在 `deprecated`
- **THEN** 返回整句

### Requirement: 按目标词定位句子
系统 SHALL 提供函数：输入文本与一个词形 `surface`，按词边界（前后不是字母、撇号或连字符）、大小写不敏感地找到其**第一次**出现位置，再按上一条要求返回所在句子；找不到时返回 null。

#### Scenario: 词形出现在第二句
- **WHEN** text 为 `"Cats sleep. Dogs are running fast."`，surface 为 `running`
- **THEN** 返回 `"Dogs are running fast."`

#### Scenario: 不匹配词的一部分
- **WHEN** text 为 `"The carpet is red. A car stops."`，surface 为 `car`
- **THEN** 返回 `"A car stops."`

#### Scenario: 找不到
- **WHEN** surface 在 text 中不存在
- **THEN** 返回 null

### Requirement: 结果不超过 500 字
返回的句子长度 SHALL ≤ 500 个字符。超长时以选区（或目标词）为中心截取窗口，在被截断的一侧加 `…`，且窗口必须包含完整的选中内容。

#### Scenario: 超长句截取
- **WHEN** 所在句子长 1200 字符，目标词位于第 900 字符处
- **THEN** 返回长度 ≤ 500、包含目标词、两侧截断处以 `…` 标示的片段

### Requirement: 网页与客户端行为一致
网页实现与客户端实现 SHALL 通过同一份测试向量（各存一份副本）全部用例。

#### Scenario: 双端跑同一份向量
- **WHEN** 分别在网页 `npm test` 与 `desktop` 的 `npm test` 中运行切句测试
- **THEN** 两边使用的用例数据逐条一致且全部通过

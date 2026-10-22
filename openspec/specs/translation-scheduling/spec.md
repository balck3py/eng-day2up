# translation-scheduling Specification

## Purpose
服务端所有 LLM 调用（翻译、本句释义、AI 兜底词条）共用的调度规则：provider 优先级与降级、首字节判定、熔断、超时、对冲与重试、云端请求参数，以及与每日配额检查的并发关系。实现见 `src/lib/translate/{scheduler,cloud,withQuota}.ts`。

## Requirements
### Requirement: 按优先级尝试 provider 并降级
服务端 LLM 调用 SHALL 按配置顺序（ollama → cloud，未配置的跳过）尝试 provider。首字节到手后才返回结果，返回的 `provider` MUST 是最终生效的那个。首字节之后的错误 MUST NOT 触发降级，而是作为流中断告知调用方。全部 provider 失败时抛出包含各自原因的错误，接口返回 503「翻译服务不可用」。

#### Scenario: 首选失败降级
- **WHEN** ollama 抛错而 cloud 可用
- **THEN** 结果来自 cloud，且不丢失 cloud 的首个片段

#### Scenario: 输出中途断流
- **WHEN** 首选已输出部分内容后中断
- **THEN** 不切换到次选，调用方收到已输出内容与中断错误

### Requirement: 有兜底的 provider 用短超时与熔断
身后还有其他 provider 时，该 provider 的首字节（包括空串心跳）MUST 在 5 秒内到达，否则中止其请求并降级。连续失败 3 次 SHALL 熔断 5 分钟，熔断期间直接跳过；成功一次即清零失败计数。

#### Scenario: 推理后端的心跳算首字节
- **WHEN** 首选只在 5 秒内发出空串心跳、正文更晚才到
- **THEN** 不降级，最终输出正文，且空串不外传

#### Scenario: 熔断
- **WHEN** 首选连续失败 3 次
- **THEN** 接下来 5 分钟内的请求不再尝试首选

### Requirement: 最后一个 provider 永不熔断并放宽超时
身后没有兜底的 provider MUST NOT 因熔断被跳过。它的「到手」判据为**第一个非空正文**（心跳不算），总等待上限 20 秒，超时报「首字节超时」。

#### Scenario: 唯一后端连续失败
- **WHEN** 只配置了 cloud，且它已连续失败多次
- **THEN** 每次新请求仍会尝试 cloud

#### Scenario: 比 5 秒慢但在 20 秒内
- **WHEN** 唯一后端 8 秒后才出正文
- **THEN** 请求成功

### Requirement: 最后一个 provider 的对冲与重试
对最后一个 provider，系统 SHALL：
- 首发 3 秒内未出正文时，并发一个相同请求；
- 首发快速失败且第二个请求尚未发出时，立即补发；
- 以先出正文的请求为准，并中止另一个；
- 同一次调用最多两个请求；两个都失败时报错，合计超过 20 秒报「首字节超时」。

#### Scenario: 首发卡在排队
- **WHEN** 首发请求 10 秒才响应，对冲请求 1 秒响应
- **THEN** 约 4 秒拿到结果（来自对冲请求），首发请求被中止

#### Scenario: 上游不理会关闭思考的参数
- **WHEN** 首发请求持续输出思考心跳、迟迟不出正文，对冲请求很快出正文
- **THEN** 采用对冲请求的结果

#### Scenario: 首发立即失败
- **WHEN** 首发请求立即返回 502，补发请求成功
- **THEN** 调用成功

### Requirement: 云端请求关闭思考
发往云端（OpenAI 兼容接口）的请求 SHALL 默认带 `thinking: { "type": "disabled" }`。环境变量 `CLOUD_KEEP_THINKING=1` 时 MUST NOT 带该字段。

#### Scenario: 默认
- **WHEN** 未设置 `CLOUD_KEEP_THINKING`
- **THEN** 请求体包含 `"thinking":{"type":"disabled"}`

#### Scenario: 严格端点
- **WHEN** `CLOUD_KEEP_THINKING=1`
- **THEN** 请求体不包含 `thinking`

### Requirement: 配额检查与模型调用并发
`/api/translate` 与 `/api/explain` SHALL 同时发起「扣当日配额」与「调模型」。配额结果优先：超配额返回 429，并 MUST 中止已发出的模型请求；配额通过时再按模型结果返回成功或 503。调度器的结果 SHALL 提供 `cancel()`，在流尚未被读取时也能中止上游请求。

#### Scenario: 超配额
- **WHEN** 当日配额已用完
- **THEN** 返回 429，已到手的模型流被 `cancel()`

#### Scenario: 超配额且模型也失败
- **WHEN** 配额已用完且模型调用失败
- **THEN** 返回 429 而不是 503


## Why

阅读页上线后，一句话翻译要等近 10 秒，还时不时提示「翻译服务不可用」。实测定位到两个根因：

1. 线上唯一的云端模型 `DeepSeek-V4-Flash`（经聚合平台 aiping.cn）是推理模型，每句先输出 600–1300 字思考才出译文，首个译文字多等 1.4–5.7 秒。
2. 聚合平台把请求随机派给不同上游，排队时间多在 0.6–4 秒、偶发 10–17 秒。调度器以 5 秒首字节超时判失败、3 次失败熔断 5 分钟——而线上只有这一个后端、没有兜底，于是几次慢请求就被放大成 5 分钟的整段不可用。

## What Changes

- 云端请求默认带 `thinking: { type: "disabled" }`；设 `CLOUD_KEEP_THINKING=1` 可去掉该参数（给不认识它的严格端点用）。
- 调度器对**最后一个** provider（身后没有兜底）：
  - 不再因熔断被跳过；
  - 首字节超时从 5 秒放宽到 20 秒；
  - 3 秒内未出**第一个正文**（不把思考心跳算在内）就并发一个相同请求，先出正文者胜，另一个立即中止；首发快速失败时立即补发一次。最多两个并发请求。
- 身后还有兜底的 provider 保持原逻辑：5 秒首字节（心跳也算）、熔断、超时即降级。
- `/api/translate` 与 `/api/explain` 中「扣配额」与「调模型」改为并发，省一次数据库往返（0.4–0.75 秒）；超配额时中止已发出的模型请求。
- 调度器产出新增 `cancel()`，用于在一次都没读取流时中止上游。
- 不做：更换模型或平台、调整 Vercel 函数地区、合并中间件与路由的重复登录校验（另行评估）。

## Capabilities

### New Capabilities

- `translation-scheduling`：服务端调用 LLM 的调度规则——provider 顺序、首字节判定、熔断、超时、对冲与重试、请求参数、与配额检查的并发关系。

### Modified Capabilities

（无。）

## Impact

- **修改**：`src/lib/translate/scheduler.ts`、`src/lib/translate/cloud.ts`、`src/lib/translate/types.ts`（`TranslationStream.cancel`）、`src/app/api/translate/route.ts`、`src/app/api/explain/route.ts`。
- **新增**：`src/lib/translate/withQuota.ts`（`runWithQuota`）及测试、`src/lib/translate/cloud.test.ts`。
- **配置**：新增可选环境变量 `CLOUD_KEEP_THINKING`，默认不需要设置。
- **成本**：长尾请求偶尔会多花一次 token；超配额那次仍会发出一个随即被中止的模型请求。
- **数据库**：无变更。

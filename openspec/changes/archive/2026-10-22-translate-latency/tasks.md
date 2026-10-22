> 已全部实现并上线（8c591d8）。

## 1. 定位

- [x] 1.1 直连云端分段计时（响应头、首个思考、首个正文、总耗时），确认思考耗时与排队方差
- [x] 1.2 对比四种关闭思考的参数写法，确认 `thinking: { type: "disabled" }` 有效
- [x] 1.3 端到端分段计时（登录校验、扣配额、首字节、首个正文），发现上游不认参数的情况与配额串行开销

## 2. 实现（先写失败测试）

- [x] 2.1 `cloud.ts` 默认带 `thinking: disabled`，`CLOUD_KEEP_THINKING=1` 可关；`cloud.test.ts`
- [x] 2.2 调度器：最后一个 provider 不被熔断跳过、超时 `lastFirstByteTimeoutMs`（20s）
- [x] 2.3 调度器：最后一个 provider 的对冲（`hedgeAfterMs` 3s）、快速失败补发、先到者胜、落后者 abort、两次都未到报「首字节超时」
- [x] 2.4 调度器：最后一个 provider 按首个正文竞速，心跳不算到手
- [x] 2.5 `TranslationStream.cancel()`
- [x] 2.6 `withQuota.ts`：配额与模型并发、超配额 cancel、配额优先于模型错误；接入 `/api/translate` 与 `/api/explain`

## 3. 验证

- [x] 3.1 `npm test`（398 项）、`tsc --noEmit`、`npm run build` 通过
- [x] 3.2 本地端到端 16 句：全部成功，首个译文字中位数 2.95s、最大 5.8s
- [x] 3.3 推送、合并进 `worktree-translate-wordbook`、Vercel 部署；线上 `/api/translate` 未登录返回 401

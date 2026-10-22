## 1. 数据库

- [x] 1.1 新建 `supabase/migrations/0003_review_leftover.sql`：表 `review_leftover(user_id, wordbook_id, created_at)`，主键 `(user_id, wordbook_id)`，`wordbook_id` 外键 `on delete cascade`，开启 RLS 并加 `auth.uid() = user_id` 的 owner 策略
- [x] 1.2 同一迁移里加 `replace_review_leftover(p_ids uuid[])`（security invoker）：单事务删本人旧名单、插入属于本人的 wordbook id；`p_ids` 为空时抛错
- [x] 1.3 在 Supabase 执行迁移，用 E2E 测试账号验证 RLS（读不到他人名单、插不进他人的 wordbook id）

## 2. 纯逻辑（先写测试）

- [x] 2.1 `src/lib/review/cooldown.ts`：`MASTERED_COOLDOWN_MS`、`inCooldown(entry, now)`；测试覆盖满值 3 天/15 天、熟练度 4、时间戳为空或不可解析
- [x] 2.2 `src/lib/review/session.ts`：存档读写清除、3 天过期判断、`restore(saved, all)` 按 id 重建卡片并重新编号判定（剔除已删除词）；localStorage 访问全部 try/catch；测试覆盖删词重编号与过期
- [x] 2.3 `src/lib/review/outbox.ts`：入队（leftover 类只留最新一条）、按序冲刷、401 停止、其他 4xx 丢弃、5xx/网络异常保留；`fetch` 可注入以便测试
- [x] 2.4 `src/lib/review/leftover.ts`：`shouldSaveLeftover(kind, verdicts)`（仅 regular 且至少一个 false）与从 verdicts/queue 取生词 id 的函数；测试

## 3. 接口

- [x] 3.1 新增 `src/app/api/review/leftover/route.ts`：`GET` 返回 `{ ids, createdAt }`；`PUT { ids }` 校验非空 uuid 数组后调 `replace_review_leftover`
- [x] 3.2 `src/app/api/review/mark/route.ts` 接受可选 `reviewedAt`，在 [now-7d, now+1min] 内采用，否则用当前时间；补对应单测或路由测试

## 4. 复习页

- [x] 4.1 加 `roundKind` 状态：`start()` 为 regular，`repeatRound()` 为 repeat，新增 `startLeftover()` 为 leftover（全量出，收工线不生效，不过滤冷却）
- [x] 4.2 `start()` 在分批前过滤 `inCooldown` 的词；设置页显示冷却中词数
- [x] 4.3 加载时 `GET /api/review/leftover`，设置页在名单非空时显示「复习上一轮生词（N 个）」，N 只数仍在 `usable` 里的词
- [x] 4.4 结算（进入 done / 结束未完成轮次）时按 `shouldSaveLeftover` 决定是否 PUT 名单，失败进 outbox
- [x] 4.5 `commit()` 改为检查响应：成功结束，可重试失败入 outbox 并带 `reviewedAt`；保留本地同步计算
- [x] 4.6 复习页显示「N 条判定未保存」，401 时附重新登录链接；挂载、`online`、`focus` 时冲刷 outbox
- [x] 4.7 进行中轮次在换卡/改判后写存档，done 时清除；设置页存在存档时显示进度与「继续 / 结束这一轮」，过期存档自动结算
- [x] 4.8 更新设置页说明文案（冷却规则、上一轮生词只由常规复习覆盖）

## 5. 验证与上线

- [x] 5.1 `npm run lint`、`npm test` 全部通过
- [x] 5.2 用 E2E 测试账号手测（不得使用本人账号数据）：常规复习产生生词 → 只练生词答对几个 → 刷新后名单不变；中途刷新能继续；手动删 cookie 模拟过期后作答 → 提示未保存 → 重新登录后补写成功
- [x] 5.3 提交并 push，随后 `vercel --prod --scope dennisliu2015fgmailcoms-projects` 部署

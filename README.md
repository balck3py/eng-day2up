# 翻译 · 单词本

中英互译工具，翻译结果可直接沉淀为个人单词本并复习。

## 功能

- 中↔英互译，自动识别单词与段落
- 单词详情：美/英音标、发音、按词性分组的中文释义、考试标签
- 段落自动拆解难词，难度随个人单词本自适应（已掌握的词不再出现）
- 划词查询任意英文单词
- 单词本收藏、搜索、移除
- 顺序 / 随机翻卡复习

## 架构

- **前端 + 服务端**：Next.js App Router @ Vercel
- **数据 + 认证**：Supabase（Postgres + Auth + RLS）
- **词典层**：ECDICT 高频子集 + dictionaryapi.dev 音标（带缓存）
- **翻译**：本机 ollama 主用（经 frpc + Caddy 暴露），OpenAI 兼容接口兜底

词典层与 LLM 层完全解耦 —— 翻译后端全部不可用时，单词查询、单词本与复习功能照常工作。

## 开发

```bash
npm install
cp .env.local.example .env.local   # 填入实际值
npx supabase db push               # 应用数据库迁移
npm run import:ecdict              # 导入词典（需先下载 data/stardict.csv）
npm run dev
```

## 测试

```bash
npm test           # 单元测试（Vitest）
npm run test:e2e   # 端到端测试（Playwright，需翻译后端可用，
                   # 并在 .env.local 配置 E2E_EMAIL / E2E_PASSWORD）
```

## 文档

- 设计文档：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- 基础设施：`docs/infra/hardening.md`

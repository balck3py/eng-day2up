# 划词查词（桌面客户端）

Windows 托盘常驻的小工具：在任意程序里选中英文，按全局快捷键（默认 `Ctrl+Alt+Space`），光标旁弹出词卡或译文，一键收藏到网页版的同一个单词本，并带上该词所在的句子。

- 平时不介入：不监听剪贴板、不装鼠标钩子，只在按快捷键时读取选区。
- 选区读取：先走 UI Automation（能拿到所在段落），失败再模拟 Ctrl+C，读完一定把原剪贴板恢复。
- 与网页代码完全解耦：直连 Supabase（RLS 隔离），不调用网页 API，不 import 网页代码。
- 资源：空闲时只有 Rust 主进程；弹窗关闭只是隐藏，闲置超时后销毁 WebView。

设计见 `openspec/changes/desktop-quick-lookup/`。

## 目录

```
desktop/
  popup.html / settings.html   两个前端入口
  src/lib/                     纯逻辑（切句、查词、难词、收藏、LLM 流式解析）+ Vitest
  src/popup/  src/settings/    界面（React + Tailwind v4）
  src/it/                      集成测试（真实 Supabase，测试账号，默认跳过）
  src-tauri/                   Rust 主进程：托盘、快捷键、选区读取、窗口管理
```

## 开发

前置：Node 24、Rust stable（MSVC 工具链）、VS 生成工具里的「使用 C++ 的桌面开发」、WebView2（Win11 自带）。

```powershell
cd desktop
npm install
npm test                 # 前端纯逻辑测试
npm run tauri dev        # 启动托盘（不弹窗口；托盘菜单 → 设置）
cd src-tauri; cargo test # Rust 平台无关部分的单元测试
```

不启动 Tauri 也能调界面：`npm run dev` 后浏览器打开 `http://localhost:1420/popup.html`，顶部有「模拟选区」面板；设置页在 `/settings.html`（浏览器里设置存 localStorage）。

### 集成测试

只能用 E2E 测试账号。复制 `.env.example` 为 `.env.local` 填写（或沿用仓库根目录的 `.env.local`），然后：

```powershell
npm run test:it
```

测试会先校验登录邮箱等于 `E2E_EMAIL`，只插入/删除 `zzqa` 开头的测试词。

## 配置（设置窗口）

| 字段 | 说明 |
|---|---|
| Supabase URL / anon key | 与网页同一个项目。anon key 是公开值；客户端里绝不放 service_role key |
| 邮箱 + 密码 | 用现有账号登录一次。密码不落盘，只保留 supabase-js 的 session（自动刷新） |
| LLM baseUrl / model / apiKey / prompt | OpenAI 兼容端点，如 ollama `http://localhost:11434/v1`、LM Studio `http://localhost:1234/v1`。未配置时文本模式只显示难词 |
| 全局快捷键 | 格式如 `Ctrl+Alt+Space`。被占用时提示并保留原快捷键 |
| 难词熟练度阈值 | 单词本里熟练度 ≥ 此值的词不再列为难词，默认 4 |
| 闲置销毁分钟数 | 弹窗隐藏后多久销毁 WebView，默认 10 |
| 开机自启 | 登录 Windows 后以托盘启动，不弹窗口 |

非敏感配置与 apiKey 存在 `%APPDATA%\uno.eugen.eng-day2up.desktop\settings.json`，不进仓库。

## Windows 构建

```powershell
cd desktop
npm install
npm run tauri build
```

安装包在 `src-tauri/target/release/bundle/nsis/`。未做代码签名，首次运行 SmartScreen 会提示，选「仍要运行」。

## ADDED Requirements

### Requirement: 与网页代码隔离
客户端代码 SHALL 全部位于仓库 `desktop/` 目录，SHALL NOT import 网页 `src/` 下的任何模块，SHALL NOT 调用网页的任何 HTTP 接口或加载网页页面；网页的构建、类型检查、lint、测试与 Vercel 部署 SHALL 排除 `desktop/`。

#### Scenario: 网页构建不受影响
- **WHEN** 在仓库根目录运行 `npm run build`、`npm run lint`、`npm test`
- **THEN** 不扫描、不编译 `desktop/` 下任何文件，结果与引入客户端前一致

#### Scenario: 客户端无网页依赖
- **WHEN** 检索 `desktop/` 下的源码
- **THEN** 不存在指向 `../src`、`@/` 网页别名或网页域名 API 的引用

### Requirement: 托盘常驻与单实例
客户端 SHALL 以托盘图标常驻，菜单至少包含「设置」「暂停快捷键」「退出」；重复启动 SHALL 只保留一个实例，并把第二次启动转为打开设置窗口。

#### Scenario: 重复启动
- **WHEN** 客户端已运行时再次双击启动
- **THEN** 不产生第二个进程，已有实例打开设置窗口

#### Scenario: 暂停
- **WHEN** 用户在托盘选择「暂停快捷键」
- **THEN** 快捷键被注销，按下不再有反应，直到恢复

### Requirement: 设置项
设置窗口 SHALL 提供：Supabase URL 与 anon key、邮箱 + 密码登录/登出（显示当前登录邮箱）、LLM `baseUrl` / `model` / `apiKey`（可选）/ 自定义 prompt（可选）、全局快捷键、难词熟练度阈值（默认 4）、闲置销毁分钟数（默认 10）、开机自启开关。密码 SHALL NOT 落盘；仓库 SHALL NOT 包含任何真实配置值。

#### Scenario: 登录
- **WHEN** 填入 Supabase 配置与正确账号密码点击登录
- **THEN** 显示当前登录邮箱，之后重启客户端无需再次登录

#### Scenario: 快捷键被占用
- **WHEN** 设置的快捷键注册失败
- **THEN** 设置页与托盘提示「快捷键被占用」，保留旧快捷键不变

### Requirement: 资源占用策略
空闲时客户端 SHALL 不保留任何弹窗 WebView：弹窗关闭后仅隐藏，闲置超过设定分钟数后销毁；设置窗口关闭即销毁。

#### Scenario: 闲置释放
- **WHEN** 最后一次使用后超过闲置分钟数
- **THEN** 弹窗窗口被销毁，下次快捷键触发时重新创建并正常工作

### Requirement: 开机自启
用户开启「开机自启」后，客户端 SHALL 在 Windows 登录后自动以托盘形式启动，不弹出任何窗口。

#### Scenario: 重启电脑
- **WHEN** 开启自启后重启 Windows 并登录
- **THEN** 托盘出现图标，无窗口弹出，快捷键可用

### Requirement: 写库测试只用测试账号
任何会写入 Supabase 的自动化测试 SHALL 在登录后断言当前用户邮箱等于环境变量 `E2E_EMAIL`，不一致立即中止；SHALL 只插入并只删除以 `zzqa` 开头的测试词；默认跳过，仅在 `DESKTOP_IT=1` 时运行。

#### Scenario: 身份不符
- **WHEN** 集成测试登录后的邮箱与 `E2E_EMAIL` 不一致
- **THEN** 测试立即失败退出，未执行任何写操作

#### Scenario: 清理范围
- **WHEN** 集成测试结束
- **THEN** 仅删除当前测试用户下 `word_key` 以 `zzqa` 开头的行

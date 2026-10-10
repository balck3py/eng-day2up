## ADDED Requirements

### Requirement: 仅由全局快捷键触发
客户端 SHALL 只在用户按下已注册的全局快捷键时读取选区并弹窗。客户端 SHALL NOT 监听剪贴板变化、SHALL NOT 在选区旁显示任何图标或浮层、SHALL NOT 安装全局鼠标钩子。

#### Scenario: 普通选中不触发
- **WHEN** 用户在任意程序中选中文本、复制、删除，但未按快捷键
- **THEN** 客户端无任何可见反应，剪贴板不被读取

#### Scenario: 快捷键触发
- **WHEN** 用户选中文本后按下快捷键
- **THEN** 客户端读取选区并弹出窗口

### Requirement: UIA 优先读取选区与段落
触发时客户端 SHALL 先通过 UI Automation TextPattern 读取焦点元素的选中文本，并扩展到所在段落，返回 `{ text, paragraph, offset, rect, source: 'uia' }`，其中 `offset` 为选中文本在 `paragraph` 中的起始下标。

#### Scenario: Word 桌面版
- **WHEN** 在 Word 桌面版某段落中选中一个单词并触发
- **THEN** 返回该单词、整段文本、正确的偏移量，`source = 'uia'`

#### Scenario: 选区跨段
- **WHEN** 选区跨越多个段落
- **THEN** `paragraph` 为 null，`text` 为完整选中文本

### Requirement: 剪贴板兜底且必须恢复
UIA 不可用、超时或得到空文本时，客户端 SHALL 等待修饰键松开后模拟 Ctrl+C 读取文本，并 SHALL 在读取结束后（无论成功失败）把剪贴板恢复为触发前的内容；此路径 `paragraph = null`，`source = 'clipboard'`。

#### Scenario: 剪贴板被恢复
- **WHEN** 剪贴板原有内容为 `"ABC"`，在不支持 UIA 的程序中选中 `"word"` 并触发
- **THEN** 弹窗显示 `word`，且操作结束后剪贴板内容仍为 `"ABC"`

#### Scenario: 复制未生效
- **WHEN** 模拟 Ctrl+C 后 300ms 内剪贴板序列号未变化
- **THEN** 视为未读取到选区，剪贴板保持原样

### Requirement: 不改动原程序的选区与内容
客户端 SHALL NOT 为获取上下文而模拟任何改变选区、光标位置或文档内容的按键（如 Shift+方向键、Ctrl+A）。

#### Scenario: 触发后原选区不变
- **WHEN** 用户触发并关闭弹窗
- **THEN** 原程序中的选区与光标位置与触发前一致

### Requirement: 读取不阻塞且有超时
选区读取 SHALL 在独立线程执行，UIA 阶段超时 800ms，整次读取（含兜底）超时 1500ms；超时后放弃并提示，快捷键监听与托盘不受影响。

#### Scenario: 目标程序无响应
- **WHEN** 前台程序挂起导致 UIA 调用阻塞
- **THEN** 800ms 后转剪贴板兜底，最终在 1500ms 内给出结果或「未读取到选中内容」提示

### Requirement: 空选区提示
没有读取到任何选中文本时，客户端 SHALL 在弹窗中提示「未读取到选中内容」，并 SHALL NOT 发起查词或翻译请求。

#### Scenario: 无选区按快捷键
- **WHEN** 未选中任何文本就按快捷键
- **THEN** 弹窗只显示提示，不产生网络请求

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { FetchLike } from './llm'
import type { Selection } from './types'

/** 与 Rust 主进程的全部交互集中在这里；浏览器开发模式下都是空操作。 */

/** LLM 请求走 tauri-plugin-http（Rust 代发，无 CORS / 混合内容限制）。 */
export const httpFetch: FetchLike = (url, init) =>
  isTauri() ? tauriFetch(url, init) : fetch(url, init)

/** 订阅选区：先取一次窗口创建前就已读到的那份，再监听之后的触发。 */
export async function onSelection(cb: (s: Selection) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const unlisten = await listen<Selection>('selection', (e) => cb(e.payload))
  const latest = await invoke<Selection | null>('take_selection')
  if (latest) cb(latest)
  return unlisten
}

/** 隐藏弹窗并把焦点还给触发前的窗口。 */
export function hidePopup(): Promise<void> {
  return isTauri() ? invoke('hide_popup') : Promise.resolve()
}

export function openSettings(): Promise<void> {
  return isTauri() ? invoke('open_settings') : Promise.resolve()
}

/** 注册新快捷键；失败（被占用、格式不对）时抛出，旧快捷键保持不变。 */
export function applyShortcut(accelerator: string): Promise<void> {
  return isTauri() ? invoke('apply_shortcut', { accelerator }) : Promise.resolve()
}

/** 当前快捷键是否注册成功（启动时可能被占用）。 */
export function shortcutError(): Promise<string | null> {
  return isTauri() ? invoke<string | null>('shortcut_error') : Promise.resolve(null)
}

import { isTauri } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import type { LlmConfig } from './llm'

/**
 * 设置项。Tauri 里存 tauri-plugin-store 的 settings.json（Rust 侧也读其中的
 * shortcut / idleDestroyMinutes）；浏览器开发模式下退回 localStorage。
 * 密码不在这里：登录后只有 supabase-js 自己保存的 refresh token。
 */
export interface Settings {
  supabaseUrl: string
  supabaseAnonKey: string
  llmBaseUrl: string
  llmModel: string
  llmApiKey: string
  llmPrompt: string
  shortcut: string
  threshold: number
  idleDestroyMinutes: number
}

export const DEFAULT_SETTINGS: Settings = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  llmBaseUrl: '',
  llmModel: '',
  llmApiKey: '',
  llmPrompt: '',
  shortcut: 'Ctrl+Alt+Space',
  threshold: 4,
  idleDestroyMinutes: 10,
}

const FILE = 'settings.json'
const LS_KEY = 'desktop-settings'

export async function loadSettings(): Promise<Settings> {
  if (!isTauri()) {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
  const store = await load(FILE, { defaults: {}, autoSave: false })
  const out = { ...DEFAULT_SETTINGS }
  for (const k of Object.keys(out) as (keyof Settings)[]) {
    const v = await store.get(k)
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export async function saveSettings(s: Settings): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
    return
  }
  const store = await load(FILE, { defaults: {}, autoSave: false })
  for (const [k, v] of Object.entries(s)) await store.set(k, v)
  await store.save()
}

export function llmConfigOf(s: Settings): LlmConfig | null {
  if (!s.llmBaseUrl.trim() || !s.llmModel.trim()) return null
  return {
    baseUrl: s.llmBaseUrl.trim(),
    model: s.llmModel.trim(),
    apiKey: s.llmApiKey.trim() || undefined,
    prompt: s.llmPrompt.trim() || undefined,
  }
}

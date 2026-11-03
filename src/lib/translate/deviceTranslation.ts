import type { LocalModelConfig } from './localModel'

export type RequestSource = 'vercel' | 'device'
export interface DeviceModelConfig extends LocalModelConfig { disableThinking: boolean }
export class DeviceTranslationError extends Error {}

const STORAGE_KEY = 'translationRequestSource'
const CONFIG_STORAGE_KEY = 'deviceTranslationConfig'
const listeners = new Set<() => void>()
let memorySource: RequestSource | null = null
let cached: DeviceModelConfig | null = null
let pending: Promise<DeviceModelConfig> | null = null
let controller: AbortController | null = null
let generation = 0

export function getRequestSource(): RequestSource {
  if (typeof window === 'undefined') return 'vercel'
  if (memorySource) return memorySource
  try { return localStorage.getItem(STORAGE_KEY) === 'device' ? 'device' : 'vercel' }
  catch { return 'vercel' }
}
export function getRequestSourceServer(): RequestSource { return 'vercel' }

function invalidateDeviceConfig() {
  ++generation
  controller?.abort()
  controller = null; pending = null; cached = null
}

export function clearDeviceConfig() {
  invalidateDeviceConfig()
  try { localStorage.removeItem(CONFIG_STORAGE_KEY) } catch { /* Storage may be unavailable. */ }
}

export function setRequestSource(source: RequestSource) {
  memorySource = source
  try { localStorage.setItem(STORAGE_KEY, source) } catch { /* Keep the choice for this tab. */ }
  clearDeviceConfig()
  listeners.forEach((listener) => listener())
}

function storage(event: StorageEvent) {
  if (event.key === CONFIG_STORAGE_KEY) { invalidateDeviceConfig(); return }
  if (event.key !== STORAGE_KEY && event.key !== null) return
  memorySource = null
  if (event.key === null || getRequestSource() !== 'device') clearDeviceConfig()
  else invalidateDeviceConfig()
  listeners.forEach((listener) => listener())
}
export function subscribeRequestSource(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', storage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', storage)
  }
}

// Cancelling one translation must not cancel another caller's configuration preload.
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function parseConfig(value: unknown): DeviceModelConfig | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (typeof body.baseUrl !== 'string' || typeof body.model !== 'string' || typeof body.apiKey !== 'string' || !body.model.trim() || !body.apiKey.trim()) return null
  try {
    const url = new URL(body.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password) return null
  } catch { return null }
  return { baseUrl: body.baseUrl, model: body.model, apiKey: body.apiKey, disableThinking: body.disableThinking === true }
}

export async function getDeviceConfig(signal?: AbortSignal): Promise<DeviceModelConfig> {
  signal?.throwIfAborted()
  if (cached) return cached
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (stored) {
      const config = parseConfig(JSON.parse(stored))
      if (!config) throw new Error('Invalid cached config')
      cached = config
      return config
    }
  } catch {
    try { localStorage.removeItem(CONFIG_STORAGE_KEY) } catch { /* Use memory when storage is unavailable. */ }
  }
  if (!pending) {
    const version = generation
    const aborter = new AbortController()
    controller = aborter
    const load = (async () => {
      const response = await fetch('/api/translate/config', { cache: 'no-store', signal: aborter.signal })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) clearDeviceConfig()
        throw new DeviceTranslationError(body.error ?? '无法获取设备翻译配置')
      }
      const config = parseConfig(body)
      if (!config) throw new DeviceTranslationError('设备翻译配置无效，请切回 Vercel')
      if (version !== generation) throw new DOMException('Aborted', 'AbortError')
      cached = config
      try { localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config)) } catch { /* Keep using the in-memory config. */ }
      return config
    })()
    pending = load
    const settled = () => { if (pending === load) { pending = null; controller = null } }
    void load.then(settled, settled)
  }
  return withAbort(pending, signal)
}

import type { LocalModelConfig } from './localModel'

export type RequestSource = 'vercel' | 'device'
export interface DeviceModelConfig extends LocalModelConfig { disableThinking: boolean }
export class DeviceTranslationError extends Error {}

const STORAGE_KEY = 'translationRequestSource'
const listeners = new Set<() => void>()
let memorySource: RequestSource | null = null
let cached: { config: DeviceModelConfig; expires: number } | null = null
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

export function clearDeviceConfig() {
  ++generation
  controller?.abort()
  controller = null; pending = null; cached = null
}

export function setRequestSource(source: RequestSource) {
  memorySource = source
  try { localStorage.setItem(STORAGE_KEY, source) } catch { /* Keep the choice for this tab. */ }
  clearDeviceConfig()
  listeners.forEach((listener) => listener())
}

function storage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return
  memorySource = null
  clearDeviceConfig()
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

export async function getDeviceConfig(signal?: AbortSignal): Promise<DeviceModelConfig> {
  signal?.throwIfAborted()
  if (cached && cached.expires > Date.now()) return cached.config
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
      if (typeof body.baseUrl !== 'string' || typeof body.model !== 'string' || typeof body.apiKey !== 'string' || !body.model || !body.apiKey || new URL(body.baseUrl).protocol !== 'https:') {
        throw new DeviceTranslationError('设备翻译配置无效，请切回 Vercel')
      }
      const config: DeviceModelConfig = { baseUrl: body.baseUrl, model: body.model, apiKey: body.apiKey, disableThinking: body.disableThinking === true }
      if (version !== generation) throw new DOMException('Aborted', 'AbortError')
      // The key only lives in memory, never in localStorage or an HTTP cache.
      cached = { config, expires: Date.now() + 5 * 60_000 }
      return config
    })()
    pending = load
    const settled = () => { if (pending === load) { pending = null; controller = null } }
    void load.then(settled, settled)
  }
  return withAbort(pending, signal)
}

/** Keep the existing daily quota; this endpoint never forwards the model request. */
export async function authorizeDeviceRequest(signal?: AbortSignal) {
  signal?.throwIfAborted()
  const response = await fetch('/api/translate/config', { method: 'POST', cache: 'no-store', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) clearDeviceConfig()
    throw new DeviceTranslationError(body.error ?? '设备翻译授权失败，请重试')
  }
}

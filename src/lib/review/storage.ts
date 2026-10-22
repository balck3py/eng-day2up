/** localStorage 的最小子集，方便测试时换成内存实现。 */
export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * 拿浏览器的 localStorage。服务端渲染、隐私模式、被禁用时访问器本身就可能
 * 抛错 —— 一律返回 null，调用方按「没有存档」处理。
 */
export function browserStorage(): KV | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readJson(kv: KV | null, key: string): unknown {
  if (!kv) return null
  try {
    const raw = kv.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeJson(kv: KV | null, key: string, value: unknown): void {
  if (!kv) return
  try {
    kv.setItem(key, JSON.stringify(value))
  } catch {
    // 配额满或被禁用：丢的只是本地便利，不影响复习本身
  }
}

export function removeKey(kv: KV | null, key: string): void {
  if (!kv) return
  try {
    kv.removeItem(key)
  } catch {
    // 同上
  }
}

/** 测试用的内存实现 */
export function memoryStorage(): KV {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

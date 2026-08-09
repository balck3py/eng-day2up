import { createOllamaProvider } from './ollama'
import { createCloudProvider } from './cloud'
import { createScheduler, type Scheduler } from './scheduler'
import type { TranslationProvider } from './types'

/**
 * 进程内单例 —— 熔断状态需要跨请求保留。
 * 同一个 Vercel 函数实例内共享；实例之间不共享，最坏情况是每个新实例
 * 多试探一次挂掉的后端，可接受。
 */
let instance: Scheduler | null = null

export function getScheduler(): Scheduler {
  if (instance) return instance
  const providers: TranslationProvider[] = []
  // 顺序即优先级：ollama 主用，云端兜底。未配置的会在构造阶段抛异常，
  // 在这里被跳过 —— 目前 ollama 未配置，实际只有云端一个。
  for (const make of [createOllamaProvider, createCloudProvider]) {
    try {
      providers.push(make())
    } catch (e) {
      console.warn('provider 未配置，跳过:', (e as Error).message)
    }
  }
  if (providers.length === 0) throw new Error('没有可用的翻译后端配置')
  instance = createScheduler(providers)
  return instance
}

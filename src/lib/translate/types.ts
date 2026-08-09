export type Direction = 'en2zh' | 'zh2en'
export type ProviderName = 'ollama' | 'cloud'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/** 翻译后端的统一接口。两个实现共用同一套 prompt 与输出契约。 */
export interface TranslationProvider {
  readonly name: ProviderName
  /**
   * 逐块产出文本增量。抛异常表示该 provider 不可用。
   *
   * `signal` 由调度器注入：首字节超时后光丢弃迭代器是不够的 —— 生成器
   * 若正卡在 `await fetch()` 上，`return()` 要等这个 await 落地才生效，
   * 挂掉的后端会把连接一直挂着。abort 才能真正掐断。
   */
  stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<string>
}

/** 调度器的产出：已确定 provider，且首字节已到手。 */
export interface TranslationStream {
  provider: ProviderName
  chunks: AsyncIterable<string>
}

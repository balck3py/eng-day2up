export type Direction = 'en2zh' | 'zh2en'
export type ProviderName = 'ollama' | 'cloud'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/** 翻译后端的统一接口。两个实现共用同一套 prompt 与输出契约。 */
export interface TranslationProvider {
  readonly name: ProviderName
  /** 逐块产出文本增量。抛异常表示该 provider 不可用。 */
  stream(messages: ChatMessage[]): AsyncIterable<string>
}

/** 调度器的产出：已确定 provider，且首字节已到手。 */
export interface TranslationStream {
  provider: ProviderName
  chunks: AsyncIterable<string>
}

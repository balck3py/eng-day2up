/** 分词性的一条中文释义。 */
export interface Sense {
  /** 词性缩写，如 'n.' 'vt.'；无法识别时为空串。 */
  pos: string
  meaning: string
}

/** 词典查询的命中来源。客户端不做 AI 回写，没有 'ai'。 */
export type MatchSource = 'exact' | 'lemma' | 'suffix' | 'none'

/** 单词查询结果（网页 WordDetail 的子集）。 */
export interface WordDetail {
  /** 用户选中的原始词形 */
  query: string
  /** 实际命中的词（可能是原型） */
  word: string
  matchedFrom: MatchSource
  phoneticUs: string | null
  phoneticUk: string | null
  /** ECDICT 单一音标，美/英都缺时的保底 */
  phonetic: string | null
  senses: Sense[]
  tags: string[]
  collins: number | null
  oxford: boolean
}

/** Rust 发来的选区。paragraph/offset 只有 UIA 路径才有。 */
export interface Selection {
  seq: number
  text: string
  paragraph: string | null
  offset: number | null
  source: 'uia' | 'clipboard' | 'none'
}

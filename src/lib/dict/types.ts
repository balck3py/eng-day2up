/** ECDICT stardict.csv 一行的原始形态，所有字段均为字符串。 */
export interface EcdictRow {
  word: string
  phonetic: string
  definition: string
  translation: string
  pos: string
  collins: string
  oxford: string
  tag: string
  bnc: string
  frq: string
  exchange: string
}

/** 分词性的一条中文释义。 */
export interface Sense {
  /** 词性缩写，如 'n.' 'vt.'；无法识别时为空串。 */
  pos: string
  meaning: string
}

/** 词形 → 原型的映射对，两侧均为小写。 */
export interface LemmaPair {
  form: string
  lemma: string
}

/** 美/英分离的音标与发音音频。 */
export interface PhoneticSet {
  phoneticUs: string | null
  phoneticUk: string | null
  audioUs: string | null
  audioUk: string | null
}

/** 词典查询的命中来源。 */
export type MatchSource = 'exact' | 'lemma' | 'suffix' | 'none'

/** 单词查询的完整结果。 */
export interface WordDetail {
  /** 用户原始输入 */
  query: string
  /** 实际命中的词（可能是原型） */
  word: string
  matchedFrom: MatchSource
  /** ECDICT 单一音标，作为美/英音标缺失时的保底显示 */
  phonetic: string | null
  phoneticUs: string | null
  phoneticUk: string | null
  audioUs: string | null
  audioUk: string | null
  senses: Sense[]
  /** 考试标签，如 ['cet4', 'ielts'] */
  tags: string[]
  /** 柯林斯星级 1-5，无则 null */
  collins: number | null
  oxford: boolean
}

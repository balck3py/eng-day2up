export interface ScoreInput {
  key: string
  /** 在原文中的出现序号 */
  index: number
  frq: number | null
  bnc: number | null
  oxford: number | null
  collins: number | null
  /** 是否在 dict_entries 中 */
  inDict: boolean
  /** 用户单词本中的熟练度；null 表示未收藏 */
  familiarity: number | null
}

const NOT_IN_DICT_SCORE = 1000
const UNKNOWN_RANK = 20000
const RANK_DIVISOR = 50
const RANK_CAP = 500
const MASTERED_THRESHOLD = 4
const SAVED_BOOST = 200

/**
 * 计算难度分。返回 -1 表示应当排除（用户已掌握）。
 * 全程只用词频数据与用户熟练度，不调用 LLM。
 */
export function scoreWord(input: ScoreInput): number {
  if (input.familiarity !== null && input.familiarity >= MASTERED_THRESHOLD) {
    return -1
  }

  let score: number
  if (!input.inDict) {
    score = NOT_IN_DICT_SCORE
  } else {
    const ranks = [input.frq, input.bnc].filter(
      (r): r is number => typeof r === 'number' && r > 0,
    )
    const rank = ranks.length > 0 ? Math.min(...ranks) : UNKNOWN_RANK
    score = Math.min(rank / RANK_DIVISOR, RANK_CAP)

    if ((input.oxford ?? 0) > 0) score -= 100
    if ((input.collins ?? 0) >= 4) score -= 80
    else if (input.collins === 3) score -= 40
  }

  if (input.familiarity !== null) score += SAVED_BOOST
  return score
}

/** 取分值最高的 limit 个，再按原文出现顺序返回。 */
export function selectHardWords(inputs: ScoreInput[], limit: number): ScoreInput[] {
  return inputs
    .map((i) => ({ item: i, score: scoreWord(i) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.item.index - b.item.index)
    .map((s) => s.item)
}

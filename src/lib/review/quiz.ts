import { prng } from './prng'

export type QuizType = 'en2cn' | 'cn2en'

/** 一张待复习的卡：词条本身 + 这一轮要考的题型。 */
export interface ReviewCard<T> {
  item: T
  type: QuizType
}

/**
 * 按 cnRatio（0-100，中译英占比）给每张卡随机分配题型。
 *
 * 被分到中译英但 canAskCn 为假的卡直接剔除 —— 中译英的题面就是中文释义，
 * 没有释义就没有题面。只在「抽中中译英」时才剔除，所以 cnRatio = 0 时
 * 一个词都不会丢，行为与加这个功能之前完全一致。
 *
 * 剔除会让实际交付的比例偏离设定值，这是有意的；调用方负责把跳过的数量
 * 显示给用户，否则数字对不上会让人困惑。
 */
export function assignQuizTypes<T>(
  items: T[],
  cnRatio: number,
  canAskCn: (item: T) => boolean,
  seed: number,
): ReviewCard<T>[] {
  const ratio = Math.min(Math.max(cnRatio, 0), 100) / 100
  const rand = prng(seed)
  const out: ReviewCard<T>[] = []
  for (const item of items) {
    // 每张卡都消费一个随机数，与它最终是否被剔除无关 —— 否则剔除会让
    // 后续卡片的分配随之漂移，同种子不再可复现。
    const wantsCn = rand() < ratio
    if (!wantsCn) out.push({ item, type: 'en2cn' })
    else if (canAskCn(item)) out.push({ item, type: 'cn2en' })
  }
  return out
}

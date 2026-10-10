import { prng } from './prng'

export type QuizType = 'en2cn' | 'cn2en'

/** 一张待复习的卡：词条本身 + 这一轮要考的题型。 */
export interface ReviewCard<T> {
  item: T
  type: QuizType
}

/** 决定一张卡能出什么题型的三条判据。 */
export interface QuizRules<T> {
  /** 有中文释义吗 —— 中译英的题面就是释义，没释义就出不了这道题 */
  canAskCn: (item: T) => boolean
  /** 从没背过吗（第一次背） */
  isFirstEver: (item: T) => boolean
  /** 还欠着拼写练习吗 */
  owesSpelling: (item: T) => boolean
}

/**
 * 给每张卡定题型。三条规则按优先级来：
 *
 * 1. 第一次背的词只出英译中 —— 还没见过的词，让人凭空拼出来是没有意义的。
 *    这条压过拼写欠账：新词天然欠着两次，但欠账得从第二面开始还。
 * 2. 欠拼写的词强制中译英 —— 每个生词至少要拼对 SPELL_QUOTA 次，这是硬保证，
 *    光靠比例随机撞不出保证来。没有中文释义的词出不了这道题，只能放它过去。
 * 3. 其余的按 cnRatio（0-100，中译英占比）随机分配。
 *
 * 被分到中译英但 canAskCn 为假的卡直接剔除 —— 没有释义就没有题面。只在
 * 「随机抽中中译英」时才剔除，所以 cnRatio = 0 时一个词都不会丢。
 *
 * 剔除会让实际交付的比例偏离设定值，强制规则也会；这是有意的。调用方负责把
 * 跳过的数量和「比例只管没被强制的词」显示给用户，否则数字对不上会让人困惑。
 */
export function assignQuizTypes<T>(
  items: T[],
  cnRatio: number,
  rules: QuizRules<T>,
  seed: number,
): ReviewCard<T>[] {
  const ratio = Math.min(Math.max(cnRatio, 0), 100) / 100
  const rand = prng(seed)
  const out: ReviewCard<T>[] = []
  for (const item of items) {
    // 每张卡都消费一个随机数，与它最终走哪条规则无关 —— 否则强制或剔除会让
    // 后续卡片的分配随之漂移，同种子不再可复现。
    const wantsCn = rand() < ratio
    if (rules.isFirstEver(item)) out.push({ item, type: 'en2cn' })
    else if (rules.owesSpelling(item) && rules.canAskCn(item)) out.push({ item, type: 'cn2en' })
    else if (!wantsCn) out.push({ item, type: 'en2cn' })
    else if (rules.canAskCn(item)) out.push({ item, type: 'cn2en' })
  }
  return out
}

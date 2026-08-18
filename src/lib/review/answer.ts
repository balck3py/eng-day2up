import { normalizeWord } from '@/lib/text/normalize'

/**
 * 中译英作答判定：宽松匹配 —— 忽略大小写、首尾空格与首尾标点；
 * 词内的撇号与连字符必须一致，词形变化与拼写误差一律判错（本题型就是拼写训练）。
 *
 * 空输入永远判错：异常词条归一化后也可能是空串，不能让两个空串互相匹配。
 */
export function isAnswerCorrect(input: string, word: string): boolean {
  const got = normalizeWord(input)
  if (got === '') return false
  return got === normalizeWord(word)
}

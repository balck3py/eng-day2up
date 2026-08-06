import type { EcdictRow } from './types'

function toInt(v: string): number {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * 判断一条 ECDICT 记录是否进入高频子集。
 * 保留满足任一条件者：进入词频榜、柯林斯星级词、牛津核心词、带考试标签。
 * 其余生僻词由在线词典 API 与 LLM 兜底，不入库。
 */
export function shouldImport(row: EcdictRow): boolean {
  if (!row.word || !row.word.trim()) return false
  return (
    toInt(row.frq) > 0 ||
    toInt(row.bnc) > 0 ||
    toInt(row.collins) > 0 ||
    toInt(row.oxford) > 0 ||
    row.tag.trim() !== ''
  )
}

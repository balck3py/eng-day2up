/**
 * 轮次类型。只有 regular（设置页点「开始」的常规复习）结算时会覆盖上一轮生词名单；
 * 重练（repeat）与复习上一轮生词（leftover）怎么答都不动名单 —— 名单是那一轮的
 * 完整快照，后面记住了几个也不减。
 */
export type RoundKind = 'regular' | 'leftover' | 'repeat'

/** 本轮判定为「不认识」的词 id，按出卡顺序、去重 */
export function unknownIds(
  verdicts: Record<number, boolean>,
  cards: { item: { id: string } }[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const indices = Object.keys(verdicts).map(Number).sort((a, b) => a - b)
  for (const i of indices) {
    if (verdicts[i] !== false) continue
    const id = cards[i]?.item.id
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** 结算时要不要覆盖名单：常规复习、且至少一个生词。零生词保留上一份名单。 */
export function shouldSaveLeftover(kind: RoundKind, verdicts: Record<number, boolean>): boolean {
  return kind === 'regular' && Object.values(verdicts).some((v) => v === false)
}

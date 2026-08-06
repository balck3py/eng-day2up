/**
 * 生成一个词可能的原型候选，供 dict_lemma 未命中时批量查库。
 * 宁可多给候选也不要漏 —— 调用方会用一次 IN 查询筛掉不存在的。
 * 返回结果不含原词本身。
 */
export function stripSuffixCandidates(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>()
  const add = (s: string) => {
    if (s.length >= 2 && s !== w) out.add(s)
  }

  if (w.endsWith('ies') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es') && w.length > 3) add(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) add(w.slice(0, -1))

  if (w.endsWith('ed') && w.length > 4) {
    add(w.slice(0, -2))       // worked → work
    add(w.slice(0, -1))       // loved  → love
  }

  if (w.endsWith('ing') && w.length > 5) {
    const b = w.slice(0, -3)
    add(b)                    // working → work
    add(b + 'e')              // making  → make
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) {
      add(b.slice(0, -1))     // running → run
    }
  }

  if (w.endsWith('ily') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ly') && w.length > 4) add(w.slice(0, -2))

  if (w.endsWith('est') && w.length > 5) {
    add(w.slice(0, -3))
    add(w.slice(0, -3) + 'e')
  }
  if (w.endsWith('er') && w.length > 4) {
    add(w.slice(0, -2))
    add(w.slice(0, -1))
  }

  return [...out]
}

/**
 * 生成一个词可能的原型候选，供 dict_lemma 未命中时批量查库。
 * 宁可多给候选也不要漏 —— 调用方会用一次 IN 查询筛掉不存在的。
 * 返回结果不含原词本身。
 *
 * 顺序是有意义的：候选按"语言学上更可能是原型"降序排列，调用方应优先
 * 采用排在前面、且确实命中词典的候选，而不是依赖数据库返回的行序
 * （行序不保证与查询顺序一致，用它来挑赢家会导致同一输入偶尔给出
 * 不同答案，例如 caring 命中 car 而不是 care）。同一后缀分支内，
 * 英语构词规则里"添加 -ing/-ed/-er/-est 前先丢弃词尾哑音 e"是常规
 * 现象（care→caring, love→loved, nice→nicer/nicest），所以"还原
 * 哑音 e"的候选排在"直接去掉后缀"的候选之前；双写辅音还原
 * （running→run）次之；未变形的词干殿后。
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
    add(w.slice(0, -1))       // loved  → love （哑音 e 还原优先）
    add(w.slice(0, -2))       // worked → work
  }

  if (w.endsWith('ing') && w.length > 5) {
    const b = w.slice(0, -3)
    add(b + 'e')              // caring / making → care / make （哑音 e 还原优先）
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) {
      add(b.slice(0, -1))     // running → run （双写辅音还原次之）
    }
    add(b)                    // working → work （未变形词干殿后）
  }

  if (w.endsWith('ily') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ly') && w.length > 4) add(w.slice(0, -2))

  if (w.endsWith('est') && w.length > 5) {
    add(w.slice(0, -3) + 'e') // nicest → nice （哑音 e 还原优先）
    add(w.slice(0, -3))
  }
  if (w.endsWith('er') && w.length > 4) {
    add(w.slice(0, -1))       // nicer → nice （哑音 e 还原优先）
    add(w.slice(0, -2))
  }

  return [...out]
}

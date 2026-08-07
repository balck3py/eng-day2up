/** 高频功能词，不作为难词候选。 */
export const STOP_WORDS: ReadonlySet<string> = new Set(`
a an the and or but if then than that this these those there here
i you he she it we they me him her us them my your his its our their
is am are was were be been being do does did done have has had having
will would shall should can could may might must
of in on at to for from by with without into onto over under about
as so not no nor too very just only also even still yet
what which who whom whose when where why how
one two three first next last other some any each every all both
up down out off again more most much many few less least own same
`.trim().split(/\s+/))

const TOKEN_RE = /[a-zA-Z][a-zA-Z'-]*/g

/**
 * 切出英文单词，去停用词与单字母词，同词只保留首次出现。
 * index 是去重后的出现序号，用于最终按原文顺序还原排列。
 */
export function tokenize(text: string): { surface: string; key: string; index: number }[] {
  const seen = new Set<string>()
  const out: { surface: string; key: string; index: number }[] = []

  for (const m of text.matchAll(TOKEN_RE)) {
    const surface = m[0]
    const key = surface.toLowerCase()
    if (key.length < 2) continue
    if (STOP_WORDS.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ surface, key, index: out.length })
  }
  return out
}

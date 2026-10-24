/**
 * CMU 发音词典（ARPAbet）→ 美式 IPA。
 *
 * 词库的音标对屈折形式靠不住：ECDICT 里 digits 给的是 digit 的音标、
 * restoring 干脆没有；CMU 按词形收录（13 万词，含复数/时态），
 * 用它给导出补齐、补全音标。纯函数，不含词典本体 —— 词典由调用方传入。
 */

const VOWELS: Record<string, [stressed: string, unstressed: string]> = {
  AA: ['ɑː', 'ɑ'],
  AE: ['æ', 'æ'],
  AH: ['ʌ', 'ə'],
  AO: ['ɔː', 'ɔ'],
  AW: ['aʊ', 'aʊ'],
  AY: ['aɪ', 'aɪ'],
  EH: ['e', 'e'],
  ER: ['ɝː', 'ɚ'],
  EY: ['eɪ', 'eɪ'],
  IH: ['ɪ', 'ɪ'],
  IY: ['iː', 'i'],
  OW: ['oʊ', 'oʊ'],
  OY: ['ɔɪ', 'ɔɪ'],
  UH: ['ʊ', 'ʊ'],
  UW: ['uː', 'u'],
}

const CONSONANTS: Record<string, string> = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h', JH: 'dʒ', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't',
  TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}

/** 英语合法的音节首辅音丛，用来决定重音符号放在哪个辅音前 */
const ONSETS = new Set([
  'p r', 'b r', 't r', 'd r', 'k r', 'g r', 'f r', 'θ r', 'ʃ r',
  'p l', 'b l', 'k l', 'g l', 'f l', 's l',
  't w', 'd w', 'k w', 'g w', 's w', 'θ w',
  's p', 's t', 's k', 's m', 's n',
  'p j', 'b j', 't j', 'd j', 'k j', 'g j', 'm j', 'n j', 'f j', 'v j', 'h j', 'l j',
  's p r', 's t r', 's k r', 's p l', 's k w', 's k j', 's p j',
])

function isOnset(cs: string[]): boolean {
  if (cs.length === 0) return true
  if (cs.length === 1) return cs[0] !== 'ŋ'
  return ONSETS.has(cs.join(' '))
}

/** "D IH1 JH AH0 T S" → "ˈdɪdʒəts"。单音节不标重音（词典惯例）。 */
export function arpabetToIpa(arpa: string): string {
  type Seg = { ipa: string; stress: number | null }
  const phones = arpa.trim().split(/\s+/)
  const segs: Seg[] = []
  phones.forEach((p, i) => {
    const m = /^([A-Z]+)([012])?$/.exec(p)
    if (!m) return
    const [, base, s] = m
    if (!VOWELS[base]) {
      segs.push({ ipa: CONSONANTS[base] ?? '', stress: null })
      return
    }
    const stress = Number(s ?? 0)
    // CMU 把「ə + r」并进 ER（corruption = K ER0 AH1 …）。后面紧跟元音时
    // r 其实属于下一个音节，拆开，重音才会标在 r 前面：kəˈrʌpʃən
    if (base === 'ER' && /^[A-Z]+[012]$/.test(phones[i + 1] ?? '')) {
      segs.push({ ipa: stress === 0 ? 'ə' : 'ɜː', stress }, { ipa: 'r', stress: null })
      return
    }
    segs.push({ ipa: VOWELS[base][stress === 0 ? 1 : 0], stress })
  })

  const vowelIdx = segs.flatMap((s, i) => (s.stress !== null ? [i] : []))
  const marks = new Map<number, string>() // 段下标 → 在它前面插的重音符号
  if (vowelIdx.length > 1) {
    vowelIdx.forEach((v, k) => {
      const stress = segs[v].stress
      // 紧挨主重音前的次重音（CMU 常给 in-/im- 前缀标 2）词典一般不标，去掉
      if (stress === 2 && segs[vowelIdx[k + 1]]?.stress === 1) return
      if (stress !== 1 && stress !== 2) return
      const prevVowel = k === 0 ? -1 : vowelIdx[k - 1]
      // 两个元音之间的辅音，取最长的合法首辅音丛归到重读音节
      let start = v
      while (start - 1 > prevVowel && isOnset(segs.slice(start - 1, v).map((s) => s.ipa))) start--
      if (prevVowel === -1) start = 0
      marks.set(start, stress === 1 ? 'ˈ' : 'ˌ')
    })
  }
  return segs.map((s, i) => (marks.get(i) ?? '') + s.ipa).join('')
}

/** 按词形精确查 CMU，查不到返回 null。 */
export function cmuExact(word: string, dict: Record<string, string>): string | null {
  const hit = dict[word.trim().toLowerCase()]
  return hit ? `/${arpabetToIpa(hit)}/` : null
}

/**
 * 词典里没有的复合词（带连字符或空格）拆开逐段查，全查到才拼。
 * 拼出来的重音不如整词准，调用方应先用词库里的整词音标。
 */
export function cmuCompound(word: string, dict: Record<string, string>): string | null {
  const parts = word.trim().toLowerCase().split(/([-\s]+)/)
  if (parts.length < 3) return null
  const out: string[] = []
  for (const part of parts) {
    if (/^[-\s]+$/.test(part)) {
      out.push(part.includes('-') ? '-' : ' ')
      continue
    }
    const arpa = dict[part]
    if (!arpa) return null
    out.push(arpabetToIpa(arpa))
  }
  return `/${out.join('')}/`
}

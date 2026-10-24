import { describe, it, expect } from 'vitest'
import { crc32 } from '@/lib/epub/zip'
import {
  buildWordbookEpub,
  entryHtml,
  esc,
  groupByDay,
  meaningLine,
  normalizePhonetic,
  type EpubWord,
} from './epub'

const w = (word: string, createdAt: string, extra: Partial<EpubWord> = {}): EpubWord => ({
  word,
  phonetic: null,
  translation: null,
  sourceContext: null,
  createdAt,
  ...extra,
})

/** 读出 STORED zip 里的文件名与内容（只解析本地文件头，够测试用） */
function unzip(buf: Uint8Array): Map<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder()
  const out = new Map<string, string>()
  let p = 0
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true)
    const nameLen = dv.getUint16(p + 26, true)
    const name = dec.decode(buf.subarray(p + 30, p + 30 + nameLen))
    const data = buf.subarray(p + 30 + nameLen, p + 30 + nameLen + size)
    expect(crc32(data)).toBe(dv.getUint32(p + 14, true))
    out.set(name, dec.decode(data))
    p += 30 + nameLen + size
  }
  return out
}

describe('crc32', () => {
  it('标准校验值', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('normalizePhonetic', () => {
  it('倒 r（ɹ）换成 r，补斜杠', () => {
    expect(normalizePhonetic('ˈɹæbɪt')).toBe('/ˈræbɪt/')
  })
  it('西里尔 ә / є 换成 IPA', () => {
    expect(normalizePhonetic("'kәuәl")).toBe("/'kəuəl/")
    expect(normalizePhonetic('bєd')).toBe('/bɛd/')
  })
  it('已带斜杠或方括号不重复加', () => {
    expect(normalizePhonetic('/ɡʊd/')).toBe('/gʊd/')
    expect(normalizePhonetic('[kæt]')).toBe('[kæt]')
  })
  it('空值', () => {
    expect(normalizePhonetic(null)).toBe('')
    expect(normalizePhonetic('  ')).toBe('')
  })
})

describe('meaningLine', () => {
  it('字面 \\n 分行，领域义项在有普通义项时丢掉', () => {
    expect(meaningLine('n. 苹果\\n[医] 喉结\\nvt. 吃')).toBe('n. 苹果；vt. 吃')
  })
  it('只有领域义项时保留', () => {
    expect(meaningLine('[医] 喉结')).toBe('[医] 喉结')
  })
})

describe('esc', () => {
  it('转义并去掉 XML 不允许的控制字符', () => {
    expect(esc('a\u000b<b> & "c"')).toBe('a &lt;b&gt; &amp; &quot;c&quot;')
  })
})

describe('groupByDay', () => {
  it('按加入时间正序，按北京时间分天', () => {
    const g = groupByDay([
      w('c', '2026-10-02T01:00:00Z'),
      w('a', '2026-10-01T15:30:00Z'), // 北京时间 10-01 23:30
      w('b', '2026-10-01T16:30:00Z'), // 北京时间 10-02 00:30
    ])
    expect(g.map(([d, items]) => [d, items.map((x) => x.word)])).toEqual([
      ['2026-10-01', ['a']],
      ['2026-10-02', ['b', 'c']],
    ])
  })
})

describe('entryHtml', () => {
  it('四个元素各占一行，缺的不输出', () => {
    const full = entryHtml(
      w('rabbit', '2026-10-01T00:00:00Z', {
        phonetic: 'ˈɹæbɪt',
        translation: 'n. 兔子',
        sourceContext: 'A rabbit ran.',
      }),
    )
    expect(full).toBe(
      '<div class="entry"><div class="w">rabbit</div><div class="ph">/ˈræbɪt/</div>' +
        '<div class="zh">n. 兔子</div><div class="ex">A rabbit ran.</div></div>',
    )
    expect(entryHtml(w('x', '2026-10-01T00:00:00Z'))).toBe('<div class="entry"><div class="w">x</div></div>')
  })
})

describe('buildWordbookEpub', () => {
  const now = new Date('2026-10-24T04:00:00Z')

  it('mimetype 在首位且不压缩，章节按天，样式 30px 无缩进', () => {
    const book = buildWordbookEpub(
      [w('b', '2026-10-02T01:00:00Z'), w('a', '2026-10-01T01:00:00Z', { translation: 'n. 甲' })],
      now,
      '00000000-0000-4000-8000-000000000000',
    )
    expect(new TextDecoder().decode(book.subarray(30, 38))).toBe('mimetype')
    const files = unzip(book)
    expect([...files.keys()][0]).toBe('mimetype')
    expect(files.get('mimetype')).toBe('application/epub+zip')
    expect(files.get('OEBPS/content.opf')).toContain('<dc:title>生词本 2026-10-24</dc:title>')
    expect(files.get('OEBPS/c001.xhtml')).toContain('2026-10-01（1 个）')
    expect(files.get('OEBPS/c001.xhtml')).toContain('<div class="zh">n. 甲</div>')
    expect(files.get('OEBPS/c002.xhtml')).toContain('<div class="w">b</div>')
    const css = files.get('OEBPS/style.css')!
    expect(css).toContain('font-size: 30px')
    expect(css).toContain('text-indent: 0 !important')
  })

  it('空单词本也生成合法结构', () => {
    const files = unzip(buildWordbookEpub([], now, '00000000-0000-4000-8000-000000000000'))
    expect(files.get('OEBPS/content.opf')).toContain('<itemref idref="nav"/>')
  })
})

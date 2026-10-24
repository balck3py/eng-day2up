import { zip } from '@/lib/epub/zip'

/** 导出用的一条生词：只要这几个字段，和数据库/接口形状解耦。 */
export interface EpubWord {
  word: string
  phonetic: string | null
  /** ECDICT 原始 translation（行间可能是字面 `\n`） */
  translation: string | null
  sourceContext: string | null
  createdAt: string
}

/** 按北京时间分章：只有一个用户，就在国内用。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 音标里的怪字符换成通用 IPA：
 * - dictionaryapi.dev 的美音用 ɹ（U+0279），在水墨屏字体里就是个倒着的 r；
 *   英语词典惯例写 r，换掉。
 * - ECDICT 把 ə 录成了西里尔字母 ә（U+04D9）、ɛ 录成 є（U+0454），
 *   字体回退时字形对不上，换成 IPA 原字符。
 * - ɡ（U+0261）不少阅读器字体缺字，换成普通 g。
 */
const PHONETIC_FIXES: Record<string, string> = {
  'ɹ': 'r',
  'ә': 'ə',
  'Ә': 'ə',
  'є': 'ɛ',
  'ɡ': 'g',
}

export function normalizePhonetic(p: string | null): string {
  const s = (p ?? '').trim().replace(/[ɹәӘєɡ]/g, (c) => PHONETIC_FIXES[c])
  if (!s) return ''
  return /^[/[]/.test(s) ? s : `/${s}/`
}

/**
 * 中文释义压成一行：「n. 苹果；vt. 吃」。
 * 「[医] …」这种领域义项在有普通义项时丢掉，只剩领域义项时保留。
 */
export function meaningLine(translation: string | null): string {
  const lines = (translation ?? '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const plain = lines.filter((l) => !l.startsWith('['))
  return (plain.length > 0 ? plain : lines).join('；')
}

// XML 1.0 不允许的控制字符（实际数据里出现过 \v）
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g

export function esc(s: string): string {
  return s
    .replace(XML_INVALID, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 北京时间的日期 YYYY-MM-DD */
export function localDay(iso: string | number): string {
  return new Date(new Date(iso).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** 按加入时间正序排好，再按天分组（保持顺序）。 */
export function groupByDay(words: EpubWord[]): [string, EpubWord[]][] {
  const sorted = [...words].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const groups = new Map<string, EpubWord[]>()
  for (const w of sorted) {
    const day = localDay(w.createdAt)
    const list = groups.get(day)
    if (list) list.push(w)
    else groups.set(day, [w])
  }
  return [...groups]
}

// 3.8 寸水墨屏：字号 30px。每个元素用 div 独占一行 ——
// 不用 p，很多阅读器会给 p 强加首行缩进和段间距。
const CSS = `html, body { font-size: 30px; }
body { margin: 0.3em; line-height: 1.45; font-family: serif; }
h1 { font-size: 30px; font-weight: bold; margin: 0.6em 0 0.4em; border-bottom: 2px solid #000; text-indent: 0; }
div, p, li { text-indent: 0 !important; }
div.entry { margin: 0 0 0.9em; page-break-inside: avoid; break-inside: avoid; }
div.entry > div { font-size: 30px; margin: 0; padding: 0; }
.w { font-weight: bold; }
.ph { font-family: "Charis SIL", "Doulos SIL", "Gentium Plus", "Noto Serif", "DejaVu Sans", sans-serif; }
.ex { font-style: italic; }
nav ol { padding-left: 1.2em; margin: 0; }
`

function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`
}

/** 一个词：单词 / 音标 / 中文 / 例句，各占一行；缺的那行不输出。 */
export function entryHtml(w: EpubWord): string {
  const rows = [`<div class="w">${esc(w.word)}</div>`]
  const ph = normalizePhonetic(w.phonetic)
  if (ph) rows.push(`<div class="ph">${esc(ph)}</div>`)
  const zh = meaningLine(w.translation)
  if (zh) rows.push(`<div class="zh">${esc(zh)}</div>`)
  const ex = (w.sourceContext ?? '').trim()
  if (ex) rows.push(`<div class="ex">${esc(ex)}</div>`)
  return `<div class="entry">${rows.join('')}</div>`
}

/**
 * 生成 EPUB3（同时带 toc.ncx 兼容老阅读器）。一天一章，目录可跳到某天。
 * `now` 用来写书名日期和 dcterms:modified，`id` 是书的唯一标识。
 */
export function buildWordbookEpub(words: EpubWord[], now: Date, id: string): Uint8Array {
  const groups = groupByDay(words)
  const title = `生词本 ${localDay(now.getTime())}`
  const modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const chapters = groups.map(([day, items], i) => ({
    file: `c${String(i + 1).padStart(3, '0')}.xhtml`,
    label: `${day}（${items.length}）`,
    html: xhtml(day, `<h1>${day}（${items.length} 个）</h1>\n${items.map(entryHtml).join('\n')}`),
  }))

  const navBody = `<nav epub:type="toc" id="toc"><h1>${esc(title)}（共 ${words.length} 个）</h1><ol>
${chapters.map((c) => `<li><a href="${c.file}">${c.label}</a></li>`).join('\n')}
</ol></nav>`
  // 空单词本也得是合法的书：spine 至少一个条目，就放目录页
  const spine =
    chapters.length > 0
      ? chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('\n')
      : '<itemref idref="nav"/>'

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bid">urn:uuid:${id}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
<dc:language>zh-CN</dc:language>
<dc:creator>eng-day2up</dc:creator>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${spine}
</spine>
</package>`

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:${id}"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>
${(chapters.length > 0 ? chapters : [{ file: 'nav.xhtml', label: title }])
  .map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.label)}</text></navLabel><content src="${c.file}"/></navPoint>`)
  .join('\n')}
</navMap>
</ncx>`

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  return zip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: xhtml('目录', navBody) },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: CSS },
    ...chapters.map((c) => ({ name: `OEBPS/${c.file}`, data: c.html })),
  ])
}

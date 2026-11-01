import { isSingleWord } from '@/lib/text/normalize'
import { sentenceAt } from '@/lib/reader/sentence'
import type { Picked } from './SelectionPanel'

const BLOCKS = '[data-selection-english],p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,dt,dd'
function element(node: Node): Element | null { return node instanceof Element ? node : node.parentElement }

/** Build selection text without hidden Chinese captions or control labels. */
function selectedText(range: Range, host: HTMLElement): string {
  const marked = host.querySelectorAll('[data-selection-english]')
  if (!marked.length) return range.toString()
  const parts: string[] = []
  for (const block of marked) {
    if (!range.intersectsNode(block)) continue
    const part = document.createRange()
    part.selectNodeContents(block)
    if (block.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset)
    if (block.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset)
    parts.push(part.toString())
  }
  // Other English content in the detail, such as its title, remains selectable.
  return parts.length ? parts.join('\n') : range.toString()
}

export function pickSelection(range: Range, host: HTMLElement): Picked | null {
  if (!host.contains(range.commonAncestorContainer)) return null
  if (element(range.startContainer)?.closest('[data-selection-ignore],input,textarea,select')) return null
  const raw = selectedText(range, host).trim()
  if (!/[A-Za-z]/.test(raw)) return null
  const text = raw.slice(0, 2000)
  const block = element(range.startContainer)?.closest(BLOCKS)
  const scope = block && host.contains(block) && block.contains(range.endContainer) ? block : host
  const before = document.createRange()
  before.selectNodeContents(scope)
  before.setEnd(range.startContainer, range.startOffset)
  return { text, isWord: isSingleWord(text), context: sentenceAt(scope.textContent ?? '', before.toString().length), truncated: raw.length > 2000 }
}

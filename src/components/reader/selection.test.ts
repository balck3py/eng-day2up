// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { pickSelection } from './selection'
function pick(html: string, selector: string) {
  document.body.innerHTML = `<main>${html}</main>`
  const host = document.querySelector('main')!
  const range = document.createRange(); range.selectNodeContents(host.querySelector(selector)!)
  return pickSelection(range, host)
}
it('recognizes words and clips contexts without adjacent paragraphs', () => {
  const result = pick('<p>A first sentence. Researchers remain <b>skeptical</b> about it.</p><p>Another paragraph.</p>', 'b')
  expect(result).toMatchObject({ text: 'skeptical', isWord: true, context: 'Researchers remain skeptical about it.' })
})
it('selects only English from bilingual transcript ranges', () => {
  document.body.innerHTML = '<main><div><span data-selection-ignore>Erinome:</span><p data-selection-english>Hello world.</p><p data-selection-ignore>你好。</p></div><div><p data-selection-english>Next sentence.</p><p data-selection-ignore>下一句。</p></div></main>'
  const host = document.querySelector('main')!, range = document.createRange()
  range.selectNodeContents(host)
  expect(pickSelection(range, host)?.text).toBe('Hello world.\nNext sentence.')
})
it('keeps cross-word span ranges and word context intact', () => {
  document.body.innerHTML = '<main><p data-selection-english><span>Hello</span> <span>dear</span> <span>friends!</span></p><p data-selection-ignore>你好。</p></main>'
  const host = document.querySelector('main')!, spans = host.querySelectorAll('span'), range = document.createRange()
  range.setStart(spans[0].firstChild!, 0); range.setEnd(spans[2].firstChild!, 8)
  expect(pickSelection(range, host)).toMatchObject({ text: 'Hello dear friends!', isWord: false, context: 'Hello dear friends!' })
  range.selectNodeContents(spans[1])
  expect(pickSelection(range, host)).toMatchObject({ text: 'dear', isWord: true, context: 'Hello dear friends!' })
})
it('ignores pure Chinese, controls and selections outside content', () => {
  expect(pick('<p>你好</p>', 'p')).toBeNull()
  expect(pick('<p data-selection-ignore>Playback controls</p>', 'p')).toBeNull()
  const host = document.createElement('div'), range = document.createRange()
  range.selectNodeContents(document.body)
  expect(pickSelection(range, host)).toBeNull()
})
it('limits selected text to 2000 and stored context to 500 characters', () => {
  const result = pick(`<p>${'a'.repeat(2100)}</p>`, 'p')!
  expect(result.text).toHaveLength(2000)
  expect(result.context.length).toBeLessThanOrEqual(500)
  expect(result.truncated).toBe(true)
})

import { describe, it, expect } from 'vitest'
import { comboOf, DoubleTapRecorder, shortcutLabel, type KeyLike } from './shortcut'

const ev = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
})

describe('comboOf', () => {
  it('修饰键 + 普通键', () => {
    expect(comboOf(ev(' ', 'Space', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Space')
    expect(comboOf(ev('d', 'KeyD', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+D')
    expect(comboOf(ev('1', 'Digit1', { altKey: true }))).toBe('Alt+1')
  })
  it('单独 F 键允许', () => {
    expect(comboOf(ev('F8', 'F8'))).toBe('F8')
  })
  it('没有修饰键的普通键、单独的修饰键都不算', () => {
    expect(comboOf(ev('a', 'KeyA'))).toBeNull()
    expect(comboOf(ev('Alt', 'AltLeft', { altKey: true }))).toBeNull()
  })
})

describe('DoubleTapRecorder', () => {
  const alt = ev('Alt', 'AltLeft')
  const tap = (r: DoubleTapRecorder, k: KeyLike, t: number) => {
    r.down(k)
    return r.up(k, t)
  }

  it('快速按两下 Alt', () => {
    const r = new DoubleTapRecorder()
    expect(tap(r, alt, 0)).toBeNull()
    expect(tap(r, alt, 250)).toBe('DoubleAlt')
  })
  it('间隔太长不算', () => {
    const r = new DoubleTapRecorder()
    tap(r, alt, 0)
    expect(tap(r, alt, 900)).toBeNull()
  })
  it('按住 Alt 时按了别的键不算', () => {
    const r = new DoubleTapRecorder()
    tap(r, alt, 0)
    r.down(alt)
    r.down(ev('Tab', 'Tab'))
    expect(r.up(alt, 200)).toBeNull()
  })
  it('Win 键不支持双击', () => {
    const r = new DoubleTapRecorder()
    const win = ev('Meta', 'MetaLeft')
    tap(r, win, 0)
    expect(tap(r, win, 200)).toBeNull()
  })
})

describe('shortcutLabel', () => {
  it('双击写法转中文', () => {
    expect(shortcutLabel('DoubleAlt')).toBe('双击 Alt')
    expect(shortcutLabel('Ctrl+Alt+Space')).toBe('Ctrl+Alt+Space')
  })
})

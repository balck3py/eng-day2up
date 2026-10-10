/**
 * 快捷键录制：把按键事件转成 Rust 侧认识的写法。
 * - 组合键：Ctrl+Alt+Space（交给 tauri-plugin-global-shortcut 解析）
 * - 双击修饰键：DoubleAlt / DoubleCtrl / DoubleShift（Rust 侧用键盘钩子检测）
 */

const MODIFIER_KEYS: Record<string, 'Ctrl' | 'Alt' | 'Shift' | 'Super'> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Super',
}

/** 可双击的修饰键（Win 键单按会弹开始菜单，不支持） */
const DOUBLE_TAPPABLE = new Set(['Ctrl', 'Alt', 'Shift'])
const TAP_GAP_MS = 400

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export function modifierOf(e: Pick<KeyLike, 'key'>): string | null {
  return MODIFIER_KEYS[e.key] ?? null
}

/** KeyboardEvent.code → 快捷键里的键名；KeyA → A，Digit1 → 1，其余沿用 code（Space、F1、ArrowUp…）。 */
function keyName(code: string): string {
  return code.replace(/^Key([A-Z])$/, '$1').replace(/^Digit(\d)$/, '$1')
}

/** 非修饰键按下时得到组合键；没有修饰键（F 键除外）返回 null，免得占用普通打字。 */
export function comboOf(e: KeyLike): string | null {
  if (modifierOf(e)) return null
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(
    (m): m is string => !!m,
  )
  const key = keyName(e.code)
  if (mods.length === 0 && !/^F\d{1,2}$/.test(key)) return null
  return [...mods, key].join('+')
}

/** 双击修饰键识别：只认「单独按下又松开」的修饰键，两次间隔 ≤ 400ms。 */
export class DoubleTapRecorder {
  private held: { mod: string; clean: boolean } | null = null
  private last: { mod: string; t: number } | null = null

  down(e: Pick<KeyLike, 'key'>): void {
    const mod = modifierOf(e)
    if (mod) {
      if (!this.held) this.held = { mod, clean: true }
      else if (this.held.mod !== mod) this.held.clean = false
      return
    }
    if (this.held) this.held.clean = false
    this.last = null
  }

  /** 完成双击时返回 DoubleXxx。 */
  up(e: Pick<KeyLike, 'key'>, now: number): string | null {
    const mod = modifierOf(e)
    if (!mod || this.held?.mod !== mod) return null
    const clean = this.held.clean
    this.held = null
    if (!clean || !DOUBLE_TAPPABLE.has(mod)) {
      this.last = null
      return null
    }
    if (this.last?.mod === mod && now - this.last.t <= TAP_GAP_MS) {
      this.last = null
      return `Double${mod}`
    }
    this.last = { mod, t: now }
    return null
  }
}

/** 界面上显示的写法。 */
export function shortcutLabel(accelerator: string): string {
  const m = /^Double(Alt|Ctrl|Shift)$/i.exec(accelerator.trim())
  return m ? `双击 ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}` : accelerator
}

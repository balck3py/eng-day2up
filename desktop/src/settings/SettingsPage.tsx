import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../lib/config'
import { currentUser, getDb } from '../lib/db'
import { applyShortcut, shortcutError } from '../lib/bridge'
import { comboOf, DoubleTapRecorder, shortcutLabel } from '../lib/shortcut'

const input = 'w-full rounded-[8px] border border-rule bg-card px-2 py-1.5 text-[0.9375rem]'
const button = 'rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50'

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    void loadSettings().then(setS)
  }, [])

  if (!s) return <p className="p-6 text-ink-3">加载中…</p>

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS({ ...s, [k]: v })
    setSaved('')
  }

  async function save() {
    await saveSettings(s!)
    setSaved('已保存')
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="text-[1.25rem] font-semibold">设置</h1>

      <Section title="Supabase 连接">
        <Field label="URL">
          <input className={input} value={s.supabaseUrl} onChange={(e) => set('supabaseUrl', e.target.value)} />
        </Field>
        <Field label="anon key">
          <input className={input} value={s.supabaseAnonKey} onChange={(e) => set('supabaseAnonKey', e.target.value)} />
        </Field>
      </Section>

      <Account settings={s} />

      <Section title="翻译端点（OpenAI 兼容）">
        <Field label="baseUrl">
          <input
            className={input}
            placeholder="http://localhost:11434/v1"
            value={s.llmBaseUrl}
            onChange={(e) => set('llmBaseUrl', e.target.value)}
          />
        </Field>
        <Field label="model">
          <input className={input} value={s.llmModel} onChange={(e) => set('llmModel', e.target.value)} />
        </Field>
        <Field label="apiKey（可选）">
          <input className={input} type="password" value={s.llmApiKey} onChange={(e) => set('llmApiKey', e.target.value)} />
        </Field>
        <Field label="自定义翻译 prompt（可选）">
          <textarea className={input} rows={3} value={s.llmPrompt} onChange={(e) => set('llmPrompt', e.target.value)} />
        </Field>
      </Section>

      <Section title="其他">
        <Field label="难词熟练度阈值（单词本熟练度 ≥ 此值不再列为难词）">
          <input
            className={input}
            type="number"
            min={1}
            max={10}
            value={s.threshold}
            onChange={(e) => set('threshold', Number(e.target.value) || DEFAULT_SETTINGS.threshold)}
          />
        </Field>
        <Field label="弹窗闲置多少分钟后销毁">
          <input
            className={input}
            type="number"
            min={1}
            value={s.idleDestroyMinutes}
            onChange={(e) => set('idleDestroyMinutes', Number(e.target.value) || DEFAULT_SETTINGS.idleDestroyMinutes)}
          />
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <button type="button" className={button} onClick={() => void save()}>
          保存
        </button>
        <span className="text-sm text-jade" role="status">
          {saved}
        </span>
      </div>

      <Shortcut settings={s} onApplied={(shortcut) => setS({ ...s, shortcut })} />
      {isTauri() && <Autostart />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-rule bg-card p-4">
      <h2 className="font-mono text-[0.8125rem] text-ink-2">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[0.8125rem] text-ink-2">
      {label}
      {children}
    </label>
  )
}

/** 登录只用一次密码换 session；密码只在组件 state 里，不落盘。 */
function Account({ settings }: { settings: Settings }) {
  const db = getDb(settings)
  const [email, setEmail] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', password: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (db) void currentUser(db).then((u) => setEmail(u?.email ?? null))
  }, [db])

  if (!db) {
    return (
      <Section title="账号">
        <p className="text-sm text-ink-3">先填写并保存 Supabase URL 与 anon key。</p>
      </Section>
    )
  }

  async function login() {
    setBusy(true)
    setMsg('')
    const { data, error } = await db!.auth.signInWithPassword(form)
    setBusy(false)
    if (error) return setMsg(`登录失败：${error.message}`)
    setEmail(data.user?.email ?? form.email)
    setForm({ email: '', password: '' })
  }

  async function logout() {
    await db!.auth.signOut()
    setEmail(null)
  }

  return (
    <Section title="账号">
      {email ? (
        <div className="flex items-center gap-3 text-[0.9375rem]">
          <span>已登录：{email}</span>
          <button type="button" className="text-sm text-ink-3 underline hover:text-ink" onClick={() => void logout()}>
            登出
          </button>
        </div>
      ) : (
        <>
          <Field label="邮箱">
            <input
              className={input}
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="密码（不会保存）">
            <input
              className={input}
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <button
            type="button"
            className={`${button} self-start`}
            disabled={busy || !form.email || !form.password}
            onClick={() => void login()}
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </>
      )}
      {msg && <p className="text-sm text-seal">{msg}</p>}
    </Section>
  )
}

/**
 * 点一下进入录制：直接按组合键，或快速按两下 Alt / Ctrl / Shift。录到即应用：
 * 先让 Rust 注册新键，成功才保存；失败时旧快捷键保持不变。
 */
function Shortcut({ settings, onApplied }: { settings: Settings; onApplied: (s: string) => void }) {
  const [current, setCurrent] = useState(settings.shortcut)
  const [recording, setRecording] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const recorder = useRef(new DoubleTapRecorder())

  useEffect(() => {
    void shortcutError().then((e) => e && setMsg({ ok: false, text: `快捷键被占用：${e}` }))
  }, [])

  async function apply(accelerator: string) {
    setRecording(false)
    try {
      await applyShortcut(accelerator)
      const next = { ...(await loadSettings()), shortcut: accelerator }
      await saveSettings(next)
      setCurrent(accelerator)
      onApplied(accelerator)
      setMsg({ ok: true, text: `已生效：${shortcutLabel(accelerator)}` })
    } catch (e) {
      setMsg({ ok: false, text: `${shortcutLabel(accelerator)} 被占用或无效（${String(e)}），已保留原快捷键` })
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!recording) return
    e.preventDefault()
    if (e.repeat) return
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return setRecording(false)
    recorder.current.down(e)
    const combo = comboOf(e)
    if (combo) void apply(combo)
  }

  function onKeyUp(e: React.KeyboardEvent) {
    if (!recording) return
    e.preventDefault()
    const double = recorder.current.up(e, performance.now())
    if (double) void apply(double)
  }

  return (
    <Section title="全局快捷键">
      <button
        type="button"
        aria-label="录制快捷键"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className={`${input} text-left font-mono ${recording ? 'border-focus text-ink-3' : ''}`}
      >
        {recording ? '请按下快捷键，或快速按两下 Alt / Ctrl / Shift…（Esc 取消）' : shortcutLabel(current)}
      </button>
      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
        <span className="text-ink-3">常用：</span>
        {['DoubleAlt', 'DoubleCtrl', 'Ctrl+Alt+Space'].map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => void apply(a)}
            className="rounded-full border border-rule px-2 py-0.5 text-ink-2 hover:border-ink hover:text-ink"
          >
            {shortcutLabel(a)}
          </button>
        ))}
      </div>
      <p className="text-[0.75rem] text-ink-3">
        双击 Alt 在 Word / VS Code 里会先进入再退出菜单模式，偶尔会看到菜单闪一下；介意的话可改用双击 Ctrl。
      </p>
      {msg && <p className={`text-sm ${msg.ok ? 'text-jade' : 'text-seal'}`}>{msg.text}</p>}
    </Section>
  )
}

function Autostart() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void isEnabled().then(setOn)
  }, [])
  async function toggle(next: boolean) {
    await (next ? enable() : disable())
    setOn(await isEnabled())
  }
  return (
    <Section title="开机自启">
      <label className="flex items-center gap-2 text-[0.9375rem]">
        <input
          type="checkbox"
          checked={!!on}
          disabled={on === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        登录 Windows 后自动以托盘形式启动
      </label>
    </Section>
  )
}

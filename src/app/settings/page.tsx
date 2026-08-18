'use client'

import { useId, useState, useSyncExternalStore } from 'react'
import {
  subscribeLocalModelConfig,
  getLocalModelConfigSnapshot,
  getLocalModelConfigServerSnapshot,
  saveLocalModelConfig,
  clearLocalModelConfig,
  type LocalModelConfig,
} from '@/lib/translate/localModel'

interface FormState {
  baseUrl: string
  model: string
  apiKey: string
  prompt: string
}

const EMPTY_FORM: FormState = { baseUrl: '', model: '', apiKey: '', prompt: '' }

function toForm(cfg: LocalModelConfig | null): FormState {
  if (!cfg) return EMPTY_FORM
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKey: cfg.apiKey ?? '',
    prompt: cfg.prompt ?? '',
  }
}

export default function SettingsPage() {
  const baseId = useId()
  // 配置存 localStorage，服务端渲染读不到。订阅外部 store 而不是在 effect 里
  // setState —— 后者会多一轮级联渲染。
  const stored = useSyncExternalStore(
    subscribeLocalModelConfig,
    getLocalModelConfigSnapshot,
    getLocalModelConfigServerSnapshot,
  )

  const [form, setForm] = useState<FormState>(() => toForm(stored))
  const [syncedFrom, setSyncedFrom] = useState(stored)
  const [saved, setSaved] = useState(false)

  // 渲染期同步表单：hydration 完成后 stored 会从 null 变成真实配置，保存/清除
  // 之后也会变。这是 React 文档里「外部值变化时调整 state」的写法，React 会在
  // 提交前就地重渲染，不会闪一帧旧值。
  if (syncedFrom !== stored) {
    setSyncedFrom(stored)
    setForm(toForm(stored))
  }

  const enabled = stored !== null

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function save() {
    if (!canSave) return
    // 写完由 store 通知回来，表单会被上面的渲染期同步刷成规范化后的值
    saveLocalModelConfig({
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      prompt: form.prompt.trim() || undefined,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function reset() {
    // 同上：清除后 stored 变 null，表单被同步清空
    clearLocalModelConfig()
    setSaved(false)
  }

  const canSave = form.baseUrl.trim() !== '' && form.model.trim() !== ''

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">本地大模型</h1>
        <p className="text-[0.9375rem] leading-[1.7] text-ink-2">
          配置一个 OpenAI 兼容的本地模型端点后，翻译将由你的浏览器直接调用它，
          覆盖默认的云端后端。留空则继续使用默认后端。配置只保存在这台浏览器（localStorage）。
        </p>
      </div>

      <div
        className={`rounded-[10px] border px-3 py-2 text-[0.875rem] ${
          enabled
            ? 'border-jade/30 bg-jade/10 text-jade'
            : 'border-rule bg-card text-ink-3'
        }`}
      >
        {enabled ? '当前：翻译走本地模型' : '当前：翻译走默认后端（未配置本地模型）'}
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.875rem] font-medium text-ink">
            Base URL <span className="text-seal">*</span>
          </span>
          <input
            id={`${baseId}-url`}
            value={form.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="rounded-[10px] border border-rule bg-card px-3 py-2 font-mono text-[0.9375rem] text-ink placeholder:text-ink-3 focus:border-focus"
          />
          <span className="text-[0.8125rem] text-ink-3">
            OpenAI 兼容端点，会在其后拼 /chat/completions
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.875rem] font-medium text-ink">
            模型名 <span className="text-seal">*</span>
          </span>
          <input
            value={form.model}
            onChange={(e) => update('model', e.target.value)}
            placeholder="qwen2.5:7b"
            className="rounded-[10px] border border-rule bg-card px-3 py-2 font-mono text-[0.9375rem] text-ink placeholder:text-ink-3 focus:border-focus"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.875rem] font-medium text-ink">API Key（可选）</span>
          <input
            type="password"
            value={form.apiKey}
            onChange={(e) => update('apiKey', e.target.value)}
            placeholder="本地 ollama 通常不需要"
            className="rounded-[10px] border border-rule bg-card px-3 py-2 font-mono text-[0.9375rem] text-ink placeholder:text-ink-3 focus:border-focus"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.875rem] font-medium text-ink">翻译提示词（可选）</span>
          <textarea
            value={form.prompt}
            onChange={(e) => update('prompt', e.target.value)}
            rows={4}
            placeholder="留空则用内置的按方向提示词"
            className="rounded-[10px] border border-rule bg-card px-3 py-2 text-[0.9375rem] leading-[1.7] text-ink placeholder:text-ink-3 focus:border-focus"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-card disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-[10px] border border-rule px-4 py-2 text-sm text-ink"
        >
          清除配置
        </button>
        {saved && <span className="text-[0.875rem] text-jade">已保存</span>}
      </div>

      <details className="rounded-[10px] border border-rule bg-card px-3 py-2 text-[0.8125rem] leading-[1.7] text-ink-2">
        <summary className="cursor-pointer text-ink">
          在线上（HTTPS）使用本地模型？点此看如何用隧道
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-ink-3">
          <p>
            线上 <span className="font-mono text-ink-2">eng.eugen.uno</span> 是 HTTPS 页面，
            浏览器会拦截它直连 <span className="font-mono">http://localhost</span>
            （混合内容），且本地端点要允许本站跨域。两种解决办法：
          </p>
          <p>
            1. 用隧道把本地模型暴露成一个 HTTPS 地址，把它填进上面的 Base URL：
          </p>
          <pre className="overflow-x-auto rounded-[8px] bg-paper px-3 py-2 font-mono text-[0.75rem] text-ink">
{`# Cloudflare Tunnel（免费、自带 https 与 CORS 透传）
cloudflared tunnel --url http://localhost:11434
# 或 ngrok
ngrok http 11434
# 然后 Base URL 填隧道给出的 https 地址 + /v1`}
          </pre>
          <p>
            2. 或让本地模型允许本站来源的跨域。以 ollama 为例：
          </p>
          <pre className="overflow-x-auto rounded-[8px] bg-paper px-3 py-2 font-mono text-[0.75rem] text-ink">
{`OLLAMA_ORIGINS=https://eng.eugen.uno ollama serve`}
          </pre>
          <p>在本机 http 开发环境（localhost）下不受这些限制，直接填即可。</p>
        </div>
      </details>
    </main>
  )
}

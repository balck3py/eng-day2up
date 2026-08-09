'use client'

import { useEffect, useId, useState } from 'react'
import {
  getLocalModelConfig,
  saveLocalModelConfig,
  clearLocalModelConfig,
} from '@/lib/translate/localModel'

export default function SettingsPage() {
  const baseId = useId()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [saved, setSaved] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const cfg = getLocalModelConfig()
    if (cfg) {
      setBaseUrl(cfg.baseUrl)
      setModel(cfg.model)
      setApiKey(cfg.apiKey ?? '')
      setPrompt(cfg.prompt ?? '')
      setEnabled(true)
    }
  }, [])

  function save() {
    if (!baseUrl.trim() || !model.trim()) return
    saveLocalModelConfig({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
      prompt: prompt.trim() || undefined,
    })
    setEnabled(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function reset() {
    clearLocalModelConfig()
    setBaseUrl('')
    setModel('')
    setApiKey('')
    setPrompt('')
    setEnabled(false)
    setSaved(false)
  }

  const canSave = baseUrl.trim() !== '' && model.trim() !== ''

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
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
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
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="qwen2.5:7b"
            className="rounded-[10px] border border-rule bg-card px-3 py-2 font-mono text-[0.9375rem] text-ink placeholder:text-ink-3 focus:border-focus"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.875rem] font-medium text-ink">API Key（可选）</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="本地 ollama 通常不需要"
            className="rounded-[10px] border border-rule bg-card px-3 py-2 font-mono text-[0.9375rem] text-ink placeholder:text-ink-3 focus:border-focus"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.875rem] font-medium text-ink">翻译提示词（可选）</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
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

      <p className="text-[0.8125rem] leading-[1.6] text-ink-3">
        提示：线上 HTTPS 页面直连 http://localhost 会被浏览器按「混合内容」拦截，
        本地端点还需允许本站来源的跨域（如 ollama 设置 OLLAMA_ORIGINS）。
        在本机 http 开发环境下不受此限。
      </p>
    </main>
  )
}

'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { clearDeviceConfig, getDeviceConfig, getRequestSource, getRequestSourceServer, setRequestSource, subscribeRequestSource } from '@/lib/translate/deviceTranslation'

export function CloudRequestSwitch() {
  const source = useSyncExternalStore(subscribeRequestSource, getRequestSource, getRequestSourceServer)
  const [status, setStatus] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (source !== 'device') return
    let alive = true
    void getDeviceConfig().then((config) => {
      if (alive) setStatus(`已就绪 · ${config.model} · ${new URL(config.baseUrl).hostname}`)
    }).catch(() => { if (alive) setStatus('配置获取失败，请重试或切回 Vercel。') })
    return () => { alive = false }
  }, [source, attempt])
  function toggle() {
    setStatus('正在获取网站模型配置…')
    setRequestSource(source === 'device' ? 'vercel' : 'device')
  }
  return <section className="rounded-[10px] border border-rule bg-card p-4">
    <div className="flex items-center justify-between gap-4">
      <div><h2 className="text-base font-medium text-ink">云端翻译请求位置</h2><p className="mt-1 text-sm text-ink-2">当前：{source === 'device' ? '由当前设备发起' : '由 Vercel 发起'}</p></div>
      <button type="button" role="switch" aria-label="由当前设备发起云端翻译" aria-checked={source === 'device'} onClick={toggle} className="flex min-h-11 min-w-14 items-center justify-center rounded-lg focus-visible:outline-offset-4">
        <span className={`flex h-7 w-12 items-center rounded-full p-1 ${source === 'device' ? 'bg-ink justify-end' : 'bg-rule justify-start'}`}><span className="size-5 rounded-full bg-card" /></span>
      </button>
    </div>
    <p className="mt-3 text-sm leading-relaxed text-ink-3">开启后，单词和句子均由浏览器直接请求 AI，跳过词库查询；关闭后沿用原有查询和翻译流程。仅影响后续请求，选择会在当前浏览器记住。</p>
    <p className="mt-2 text-xs leading-relaxed text-ink-3">模型配置（含 API Key）保存在当前浏览器，刷新后复用，翻译时不再向 Vercel 检查配额。退出登录或切回 Vercel 会清除；上游需允许本站跨域。自定义本地模型继续优先。</p>
    {source === 'device' && <p role="status" className="mt-2 break-words text-xs text-ink-2">{status || '正在获取网站模型配置…'}</p>}
    {source === 'device' && <button type="button" disabled={status.startsWith('正在获取')} className="mt-1 min-h-11 text-sm text-ink underline disabled:opacity-50" onClick={() => { clearDeviceConfig(); setStatus('正在获取网站模型配置…'); setAttempt((value) => value + 1) }}>{status.startsWith('配置获取失败') ? '重试获取配置' : '重新获取配置'}</button>}
  </section>
}

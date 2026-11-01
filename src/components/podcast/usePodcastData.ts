'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export function usePodcastData<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const request = useRef<AbortController | null>(null)
  const load = useCallback(async (controller: AbortController) => {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '加载失败')
      if (!controller.signal.aborted) setData(body as T)
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败')
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [url])
  const reload = useCallback(() => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError(null)
    return load(controller)
  }, [load])
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async fetch updates state only when the external request settles.
    void load(controller)
    return () => request.current?.abort()
  }, [load])
  return { data, error, loading, reload }
}

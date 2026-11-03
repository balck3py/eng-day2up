'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { getLocalModelConfigSnapshot, getLocalModelConfigServerSnapshot, subscribeLocalModelConfig } from '@/lib/translate/localModel'
import { clearDeviceConfig, getDeviceConfig, getRequestSource, getRequestSourceServer, subscribeRequestSource } from '@/lib/translate/deviceTranslation'

export function TranslationBootstrap() {
  const pathname = usePathname()
  const source = useSyncExternalStore(subscribeRequestSource, getRequestSource, getRequestSourceServer)
  const local = useSyncExternalStore(subscribeLocalModelConfig, getLocalModelConfigSnapshot, getLocalModelConfigServerSnapshot)
  useEffect(() => {
    let userId: string | null | undefined
    const { data: { subscription } } = createBrowserSupabase().auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null
      if (event === 'SIGNED_OUT' || (userId !== undefined && next !== userId)) clearDeviceConfig()
      userId = next
    })
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (pathname.startsWith('/login') || pathname.startsWith('/auth')) { clearDeviceConfig(); return }
    if (source !== 'device' || local) return
    void getDeviceConfig().catch(() => { /* A translation or Settings can retry and show the error. */ })
  }, [source, local, pathname])
  return null
}

import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({}) }))
vi.mock('@/lib/quota', () => ({ consumeQuota: async () => true }))
vi.mock('@/lib/translate/instance', () => ({ getScheduler: () => ({ run: mocks.run }) }))
import { POST } from './route'
import { POST as explain } from '../explain/route'

it('响应流被取消时立即取消模型，并透传请求取消信号', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const cancel = vi.fn()
  mocks.run.mockResolvedValue({ provider: 'cloud', cancel, chunks: (async function* () { yield 'first'; await pending; yield 'late' })() })
  const abort = new AbortController()
  const request = new Request('https://test/api/translate', { method: 'POST', signal: abort.signal, body: JSON.stringify({ text: 'hello world' }) })
  const response = await POST(request)
  expect(mocks.run.mock.calls.at(-1)![1]).toBe(request.signal)
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('first')
  await reader.cancel()
  expect(cancel).toHaveBeenCalled()
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

it('上下文释义同样将取消信号传到模型', async () => {
  mocks.run.mockResolvedValue({ provider: 'cloud', cancel: vi.fn(), chunks: (async function* () { yield '解释' })() })
  const request = new Request('https://test/api/explain', { method: 'POST', body: JSON.stringify({ word: 'hello', context: 'hello world' }) })
  const response = await explain(request)
  expect((await response.json()).explanation).toBe('解释')
  expect(mocks.run.mock.calls.at(-1)![1]).toBe(request.signal)
})

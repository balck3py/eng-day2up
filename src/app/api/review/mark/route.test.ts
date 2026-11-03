import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, rpc: mock.rpc,
}) }))
import { POST } from './route'
const body = { id: '00000000-0000-4000-8000-000000000001', known: true, quizType: 'cn2en', reviewedAt: new Date().toISOString() }
const send = (value: unknown) => POST(new Request('https://test/api/review/mark', { method: 'POST', body: JSON.stringify(value) }))
beforeEach(() => { mock.rpc.mockReset(); mock.rpc.mockResolvedValue({ data: { familiarity: 1, reviewCount: 1, spellOkCount: 1 }, error: null }) })
it('传递持久化事件身份给原子 RPC，直接返回数据库的去重结果', async () => {
  const response = await send({ ...body, eventId: 'saved-queue-key' })
  expect(await response.json()).toEqual({ familiarity: 1, reviewCount: 1, spellOkCount: 1 })
  expect(mock.rpc).toHaveBeenCalledWith('mark_review', expect.objectContaining({ p_event_id: 'saved-queue-key', p_id: body.id, p_known: true, p_quiz_type: 'cn2en' }))
})
it('老标签页没有事件 ID，原始作答时间仍能生成稳定重试身份', async () => {
  await send(body); await send(body)
  expect(mock.rpc.mock.calls[0][1].p_event_id).toBe(mock.rpc.mock.calls[1][1].p_event_id)
  expect(mock.rpc.mock.calls[0][1].p_event_id).toContain(body.reviewedAt)
})
it('已删除的词返回 404，补写队列能丢弃无效记录', async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: '记录不存在' } })
  expect((await send(body)).status).toBe(404)
})

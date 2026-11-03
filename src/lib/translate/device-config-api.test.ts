import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { getUser, quota, admin } = vi.hoisted(() => ({ getUser: vi.fn(), quota: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: admin }))
vi.mock('@/lib/quota', () => ({ consumeQuota: quota }))
import { GET, POST } from '@/app/api/translate/config/route'
const request = (method = 'GET', headers?: HeadersInit) => new Request('https://app.example/api/translate/config', { method, headers })
beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'user-one', email: 'one@example.test' } } })
  quota.mockResolvedValue(true); admin.mockReturnValue({})
  vi.stubEnv('ALLOWED_EMAILS', 'one@example.test')
  vi.stubEnv('CLOUD_BASE_URL', 'https://model.example/v1')
  vi.stubEnv('CLOUD_MODEL', 'test-model'); vi.stubEnv('CLOUD_API_KEY', 'test-key-not-real')
  vi.stubEnv('CLOUD_KEEP_THINKING', '')
})
afterEach(() => vi.unstubAllEnvs())

it('returns only the device model fields to an allowed account, without charging or caching', async () => {
  const response = await GET(request())
  expect(await response.json()).toEqual({ baseUrl: 'https://model.example/v1', model: 'test-model', apiKey: 'test-key-not-real', disableThinking: true })
  expect(response.headers.get('Cache-Control')).toContain('private, no-store')
  expect(response.headers.get('Vary')).toBe('Cookie')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  expect(quota).not.toHaveBeenCalled(); expect(admin).not.toHaveBeenCalled()
  vi.stubEnv('CLOUD_KEEP_THINKING', '1')
  expect((await (await GET(request())).json()).disableThinking).toBe(false)
})

it.each([GET, POST])('requires authentication and allowlist permission before returning config or charging', async (handler) => {
  getUser.mockResolvedValue({ data: { user: null } })
  const anonymous = await handler(request(handler === GET ? 'GET' : 'POST'))
  expect(anonymous.status).toBe(401)
  expect(await anonymous.text()).not.toContain('test-key-not-real')
  getUser.mockResolvedValue({ data: { user: { id: 'other', email: 'other@example.test' } } })
  const denied = await handler(request(handler === GET ? 'GET' : 'POST'))
  expect(denied.status).toBe(403)
  expect(denied.headers.get('Cache-Control')).toContain('no-store')
  expect(quota).not.toHaveBeenCalled()
})

it.each([GET, POST])('rejects foreign origins even for a valid session', async (handler) => {
  expect((await handler(request('GET', { Origin: 'https://other.example' }))).status).toBe(403)
  expect((await handler(request('GET', { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403)
  expect(getUser).not.toHaveBeenCalled(); expect(quota).not.toHaveBeenCalled()
})

it('keeps quota checks for device calls and returns 429 before a model can be called', async () => {
  expect((await POST(request('POST', { Origin: 'https://app.example' }))).status).toBe(200)
  expect(quota).toHaveBeenCalledWith({}, 'user-one')
  quota.mockResolvedValue(false)
  const response = await POST(request('POST'))
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({ error: '已达今日翻译配额上限，明日 0 点重置。' })
})

it('fails gracefully without configured credentials or a secure device endpoint', async () => {
  vi.stubEnv('CLOUD_API_KEY', '')
  expect((await GET(request())).status).toBe(503)
  vi.stubEnv('CLOUD_API_KEY', 'test-key-not-real'); vi.stubEnv('CLOUD_BASE_URL', 'http://model.example/v1')
  const response = await GET(request())
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('test-key-not-real')
})

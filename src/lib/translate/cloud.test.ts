import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudProvider } from './cloud'

function sseBody(lines: string[]) {
  return new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(l + '\n'))
      c.close()
    },
  })
}

describe('createCloudProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('CLOUD_BASE_URL', 'https://api.test/v1')
    vi.stubEnv('CLOUD_API_KEY', 'k')
    vi.stubEnv('CLOUD_MODEL', 'm')
    fetchMock = vi.fn(async () =>
      new Response(sseBody(['data: {"choices":[{"delta":{"content":"好"}}]}', 'data: [DONE]'])),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function sentBody() {
    for await (const chunk of createCloudProvider().stream([{ role: 'user', content: 'x' }])) {
      void chunk
    }
    return JSON.parse(fetchMock.mock.calls[0][1].body as string)
  }

  it('默认关闭推理模型的思考', async () => {
    expect((await sentBody()).thinking).toEqual({ type: 'disabled' })
  })

  it('CLOUD_KEEP_THINKING=1 时不带该参数（给不认识它的端点用）', async () => {
    vi.stubEnv('CLOUD_KEEP_THINKING', '1')
    expect(await sentBody()).not.toHaveProperty('thinking')
  })
})

// Isolated test auth service. Never used by production or real Supabase accounts.
import { createServer } from 'node:http'
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'podcast-test@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(req.url === '/auth/v1/user' ? user : { ok: true }))
}).listen(54329, '127.0.0.1')

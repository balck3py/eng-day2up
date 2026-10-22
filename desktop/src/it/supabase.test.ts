/**
 * 集成测试：真实 Supabase + E2E 专用测试账号。默认跳过，`npm run test:it`（DESKTOP_IT=1）才运行。
 * 安全约束：登录后先校验邮箱等于 E2E_EMAIL，不等立即中止，之前不做任何写操作；
 * 只插入、只删除当前用户下 word_key 以 zzqa 开头的行。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { lookupWord } from '../lib/lookup'
import { favorite, isSaved } from '../lib/favorite'
import { resolveContext } from '../lib/context'

const RUN = process.env.DESKTOP_IT === '1'
const PREFIX = 'zzqa'

describe.skipIf(!RUN)('集成：真实 Supabase（测试账号）', () => {
  let db: SupabaseClient
  let userId = ''

  async function cleanup() {
    if (!userId) return // 身份没校验通过就绝不删
    const { error } = await db.from('wordbook').delete().eq('user_id', userId).like('word_key', `${PREFIX}%`)
    if (error) throw error
  }

  beforeAll(async () => {
    // desktop/.env.local 优先，其次复用仓库根目录（网页）的 .env.local
    config({ path: ['.env.local', '../.env.local'], quiet: true })
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const email = process.env.E2E_EMAIL
    const password = process.env.E2E_PASSWORD
    if (!url || !anon || !email || !password) throw new Error('缺少 Supabase 配置或 E2E_EMAIL / E2E_PASSWORD')

    db = createClient(url, anon, { auth: { persistSession: false } })
    const { data, error } = await db.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data.user.email?.toLowerCase() !== email.toLowerCase()) {
      throw new Error(`登录身份 ${data.user.email} 与 E2E_EMAIL 不符，中止`)
    }
    userId = data.user.id
    await cleanup() // 清掉上次中断遗留的测试词
  })

  afterAll(cleanup)

  it('查词真实命中：精确与词形还原', async () => {
    expect((await lookupWord(db, 'stale')).matchedFrom).toBe('exact')
    const run = await lookupWord(db, 'running')
    expect(run.word).toBe('run')
    expect(run.senses.length).toBeGreaterThan(0)
  })

  it('收藏测试词并带上所在句子', async () => {
    const paragraph = `First point. The approach is ${PREFIX}pragmatic and fast. Done.`
    const word = `${PREFIX}pragmatic`
    const sourceContext = resolveContext(
      { text: word, paragraph, offset: paragraph.indexOf(word) },
      'word',
      word,
    )
    expect(await favorite(db, userId, { word, sourceContext })).toBe('added')

    const { data } = await db.from('wordbook').select('source_context').eq('word_key', word).single()
    expect(data?.source_context).toBe(`The approach is ${PREFIX}pragmatic and fast.`)
    expect(await isSaved(db, word)).toBe(true)
  })

  it('重复收藏不覆盖原有句子', async () => {
    const word = `${PREFIX}pragmatic`
    expect(await favorite(db, userId, { word, sourceContext: '新的句子' })).toBe('exists')
    const { data } = await db.from('wordbook').select('source_context').eq('word_key', word).single()
    expect(data?.source_context).toBe(`The approach is ${PREFIX}pragmatic and fast.`)
  })
})

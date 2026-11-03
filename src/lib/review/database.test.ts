import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, expect, it } from 'vitest'

const db = new PGlite()
const user = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const word = '00000000-0000-4000-8000-000000000003'

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${user}'),('${other}');`)
  for (const file of ['0001_init.sql', '0002_spell_ok_count.sql', '0003_review_leftover.sql', '0004_reliable_writes.sql']) {
    await db.exec(readFileSync(resolve('supabase/migrations', file), 'utf8'))
  }
  await db.exec(`grant select, insert, update, delete on public.wordbook to authenticated;
    insert into wordbook(id,user_id,word,word_key) values('${word}','${user}','hello','hello');`)
}, 20_000)
afterAll(() => db.close())

async function asUser(id: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`)
}
const mark = (event: string, known = true, quiz = 'cn2en', at = '2026-11-03T10:00:00Z') =>
  db.query<{ result: { familiarity: number; reviewCount: number; spellOkCount: number } }>(
    'select mark_review($1,$2,$3,$4,$5) as result', [word, event, known, quiz, at])

it('重复补写只记一次，返回首次结果；不同事件逐次原子更新', async () => {
  await asUser(user)
  const first = (await mark('lost-response')).rows[0].result
  expect(first).toEqual({ familiarity: 1, reviewCount: 1, spellOkCount: 1 })
  expect((await mark('lost-response')).rows[0].result).toEqual(first)
  await Promise.all([mark('second'), mark('third')])
  const current = await db.query('select familiarity,review_count,spell_ok_count from wordbook')
  expect(current.rows).toEqual([{ familiarity: 3, review_count: 3, spell_ok_count: 3 }])
})
it('熟练度满后忘记会清空拼写计数，旧事件不回退最近复习时间', async () => {
  await asUser(user)
  await mark('fourth'); await mark('fifth')
  expect((await mark('forgot', false, 'en2cn', '2026-11-02T00:00:00Z')).rows[0].result)
    .toEqual({ familiarity: 4, reviewCount: 6, spellOkCount: 0 })
  const current = await db.query<{ at: string }>('select last_reviewed_at::text as at from wordbook')
  expect(current.rows[0].at).toContain('2026-11-03')
})
it('RPC 保留 RLS，其他用户不能修改记录', async () => {
  await asUser(other)
  await expect(mark('foreign')).rejects.toThrow('记录不存在')
})
it('AI 同词并发保存不重复，已有词典条目保持原释义', async () => {
  await db.exec('reset role')
  await Promise.all(Array.from({ length: 6 }, (_, i) => db.query('select save_ai_entry($1,$2,$3)', ['newword', `n. ${i}`, null])))
  const rows = await db.query('select translation from dict_entries where word_key=$1', ['newword'])
  expect(rows.rows).toEqual([{ translation: 'n. 0' }])
  await db.exec("insert into dict_entries(word,translation) values('hello','original')")
  await db.query('select save_ai_entry($1,$2,$3)', ['hello','replacement',null])
  expect((await db.query("select translation from dict_entries where word_key='hello'")).rows)
    .toEqual([{ translation: 'original' }])
})
it('导入稳定键支持重试 upsert，不影响无导入键的既有词条', async () => {
  const insert = "insert into dict_entries(word,import_key) values('imported','same-key') on conflict(import_key) do update set word=excluded.word"
  await db.exec(insert); await db.exec(insert)
  expect((await db.query("select count(*)::int as count from dict_entries where import_key='same-key'")).rows).toEqual([{ count: 1 }])
})

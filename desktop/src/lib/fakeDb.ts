import type { SupabaseClient } from '@supabase/supabase-js'

/** 测试用的内存版 supabase 客户端：只实现本项目用到的 select / in / eq / maybeSingle / insert。 */
type Row = Record<string, unknown>

export interface FakeDbOptions {
  /** insert 时返回的错误（如 { code: '23505' }） */
  insertError?: { code: string; message: string }
}

export function fakeDb(tables: Record<string, Row[]>, opts: FakeDbOptions = {}) {
  const log: string[] = []
  const db = {
    from(table: string) {
      return {
        select(_cols?: string) {
          log.push(`select ${table}`)
          let rows = tables[table] ?? []
          const q = {
            in(col: string, vals: unknown[]) {
              rows = rows.filter((r) => vals.includes(r[col]))
              return q
            },
            eq(col: string, val: unknown) {
              rows = rows.filter((r) => r[col] === val)
              return q
            },
            maybeSingle() {
              return Promise.resolve({ data: rows[0] ?? null, error: null })
            },
            then<T>(ok: (v: { data: Row[]; error: null }) => T, fail?: (e: unknown) => T) {
              return Promise.resolve({ data: rows, error: null }).then(ok, fail)
            },
          }
          return q
        },
        insert(row: Row) {
          log.push(`insert ${table}`)
          if (opts.insertError) return Promise.resolve({ error: opts.insertError })
          ;(tables[table] ??= []).push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, log, tables }
}

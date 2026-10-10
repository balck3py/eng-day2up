import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWord } from './normalize'
import { MAX_SENTENCE } from './sentence'

export type FavoriteResult = 'added' | 'exists'

/** 该词是否已在单词本（RLS 只返回当前用户的行）。 */
export async function isSaved(db: SupabaseClient, word: string): Promise<boolean> {
  const key = normalizeWord(word)
  if (!key) return false
  const { data } = await db.from('wordbook').select('id').eq('word_key', key).maybeSingle()
  return !!data
}

/**
 * 收藏：先查，已存在就不动它（绝不覆盖旧的 source_context）；
 * 插入撞上唯一约束（23505，并发或别处刚收藏）同样按已存在处理。不用 upsert。
 */
export async function favorite(
  db: SupabaseClient,
  userId: string,
  input: { word: string; sourceContext: string | null },
): Promise<FavoriteResult> {
  const word = input.word.trim()
  const key = normalizeWord(word)
  if (!key) throw new Error('缺少单词')
  if (await isSaved(db, word)) return 'exists'

  const { error } = await db.from('wordbook').insert({
    user_id: userId,
    word,
    word_key: key,
    source_context: input.sourceContext?.slice(0, MAX_SENTENCE) || null,
  })
  if (!error) return 'added'
  if (error.code === '23505') return 'exists'
  throw new Error(error.message)
}

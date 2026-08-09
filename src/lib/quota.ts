import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_QUOTA = 200

/**
 * 原子递增当日用量并判断是否超额。
 * 返回 true 表示可以继续；false 表示已超出每日配额。
 *
 * RPC 调用失败时返回 true（放行）—— 配额是防滥用手段，
 * 不应因为计数表的故障而让正常用户完全不能用。
 *
 * 这里的放行是安全的，与注册路由那处刻意的 fail-closed 不同：调用方已经
 * 校验过登录态，userId 来自会话而非请求体，最坏情况只是某个已授权用户
 * 当天多用了几次。
 *
 * 必须用 service_role 客户端调用 —— increment_usage 已从 PUBLIC 撤权，
 * 只 grant 给 authenticated 与 service_role。
 */
export async function consumeQuota(
  db: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const limit = Number.parseInt(process.env.DAILY_QUOTA ?? '', 10) || DEFAULT_QUOTA
  const { data, error } = await db.rpc('increment_usage', {
    p_user: userId,
    p_limit: limit,
  })
  if (error) {
    console.error('配额检查失败，放行:', error.message)
    return true
  }
  return data === true
}

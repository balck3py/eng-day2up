import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = await createServerSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  // RLS 保证只能删自己的记录，删别人的会静默影响 0 行
  const { error } = await db.from('wordbook').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

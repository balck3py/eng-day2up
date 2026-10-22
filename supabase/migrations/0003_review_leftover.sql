-- 上一轮生词名单：最近一次「常规复习」里答不出来的那批词。
--
-- 存的是一轮的完整快照，只由下一次常规复习结算时整批替换（replace_review_leftover）；
-- 「只练生词」等重练轮次里记住了几个也不减。见
-- openspec/changes/review-leftover-words/design.md 决策 1-3。

create table review_leftover (
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- 单词本删词时名单跟着变短，不留悬空 id
  wordbook_id uuid not null references wordbook(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, wordbook_id)
);

alter table review_leftover enable row level security;

create policy review_leftover_owner on review_leftover
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 整批替换：删旧插新放在一个函数里，就是一个事务，不会出现「删了没插上」的空名单。
--
-- security invoker（默认）：照常受 RLS 约束，只能删、插自己的行；insert 的来源
-- 再显式按 user_id 过滤，传进别人的 wordbook id 会被静默丢掉。
create or replace function replace_review_leftover(p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception '未登录';
  end if;
  -- 零生词的常规复习不覆盖名单 —— 客户端会判断，这里再兜一层，
  -- 免得一个空请求把名单清掉
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception '生词名单不能为空';
  end if;

  delete from review_leftover where user_id = v_uid;

  insert into review_leftover (user_id, wordbook_id)
  select v_uid, w.id
  from wordbook w
  where w.id = any(p_ids) and w.user_id = v_uid;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 同 0001：CREATE FUNCTION 默认 GRANT EXECUTE TO PUBLIC，先从 PUBLIC 撤销再授回。
revoke all on function replace_review_leftover(uuid[]) from public;
revoke all on function replace_review_leftover(uuid[]) from anon;
grant execute on function replace_review_leftover(uuid[]) to authenticated;

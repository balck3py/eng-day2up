-- 复习事件去重与行锁更新，避免补写重复计分、并发覆盖。
create table public.review_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  wordbook_id uuid not null references public.wordbook(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.review_events enable row level security;
create policy review_events_owner on public.review_events for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert on public.review_events to authenticated;

create or replace function public.mark_review(
  p_id uuid, p_event_id text, p_known boolean, p_quiz_type text, p_reviewed_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_word public.wordbook%rowtype;
  v_result jsonb;
  v_familiarity int;
  v_spell int;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  if p_event_id is null or length(p_event_id) = 0 or length(p_event_id) > 200 then
    raise exception '复习事件无效';
  end if;
  select * into v_word from public.wordbook
    where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception '记录不存在' using errcode = 'P0002'; end if;

  select result into v_result from public.review_events
    where user_id = auth.uid() and event_id = p_event_id;
  if found then return v_result; end if;

  v_familiarity := least(5, greatest(0, v_word.familiarity)) + case when p_known then 1 else -1 end;
  v_familiarity := least(5, greatest(0, v_familiarity));
  v_spell := greatest(0, coalesce(v_word.spell_ok_count, 0));
  if v_word.familiarity >= 5 and not p_known then v_spell := 0;
  elsif p_known and p_quiz_type = 'cn2en' then v_spell := v_spell + 1;
  end if;
  update public.wordbook set familiarity = v_familiarity,
    review_count = v_word.review_count + 1, spell_ok_count = v_spell,
    last_reviewed_at = greatest(last_reviewed_at, p_reviewed_at)
    where id = p_id;
  v_result := jsonb_build_object('familiarity', v_familiarity,
    'reviewCount', v_word.review_count + 1, 'spellOkCount', v_spell);
  insert into public.review_events(user_id, event_id, wordbook_id, result)
    values(auth.uid(), p_event_id, p_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.mark_review(uuid, text, boolean, text, timestamptz) from public, anon;
grant execute on function public.mark_review(uuid, text, boolean, text, timestamptz) to authenticated;

-- 共享词库允许原始词典存在同键词条；AI 写入通过按词事务锁实现“仅缺失时插入”。
create or replace function public.save_ai_entry(p_word text, p_translation text, p_phonetic text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(p_word), 0));
  if not exists(select 1 from public.dict_entries where word_key = lower(p_word)) then
    insert into public.dict_entries(word, translation, phonetic)
      values(p_word, p_translation, p_phonetic);
  end if;
end;
$$;
revoke all on function public.save_ai_entry(text, text, text) from public, anon, authenticated;
grant execute on function public.save_ai_entry(text, text, text) to service_role;

-- 导入内容的稳定标识：同一批重试仍是同一行，既有词条不受影响。
alter table public.dict_entries add column import_key text;
create unique index dict_entries_import_key_idx on public.dict_entries(import_key);
notify pgrst, 'reload schema';

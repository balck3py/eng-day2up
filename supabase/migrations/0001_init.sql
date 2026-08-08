-- ============ 词典层（全局共享，只读） ============

create table dict_entries (
  id          bigserial primary key,
  word        text not null,
  word_key    text generated always as (lower(word)) stored,
  phonetic    text,
  translation text,
  definition  text,
  pos         text,
  collins     smallint,
  oxford      smallint,
  tag         text,
  bnc         integer,
  frq         integer,
  exchange    text
);
create index dict_entries_word_key_idx on dict_entries (word_key);

create table dict_lemma (
  form  text not null,
  lemma text not null,
  primary key (form, lemma)
);
create index dict_lemma_form_idx on dict_lemma (form);

create table dict_cache (
  word_key    text primary key,
  phonetic_us text,
  phonetic_uk text,
  audio_us    text,
  audio_uk    text,
  found       boolean not null,
  fetched_at  timestamptz not null default now()
);

-- ============ 用户层 ============

create table wordbook (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  word             text not null,
  word_key         text not null,
  source_context   text,
  note             text,
  review_count     int not null default 0,
  familiarity      smallint not null default 0,
  last_reviewed_at timestamptz,
  -- SM-2 预留字段，Plan 1-3 均不参与逻辑
  due_at           timestamptz,
  ease_factor      real not null default 2.5,
  interval_days    int not null default 0,
  created_at       timestamptz not null default now(),
  unique (user_id, word_key)
);
create index wordbook_user_idx on wordbook (user_id, created_at desc);

create table usage_counter (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int not null default 0,
  primary key (user_id, day)
);

-- ============ RLS ============

alter table dict_entries enable row level security;
alter table dict_lemma   enable row level security;
alter table dict_cache   enable row level security;
alter table wordbook     enable row level security;
alter table usage_counter enable row level security;

-- 词典对登录用户只读；写入只走 service_role（service_role 自动绕过 RLS）
create policy dict_entries_read on dict_entries
  for select to authenticated using (true);
create policy dict_lemma_read on dict_lemma
  for select to authenticated using (true);
create policy dict_cache_read on dict_cache
  for select to authenticated using (true);

-- 用户数据严格按 user_id 隔离
create policy wordbook_owner on wordbook
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy usage_owner on usage_counter
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============ 配额 RPC（Plan 2 使用） ============
-- 原子递增当日计数，返回 true 表示未超额

create or replace function increment_usage(p_user uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- security definer 会绕过 RLS，因此必须自行校验身份：
  -- 登录用户只能操作自己的配额；service_role 调用时 auth.uid() 为 null，放行。
  if auth.uid() is not null and auth.uid() <> p_user then
    raise exception '无权操作他人的配额';
  end if;

  insert into usage_counter (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day)
  do update set count = usage_counter.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

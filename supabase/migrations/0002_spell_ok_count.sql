-- 拼写练习计数：中译英卡上「拼对」过几次。
--
-- 用来兜住一条规则：熟练度未满的词至少要拼对两次（src/lib/review/mark.ts 的
-- SPELL_QUOTA），光靠题型比例随机撞不出这个保证。默认 0，所以现存所有生词
-- 开箱即欠两次拼写 —— 正是想要的。
alter table wordbook
  add column spell_ok_count smallint not null default 0;

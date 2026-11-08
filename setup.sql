-- 店面记账 App：云数据库建表脚本（在 Supabase 的 SQL Editor 里整段粘贴运行一次即可）
-- 流程：每一单发给相关业务员确认 → 相关的人都确认后这一单自动锁定 → 每 2-3 个月勾选已确认的单子结算（算钱）

create extension if not exists pgcrypto;

create table if not exists agents (
  id bigserial primary key,
  name text unique not null,
  phone4 text not null default '',
  device_token text unique,
  sort int not null default 0,
  active boolean not null default true
);
alter table agents add column if not exists auto_confirm boolean not null default false;  -- 自动确认（不会用手机的人）

-- 一次结算（算钱）
create table if not exists settlements (
  id bigserial primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists deals (
  id bigserial primary key,
  deal_date date not null,
  type text not null check (type in ('二手买卖', '租房', '新房')),
  title text not null default '',
  incomes jsonb not null default '[]',
  expenses jsonb not null default '[]',
  listing_agents text[] not null default '{}',
  client_agents text[] not null default '{}',
  note text not null default '',
  status text not null default 'draft' check (status in ('draft', 'confirming', 'locked')),
  locked_at timestamptz,
  settlement_id bigint references settlements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 后来加的字段（重新运行整个脚本时会自动补上，已有数据不受影响）
alter table deals add column if not exists owner_name text not null default '';     -- 房东名字
alter table deals add column if not exists customer_name text not null default '';  -- 客户名字
alter table deals add column if not exists reopen_note text not null default '';    -- 撤回重改的原因
alter table deals add column if not exists reopen_count int not null default 0;     -- 撤回重改过几次

-- 每一单每位业务员的确认
create table if not exists confirmations (
  deal_id bigint not null references deals(id) on delete cascade,
  agent_name text not null,
  status text not null check (status in ('ok', 'question')),
  note text not null default '',
  at timestamptz not null default now(),
  primary key (deal_id, agent_name)
);

-- 2026-11-08：周增花 改名 邹增花（名字写错了）。所有地方一起改：业务员、单子、确认记录、房源、反馈。
-- 改名时临时关掉 deals 上的触发器（已锁定的单子平时不让改），改完马上打开。
do $$
begin
  if exists (select 1 from agents where name = '周增花') and not exists (select 1 from agents where name = '邹增花') then
    alter table deals disable trigger user;
    update agents set name = '邹增花' where name = '周增花';
    update deals set listing_agents = array_replace(listing_agents, '周增花', '邹增花'),
                     client_agents = array_replace(client_agents, '周增花', '邹增花'),
                     expenses = replace(expenses::text, '"周增花"', '"邹增花"')::jsonb
      where '周增花' = any(listing_agents) or '周增花' = any(client_agents) or expenses::text like '%"周增花"%';
    alter table confirmations disable trigger user;
    update confirmations set agent_name = '邹增花' where agent_name = '周增花';
    alter table confirmations enable trigger user;
    alter table deals enable trigger user;
    if to_regclass('public.listings') is not null then
      execute $q$update listings set agents = array_replace(agents, '周增花', '邹增花'),
        note_log = replace(note_log::text, '"周增花"', '"邹增花"')::jsonb,
        note_by = case when note_by = '周增花' then '邹增花' else note_by end,
        created_by = case when created_by = '周增花' then '邹增花' else created_by end,
        updated_by = case when updated_by = '周增花' then '邹增花' else updated_by end,
        filled_by = case when filled_by = '周增花' then '邹增花' else filled_by end
        where '周增花' = any(agents) or note_log::text like '%周增花%' or '周增花' in (note_by, created_by, updated_by, filled_by)$q$;
    end if;
    if to_regclass('public.listing_feedback') is not null then
      execute $q$update listing_feedback set author = '邹增花' where author = '周增花'$q$;
    end if;
  end if;
end $$;

insert into agents (name, sort) values
  ('石文倩',0),('安丽霞',1),('李秀英',2),('邹增花',3),('王海燕',4),('赵春芹',5),('马美景',6),
  ('张建华',7),('高梅',8),('吕绪红',9),('杨业沙',10),('朱文虎',11),('翁星宇',12)
on conflict (name) do nothing;

-- 这一单要确认的人（新房没有房源方）
create or replace function deal_people(d deals) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct n), '{}') from unnest(
    case when d.type in ('新房', '合作') then d.client_agents else d.listing_agents || d.client_agents end) n;
$$;

-- ---------- 规则 ----------
create or replace function guard_deals() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'locked' then raise exception '这一单大家已经确认锁定，不能删除'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if old.status = 'locked' and current_setting('app.reopen', true) = 'on' then
      -- 店面撤回重改（只能通过 reopen_deal）：确认作废，回到待确认
      delete from confirmations where deal_id = old.id;
      return new;
    end if;
    if old.status = 'locked' then
      -- 锁定后只允许结算（改 settlement_id），以及改客户名字、电话（不影响分钱）
      if row(new.deal_date, new.type, new.title, new.owner_name, new.incomes, new.expenses, new.listing_agents, new.client_agents, new.note, new.status, new.reopen_note, new.reopen_count)
         is distinct from row(old.deal_date, old.type, old.title, old.owner_name, old.incomes, old.expenses, old.listing_agents, old.client_agents, old.note, old.status, old.reopen_note, old.reopen_count) then
        raise exception '这一单大家已经确认锁定，不能再改';
      end if;
      return new;
    end if;
    if new.settlement_id is not null and old.settlement_id is null then
      raise exception '这一单还没有全部确认，不能结算';
    end if;
    if new.status = 'locked' and old.status <> 'locked' and current_setting('app.locking', true) is distinct from 'on' then
      raise exception '要等相关业务员都确认后才会自动锁定';
    end if;
    -- 内容改了或撤回成草稿：确认作废，需要重新确认（客户名字、电话不影响分钱，客户方业务员确认时会补，不作废）
    if row(old.deal_date, old.type, old.incomes, old.expenses, old.listing_agents, old.client_agents, old.owner_name)
         is distinct from row(new.deal_date, new.type, new.incomes, new.expenses, new.listing_agents, new.client_agents, new.owner_name)
       or new.status = 'draft' then
      delete from confirmations where deal_id = old.id;
    end if;
  end if;
  if tg_op = 'INSERT' and (new.status = 'locked' or new.settlement_id is not null) then
    raise exception '新记的单子不能直接锁定或结算';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_deals on deals;
create trigger trg_guard_deals before insert or update or delete on deals for each row execute function guard_deals();

-- 确认后检查：相关的人都确认了就自动锁定
create or replace function after_confirm() returns trigger language plpgsql security definer set search_path = public as $$
declare d deals;
begin
  select * into d from deals where id = new.deal_id;
  if d.status = 'confirming' and cardinality(deal_people(d)) > 0 and not exists (
       select 1 from unnest(deal_people(d)) n
        where not exists (select 1 from confirmations c where c.deal_id = d.id and c.agent_name = n and c.status = 'ok')) then
    perform set_config('app.locking', 'on', true);
    update deals set status = 'locked', locked_at = now() where id = d.id;
    perform set_config('app.locking', 'off', true);
  end if;
  return new;
end $$;
drop trigger if exists trg_after_confirm on confirmations;
create trigger trg_after_confirm after insert or update on confirmations for each row execute function after_confirm();

create or replace function guard_conf() returns trigger language plpgsql as $$
begin
  if tg_op <> 'DELETE' and exists (select 1 from deals where id = new.deal_id and status <> 'confirming') then
    raise exception '这一单现在不能确认';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_guard_conf on confirmations;
create trigger trg_guard_conf before insert or update on confirmations for each row execute function guard_conf();

-- 勾选几单结算（店面用）
create or replace function create_settlement(p_name text, p_deal_ids bigint[]) returns bigint
language plpgsql as $$
declare sid bigint;
begin
  if exists (select 1 from deals where id = any(p_deal_ids) and (settlement_id is not null or status <> 'locked')) then
    raise exception '只能结算已经确认、还没结算的单子，请刷新';
  end if;
  insert into settlements (name) values (p_name) returning id into sid;
  update deals set settlement_id = sid where id = any(p_deal_ids);
  return sid;
end $$;

-- 已确认锁定、还没结算的单子发现算错了：店面撤回重改。确认作废，业务员要重新确认（店面用）
create or replace function reopen_deal(p_id bigint, p_reason text) returns void
language plpgsql as $$
declare d deals;
begin
  select * into d from deals where id = p_id;
  if not found or d.status <> 'locked' then raise exception '这一单没有锁定，直接改就行'; end if;
  if d.settlement_id is not null then raise exception '这一单已经结算了，请先在“结算记录”里撤销这次结算'; end if;
  perform set_config('app.reopen', 'on', true);
  update deals set status = 'confirming', locked_at = null, reopen_note = coalesce(p_reason, ''), reopen_count = reopen_count + 1 where id = p_id;
  perform set_config('app.reopen', 'off', true);
end $$;

-- ---------- 权限：只有登录的店面账号能读写；业务员只能通过下面几个函数 ----------
alter table agents enable row level security;
alter table settlements enable row level security;
alter table deals enable row level security;
alter table confirmations enable row level security;
drop policy if exists shop_all on agents;        create policy shop_all on agents        for all to authenticated using (true) with check (true);
drop policy if exists shop_all on settlements;   create policy shop_all on settlements   for all to authenticated using (true) with check (true);
drop policy if exists shop_all on deals;         create policy shop_all on deals         for all to authenticated using (true) with check (true);
drop policy if exists shop_all on confirmations; create policy shop_all on confirmations for all to authenticated using (true) with check (true);
revoke all on function create_settlement(text, bigint[]) from public, anon;
grant execute on function create_settlement(text, bigint[]) to authenticated;
revoke all on function reopen_deal(bigint, text) from public, anon;
grant execute on function reopen_deal(bigint, text) to authenticated;

create or replace function aunt_names() returns table(name text, bound boolean)
language sql security definer set search_path = public as $$
  select a.name, a.device_token is not null from agents a where a.active and not a.auto_confirm order by a.sort, a.id;  -- 自动确认的人不用登记
$$;

-- 业务员第一次打开：选名字 + 店面私下发的个人密码（存在 phone4 列）。输错 5 次锁住，要店面解锁。
-- 输错时返回 'ERR:…' 而不是报错，这样输错次数才能存下来。
alter table agents add column if not exists fail_count int not null default 0;
create or replace function aunt_bind(p_name text, p_phone4 text) returns text
language plpgsql security definer set search_path = public as $$
declare a agents; t text;
begin
  select * into a from agents where name = p_name and active;
  if not found then return 'ERR:找不到这个名字'; end if;
  if a.fail_count >= 5 then return 'ERR:密码输错太多次，已经锁住了，请找店面解锁'; end if;
  if a.phone4 = '' or a.phone4 <> p_phone4 then
    update agents set fail_count = fail_count + 1 where id = a.id;
    if a.fail_count + 1 >= 5 then return 'ERR:密码输错太多次，已经锁住了，请找店面解锁'; end if;
    return 'ERR:密码不对，还能再试 ' || (4 - a.fail_count) || ' 次';
  end if;
  -- 换手机或微信清了缓存：输对密码就重新绑定，旧手机自动失效
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update agents set device_token = t, fail_count = 0 where id = a.id;
  return t;
end $$;

-- 业务员看到：她参与的、已发出的单子（含她的确认）+ 最近的结算记录
create or replace function aunt_statement(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare a agents; r json;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then return null; end if;
  select json_build_object(
    'name', a.name,
    'deals', coalesce((select json_agg(json_build_object(
        'deal', row_to_json(d),
        'confirmation', (select row_to_json(c) from confirmations c where c.deal_id = d.id and c.agent_name = a.name)
      ) order by d.deal_date desc, d.id desc)
      from deals d left join settlements s on s.id = d.settlement_id
      where d.status <> 'draft' and a.name = any(deal_people(d))
        and (d.settlement_id is null or s.created_at > now() - interval '400 days')), '[]'::json),
    'settlements', coalesce((select json_agg(row_to_json(s) order by s.created_at desc) from settlements s
      where s.created_at > now() - interval '400 days'
        and exists (select 1 from deals d where d.settlement_id = s.id and a.name = any(deal_people(d)))), '[]'::json)
  ) into r;
  return r;
end $$;

alter table deals add column if not exists customer_phone text not null default '';
drop function if exists aunt_confirm(text, bigint, text, text);
-- 客户方业务员确认时必须补全客户名字和电话（店面留存）
create or replace function aunt_confirm(p_token text, p_deal bigint, p_status text, p_note text, p_cust_name text default null, p_cust_phone text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a agents; d deals; cn text; cp text;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then raise exception '请重新登记'; end if;
  select * into d from deals where id = p_deal for update;
  if not found or d.status <> 'confirming' then raise exception '这一单现在不能确认'; end if;
  if not (a.name = any(deal_people(d))) then raise exception '这一单没有您'; end if;
  if p_status = 'ok' and a.name = any(d.client_agents) and d.parent_id is null then  -- 补记的返点不用再填客户
    cn := coalesce(nullif(trim(p_cust_name), ''), d.customer_name);
    cp := coalesce(nullif(trim(p_cust_phone), ''), d.customer_phone);
    if coalesce(cn, '') = '' then raise exception '您是客户方业务员，请先填客户名字'; end if;
    if length(regexp_replace(coalesce(cp, ''), '\D', '', 'g')) < 7 then raise exception '您是客户方业务员，请先填客户电话'; end if;
    update deals set customer_name = cn, customer_phone = cp where id = p_deal;
  end if;
  insert into confirmations (deal_id, agent_name, status, note, at) values (p_deal, a.name, p_status, coalesce(p_note, ''), now())
  on conflict (deal_id, agent_name) do update set status = excluded.status, note = excluded.note, at = now();
end $$;

revoke all on function aunt_names(), aunt_bind(text, text), aunt_statement(text), aunt_confirm(text, bigint, text, text, text, text) from public;
grant execute on function aunt_names(), aunt_bind(text, text), aunt_statement(text), aunt_confirm(text, bigint, text, text, text, text) to anon, authenticated;


-- ---------- 房源记录（店面全部能改；业务员能看、改备注、写联系反馈） ----------
create table if not exists listings (
  id bigserial primary key,
  kind text not null default '出售' check (kind in ('出售', '出租')),
  community text not null default '',      -- 小区
  unit text not null default '',           -- 坐落
  layout text not null default '',         -- 户型，例如 3室2厅
  area numeric,                            -- 面积（平方米）
  decoration text not null default '',     -- 装修
  price numeric,                           -- 出售：总价（万元）；出租：月租（元）
  owners jsonb not null default '[]',      -- 房东，可以有好几个：[{"name":"孙先生","phone":"138…"}]
  agents text[] not null default '{}',     -- 负责的业务员，可以多个
  status text not null default 'active' check (status in ('active', 'done', 'off')),
  note text not null default '',
  created_at date not null default current_date,
  updated_at timestamptz not null default now()
);
alter table listings enable row level security;
drop policy if exists shop_all on listings; create policy shop_all on listings for all to authenticated using (true) with check (true);
alter table listings add column if not exists note_by text not null default '';
alter table listings add column if not exists note_at timestamptz;
-- 备注修改记录：[{by, at, note}]，每改一次加一条
alter table listings add column if not exists note_log jsonb not null default '[]';

-- 第二版：户型分类、几室几厅、电梯（房源维护人就是 agents：负责的业务员。业务员那边没有改它的入口，只有店面后台能改）
alter table listings add column if not exists category text not null default '';
alter table listings add column if not exists rooms int;
alter table listings add column if not exists halls int;
alter table listings add column if not exists elevator boolean not null default false;
do $$ begin
  alter table listings drop constraint if exists listings_category_check;
  alter table listings add constraint listings_category_check check (category in ('', '小户', '小户带阁楼', '中户', '中户带阁楼', '大户', '大户带阁楼', '特大户', '特大户带阁楼', '商品房', '商铺'));
end $$;

-- 同一套房子（小区 + 坐落，去掉空格后相同）只能录一次
create unique index if not exists listings_same_house on listings (
  (regexp_replace(community, '\s', '', 'g')), (regexp_replace(unit, '\s', '', 'g')));

-- 记账和房源连起来：一单记了账，对应房源自动变成已售 / 已租；这单删掉或换了房源，原来的房源变回在售 / 在租
alter table deals add column if not exists listing_id bigint references listings(id) on delete set null;
create or replace function deals_sync_listing() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.listing_id is not null
     and (tg_op = 'DELETE' or new.listing_id is distinct from old.listing_id)
     and not exists (select 1 from deals where listing_id = old.listing_id and id <> old.id) then
    update listings set status = 'active', updated_at = now() where id = old.listing_id and status = 'done';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.listing_id is not null then
    update listings set status = 'done', updated_at = now() where id = new.listing_id and status <> 'done';
  end if;
  return null;
end $$;
drop trigger if exists deals_sync_listing on deals;
create trigger deals_sync_listing after insert or update of listing_id or delete on deals for each row execute function deals_sync_listing();

-- 联系反馈：谁、什么时候、反馈了什么，可以一直往下加
create table if not exists listing_feedback (
  id bigserial primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  author text not null default '',
  content text not null default '',
  created_at timestamptz not null default now()
);
alter table listing_feedback enable row level security;
drop policy if exists shop_all on listing_feedback; create policy shop_all on listing_feedback for all to authenticated using (true) with check (true);

-- 业务员（确认页）看房源：要有效的手机登记
create or replace function aunt_listings(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare a agents;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then return null; end if;
  return coalesce((select json_agg(to_jsonb(l) || jsonb_build_object(
      'mine', a.name = any(l.agents),
      'feedback', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from listing_feedback f where f.listing_id = l.id), '[]'::jsonb)
    ) order by l.created_at desc, l.id desc) from listings l where l.status <> 'off'), '[]'::json);
end $$;

create or replace function aunt_listing_note(p_token text, p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a agents;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then raise exception '请重新登记'; end if;
  update listings set note = coalesce(p_note, ''), note_by = a.name, note_at = now(), updated_at = now(),
    note_log = note_log || jsonb_build_object('by', a.name, 'at', now(), 'note', coalesce(p_note, ''))
    where id = p_id and note is distinct from coalesce(p_note, '');
end $$;

create or replace function aunt_listing_feedback(p_token text, p_id bigint, p_content text) returns void
language plpgsql security definer set search_path = public as $$
declare a agents;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then raise exception '请重新登记'; end if;
  if coalesce(trim(p_content), '') = '' then raise exception '反馈内容不能是空的'; end if;
  insert into listing_feedback (listing_id, author, content) values (p_id, a.name, trim(p_content));
end $$;

revoke all on function aunt_listings(text), aunt_listing_note(text, bigint, text), aunt_listing_feedback(text, bigint, text) from public;
grant execute on function aunt_listings(text), aunt_listing_note(text, bigint, text), aunt_listing_feedback(text, bigint, text) to anon, authenticated;

-- ---------- 2026-11-08：记账时自动建的房源，交给房源维护人（房源方业务员）补全；业务员也能自己录入、修改房源 ----------
-- needs_info = true：只有小区、坐落、房东、业务员，户型面积这些还没填。
-- 维护人有两个以上的话，每个人后台都能看到“待补全”，谁先补完就算谁的（filled_by），其他人那里自动消失。
alter table listings add column if not exists needs_info boolean not null default false;
alter table listings add column if not exists filled_by text not null default '';
alter table listings add column if not exists filled_at timestamptz;
alter table listings add column if not exists created_by text not null default '';
alter table listings add column if not exists updated_by text not null default '';
drop function if exists aunt_listing_fill(text, bigint, jsonb);
-- 业务员录入 / 修改房源。p_id 为空 = 新录入；不为空 = 修改房子信息。
-- 房源维护人（agents）只有新录入时能选（不选就是自己），以后业务员这边改不了，只有店面后台能改。状态也只有店面和记账能改。
create or replace function aunt_listing_save(p_token text, p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare a agents; l listings; ags text[]; new_id bigint;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then raise exception '请重新登记'; end if;
  if coalesce(trim(p->>'community'), '') = '' then raise exception '请选小区'; end if;
  if coalesce(trim(p->>'unit'), '') = '' then raise exception '请填坐落'; end if;
  if coalesce(p->>'kind', '') not in ('出售', '出租') then raise exception '请选出售还是出租'; end if;
  begin
    if p_id is null then
      select coalesce(array_agg(x), '{}') into ags from jsonb_array_elements_text(coalesce(p->'agents', '[]')) x where x in (select name from agents where active);
      if cardinality(ags) = 0 then ags := array[a.name]; end if;
      insert into listings (kind, community, unit, category, rooms, halls, area, price, elevator, decoration, owners, agents, status, note, note_by, note_at, note_log, created_by, updated_by)
      values (p->>'kind', trim(p->>'community'), trim(p->>'unit'), coalesce(p->>'category', ''),
        nullif(p->>'rooms', '')::int, nullif(p->>'halls', '')::int, nullif(p->>'area', '')::numeric, nullif(p->>'price', '')::numeric,
        coalesce((p->>'elevator')::boolean, false), coalesce(p->>'decoration', ''),
        case when jsonb_typeof(p->'owners') = 'array' then p->'owners' else '[]' end, ags, 'active',
        coalesce(p->>'note', ''), case when coalesce(p->>'note', '') <> '' then a.name else '' end, case when coalesce(p->>'note', '') <> '' then now() end,
        case when coalesce(p->>'note', '') <> '' then jsonb_build_array(jsonb_build_object('by', a.name, 'at', now(), 'note', p->>'note')) else '[]' end,
        a.name, a.name)
      returning id into new_id;
      return new_id;
    end if;
    select * into l from listings where id = p_id for update;
    if not found then raise exception '找不到这套房源'; end if;
    update listings set kind = p->>'kind', community = trim(p->>'community'), unit = trim(p->>'unit'),
      category = coalesce(p->>'category', ''), rooms = nullif(p->>'rooms', '')::int, halls = nullif(p->>'halls', '')::int,
      area = nullif(p->>'area', '')::numeric, price = nullif(p->>'price', '')::numeric,
      elevator = coalesce((p->>'elevator')::boolean, false), decoration = coalesce(p->>'decoration', ''),
      owners = case when jsonb_typeof(p->'owners') = 'array' and a.name = any(l.agents) then p->'owners' else owners end,  -- 房东信息只有房源维护人（和店面）能改
      needs_info = l.needs_info and coalesce(p->>'category', '') = '' and nullif(p->>'area', '') is null,
      filled_by = case when l.needs_info and (coalesce(p->>'category', '') <> '' or nullif(p->>'area', '') is not null) then a.name else filled_by end,
      filled_at = case when l.needs_info and (coalesce(p->>'category', '') <> '' or nullif(p->>'area', '') is not null) then now() else filled_at end,
      updated_by = a.name, updated_at = now()
    where id = p_id;
    return p_id;
  exception when unique_violation then
    raise exception '系统里已经有这套房子了，不能重复录入';
  end;
end $$;
revoke all on function aunt_listing_save(text, bigint, jsonb) from public;
grant execute on function aunt_listing_save(text, bigint, jsonb) to anon, authenticated;

-- ---------- 2026-11-08：客户方业务员随时可以改客户名字、电话（店面在后台直接改） ----------
create or replace function aunt_set_customer(p_token text, p_deal bigint, p_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare a agents; d deals;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then raise exception '请重新登记'; end if;
  select * into d from deals where id = p_deal for update;
  if not found or not (a.name = any(d.client_agents)) then raise exception '只有这一单的客户方业务员能改客户信息'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception '请填客户名字'; end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 7 then raise exception '请填正确的客户电话'; end if;
  update deals set customer_name = trim(p_name), customer_phone = trim(p_phone) where id = p_deal;
end $$;
revoke all on function aunt_set_customer(text, bigint, text, text) from public;
grant execute on function aunt_set_customer(text, bigint, text, text) to anon, authenticated;

-- ---------- 2026-11-08：补记晚到的返点（单独一笔，挂在原单下面，只让分这笔钱的业务员确认） ----------
alter table deals add column if not exists parent_id bigint references deals(id) on delete set null;

-- ---------- 2026-11-08：新加“合作”类型（和别的中介合作，总佣金对半分），记下合作的中介名字 ----------
alter table deals drop constraint if exists deals_type_check;
alter table deals add constraint deals_type_check check (type in ('二手买卖', '租房', '新房', '合作'));
alter table deals add column if not exists partner text not null default '';

-- ---------- 2026-11-08：自动确认（不会用手机的人，例如曹会计） ----------
insert into agents (name, sort, auto_confirm) values ('曹会计', 13, true) on conflict (name) do update set auto_confirm = true;
-- 单子发出去（待确认）时，替“自动确认”的人确认；全都确认了照常自动锁定
create or replace function deals_auto_confirm() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirming' then
    insert into confirmations (deal_id, agent_name, status, note, at)
      select new.id, a.name, 'ok', '自动确认', now() from agents a
       where a.auto_confirm and a.name = any(deal_people(new))
    on conflict (deal_id, agent_name) do nothing;
  end if;
  return null;
end $$;
drop trigger if exists deals_auto_confirm on deals;
create trigger deals_auto_confirm after insert or update on deals for each row execute function deals_auto_confirm();

-- ---------- 2026-11-08：手机下载用的云端文件夹（只有店面登录后能传、能生成下载链接） ----------
insert into storage.buckets (id, name, public) values ('exports', 'exports', false) on conflict (id) do nothing;
drop policy if exists exports_rw on storage.objects;
create policy exports_rw on storage.objects for all to authenticated using (bucket_id = 'exports') with check (bucket_id = 'exports');

-- ---------- 2026-11-08：以前记的账补进房源（房源功能上线前记的单子没有房源，这里一次性补上，以后重复跑也不会重复建） ----------
do $$
declare d record; c text; u text; t text; lid bigint;
  comms text[] := array['东亭家园','厦亭家园','怡邻花园一区','怡邻花园二区','怡邻花园三区','怡邻花园四区','怡邻花园五区','悬珠花园','阳澄人家','亭南新村',
    '青苑新村一区','青苑新村二区','青苑新村三区','青苑新村四区','青苑新村五区','青苑新村六区','畅苑新村一区','畅苑新村二区','畅苑新村三区','畅苑新村四区',
    '青灯新村','亭苑','金陵花园','绿地','融锦苑','雍合湾','唯锦苑','唯亭苑'];
begin
  for d in select * from deals where listing_id is null and parent_id is null and type <> '新房' and trim(coalesce(title, '')) <> '' order by deal_date, id loop
    t := trim(d.title);
    select x into c from unnest(comms) x where t like x || '%' order by length(x) desc limit 1;
    if c is not null then u := trim(substr(t, length(c) + 1));
    elsif position(' ' in t) > 0 then c := split_part(t, ' ', 1); u := trim(substr(t, length(c) + 2));
    else c := ''; u := t; end if;
    select id into lid from listings where regexp_replace(community, '\s', '', 'g') = regexp_replace(c, '\s', '', 'g')
                                       and regexp_replace(unit, '\s', '', 'g') = regexp_replace(u, '\s', '', 'g');
    if lid is null then
      insert into listings (kind, community, unit, owners, agents, status, needs_info, created_at, created_by, updated_by)
      values (case when d.type = '租房' then '出租' else '出售' end, c, u,
        coalesce((select jsonb_agg(jsonb_build_object('name', n, 'phone', '')) from regexp_split_to_table(coalesce(d.owner_name, ''), '[、，,\s]+') n where n <> ''), '[]'),
        case when d.type = '合作' then d.client_agents else d.listing_agents end, 'done', true, d.deal_date, '周姐', '周姐')
      returning id into lid;
    end if;
    update deals set listing_id = lid where id = d.id;  -- 锁定的单子也允许改 listing_id（不影响分钱）
    c := null; lid := null;
  end loop;
end $$;

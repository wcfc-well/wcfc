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

insert into agents (name, sort) values
  ('石文倩',0),('安丽霞',1),('李秀英',2),('周增花',3),('王海燕',4),('赵春芹',5),('马美景',6),
  ('张建华',7),('高梅',8),('吕绪红',9),('杨业沙',10),('朱文虎',11),('翁星宇',12)
on conflict (name) do nothing;

-- 这一单要确认的人（新房没有房源方）
create or replace function deal_people(d deals) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct n), '{}') from unnest(
    case when d.type = '新房' then d.client_agents else d.listing_agents || d.client_agents end) n;
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
      -- 锁定后只允许结算（改 settlement_id）
      if row(new.deal_date, new.type, new.title, new.owner_name, new.customer_name, new.incomes, new.expenses, new.listing_agents, new.client_agents, new.note, new.status, new.reopen_note, new.reopen_count)
         is distinct from row(old.deal_date, old.type, old.title, old.owner_name, old.customer_name, old.incomes, old.expenses, old.listing_agents, old.client_agents, old.note, old.status, old.reopen_note, old.reopen_count) then
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
    -- 内容改了或撤回成草稿：确认作废，需要重新确认
    if row(old.deal_date, old.type, old.incomes, old.expenses, old.listing_agents, old.client_agents, old.owner_name, old.customer_name)
         is distinct from row(new.deal_date, new.type, new.incomes, new.expenses, new.listing_agents, new.client_agents, new.owner_name, new.customer_name)
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
  select a.name, a.device_token is not null from agents a where a.active order by a.sort, a.id;
$$;

create or replace function aunt_bind(p_name text, p_phone4 text) returns text
language plpgsql security definer set search_path = public as $$
declare a agents; t text;
begin
  select * into a from agents where name = p_name and active;
  if not found then raise exception '找不到这个名字'; end if;
  if a.phone4 = '' or a.phone4 <> p_phone4 then raise exception '手机号后 4 位不对，请再看一下'; end if;
  if a.device_token is not null then raise exception '这个名字已经在别的手机上登记过了，请找店面重置'; end if;
  t := encode(gen_random_bytes(24), 'hex');
  update agents set device_token = t where id = a.id;
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

create or replace function aunt_confirm(p_token text, p_deal bigint, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a agents; d deals;
begin
  select * into a from agents where device_token = p_token and active;
  if not found then raise exception '请重新登记'; end if;
  select * into d from deals where id = p_deal;
  if not found or d.status <> 'confirming' then raise exception '这一单现在不能确认'; end if;
  if not (a.name = any(deal_people(d))) then raise exception '这一单没有您'; end if;
  insert into confirmations (deal_id, agent_name, status, note, at) values (p_deal, a.name, p_status, coalesce(p_note, ''), now())
  on conflict (deal_id, agent_name) do update set status = excluded.status, note = excluded.note, at = now();
end $$;

revoke all on function aunt_names(), aunt_bind(text, text), aunt_statement(text), aunt_confirm(text, bigint, text, text) from public;
grant execute on function aunt_names(), aunt_bind(text, text), aunt_statement(text), aunt_confirm(text, bigint, text, text) to anon, authenticated;

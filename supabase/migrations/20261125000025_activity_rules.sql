-- =====================================================================
-- 25) Activity rules, one by one
--   * each rule has its own version; editing its text makes it a new version
--   * a volunteer agrees rule by rule (or all at once), or leaves a comment
--     on a rule to come back to it
--   * a new or changed rule: everyone is told, and has to agree to it again
--   * the «rules» stage is done when every rule is agreed at its latest version
-- =====================================================================
create table if not exists public.activity_rules (
  id          uuid primary key default extensions.gen_random_uuid(),
  body        text not null check (btrim(body) <> ''),
  sort_order  int not null default 0,
  version     int not null default 1,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.activity_rules enable row level security;
create policy activity_rules_read on public.activity_rules for select to authenticated using (true);
-- written only through save_rules()
revoke insert, update, delete on public.activity_rules from anon, authenticated;

create table if not exists public.rule_answers (
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  rule_id       uuid not null references public.activity_rules (id) on delete cascade,
  version       int not null,
  agreed        boolean not null,
  comment       text,
  answered_at   timestamptz not null default now(),
  primary key (volunteer_id, rule_id)
);
alter table public.rule_answers enable row level security;
create policy rule_answers_read on public.rule_answers for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('stages.manage')));
revoke insert, update, delete on public.rule_answers from anon, authenticated;

-- The old single text becomes one rule per line
insert into public.activity_rules (body, sort_order)
select regexp_replace(btrim(line), '^[0-9٠-٩]+\s*[-.)]\s*', ''), n
  from (select line, row_number() over () as n
          from regexp_split_to_table(coalesce((select value from public.app_settings where key = 'rules_text'), ''), E'\n') line) x
 where btrim(line) <> ''
   and not exists (select 1 from public.activity_rules);

-- Done with the rules = every active rule agreed at its current version
create or replace function app.rules_done(vid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.activity_rules where is_active)
     and not exists (
       select 1 from public.activity_rules r
        where r.is_active
          and not exists (select 1 from public.rule_answers a
                           where a.volunteer_id = vid and a.rule_id = r.id and a.version = r.version and a.agreed))
$$;

-- Admin: the whole list in one save. Only new or reworded rules ask people again,
-- and everyone is told once.
create or replace function public.save_rules(p jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb;
  i int := 0;
  changed int := 0;
  rid uuid;
  old_body text;
  keep uuid[] := '{}';
  ver int;
begin
  if not app.has_perm('stages.manage') then
    raise exception 'محتاج صلاحية مراحل التطوع' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(p) loop
    i := i + 1;
    if btrim(coalesce(r->>'body', '')) = '' then
      continue;
    end if;
    rid := nullif(r->>'id', '')::uuid;
    select body into old_body from public.activity_rules where id = rid;
    if rid is null or old_body is null then
      insert into public.activity_rules (body, sort_order) values (btrim(r->>'body'), i) returning id into rid;
      changed := changed + 1;
    else
      update public.activity_rules
         set sort_order = i,
             is_active = true,
             version = version + case when btrim(body) <> btrim(r->>'body') then 1 else 0 end,
             body = btrim(r->>'body'),
             updated_at = case when btrim(body) <> btrim(r->>'body') then now() else updated_at end
       where id = rid;
      if btrim(old_body) <> btrim(r->>'body') then
        changed := changed + 1;
      end if;
    end if;
    keep := keep || rid;
  end loop;
  -- rules left out are retired (their answers stay in the history)
  update public.activity_rules set is_active = false where is_active and not (id = any (keep));

  if changed > 0 then
    -- the «rules» stage opens again for everyone
    ver := coalesce((select value::int from public.app_settings where key = 'rules_version'), 1) + 1;
    insert into public.app_settings (key, value) values ('rules_version', ver::text)
      on conflict (key) do update set value = excluded.value;
    perform app.notify(
      (select coalesce(array_agg(v.email), '{}') from public.volunteers v where v.email is not null and not app.account_closed(v.email)),
      'قواعد النشاط اتحدّثت',
      case when changed = 1 then 'فيه قاعدة جديدة أو اتعدلت' else 'فيه ' || changed || ' قواعد جديدة أو اتعدلت' end
        || '. اقراها ووافق عليها من «مراحل التطوع»',
      '/');
  end if;
  return changed;
end;
$$;
revoke all on function public.save_rules(jsonb) from public, anon;
grant execute on function public.save_rules(jsonb) to authenticated;

-- Volunteer: agree to some or all, comment on others
create or replace function public.answer_rules(p jsonb)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  vid uuid := app.my_volunteer_id();
  a jsonb;
  ok boolean;
begin
  if vid is null then
    raise exception 'الحساب ده مش مربوط بمتطوع' using errcode = '42501';
  end if;
  for a in select * from jsonb_array_elements(p) loop
    insert into public.rule_answers (volunteer_id, rule_id, version, agreed, comment)
    select vid, r.id, r.version, coalesce((a->>'agreed')::boolean, false), nullif(btrim(coalesce(a->>'comment', '')), '')
      from public.activity_rules r where r.id = (a->>'rule_id')::uuid and r.is_active
    on conflict (volunteer_id, rule_id) do update
      set version = excluded.version, agreed = excluded.agreed, comment = excluded.comment, answered_at = now();
  end loop;
  ok := app.rules_done(vid);
  if ok then
    insert into public.rules_acceptances (volunteer_id, version)
    values (vid, coalesce((select value::int from public.app_settings where key = 'rules_version'), 1))
    on conflict do nothing;
  end if;
  return ok;
end;
$$;
revoke all on function public.answer_rules(jsonb) from public, anon;
grant execute on function public.answer_rules(jsonb) to authenticated;

-- Admin: how each rule is doing, and the comments to come back to
create or replace function public.rules_report()
returns table (rule_id uuid, agreed int, pending int, comments jsonb)
language sql stable security definer
set search_path = ''
as $$
  with people as (
    select v.id from public.volunteers v where v.email is not null and not app.account_closed(v.email)
  )
  select r.id,
         (select count(*) from public.rule_answers a join people p on p.id = a.volunteer_id
           where a.rule_id = r.id and a.version = r.version and a.agreed)::int,
         ((select count(*) from people) - (select count(*) from public.rule_answers a join people p on p.id = a.volunteer_id
           where a.rule_id = r.id and a.version = r.version and a.agreed))::int,
         (select coalesce(jsonb_agg(jsonb_build_object('volunteer_id', a.volunteer_id, 'name', v.full_name_ar, 'comment', a.comment,
                                                     'agreed', a.agreed, 'old', a.version < r.version, 'at', a.answered_at)
                                    order by a.answered_at desc), '[]')
            from public.rule_answers a join public.volunteers v on v.id = a.volunteer_id
           where a.rule_id = r.id and a.comment is not null)
    from public.activity_rules r
   where r.is_active and app.has_perm('stages.manage')
$$;
revoke all on function public.rules_report() from public, anon;
grant execute on function public.rules_report() to authenticated;

-- the old one-text acceptance now means «agree to all»
create or replace function public.accept_rules()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.activity_rules where is_active) then
    raise exception 'قواعد النشاط لسه متكتبتش' using errcode = '22023';
  end if;
  perform public.answer_rules((select jsonb_agg(jsonb_build_object('rule_id', id, 'agreed', true))
                                 from public.activity_rules where is_active));
end;
$$;

create or replace function app.backup_tables()
returns text[] language sql immutable as $$
  select array['app_settings', 'lookups', 'roles', 'volunteers', 'volunteer_private', 'volunteer_hr', 'staff_roles',
               'committee_leaders', 'group_activities', 'meetings', 'participations', 'meeting_photos', 'schedule_slots',
               'certificate_requests', 'stages', 'stage_done', 'rules_acceptances', 'activity_rules', 'rule_answers',
               'tshirt_requests', 'camps', 'camp_registrations', 'recruit_log', 'registration_requests', 'notifications', 'audit_log']
$$;

-- =====================================================================
-- Clearer, finer permissions + a switch to pause someone's access.
--
--  New permissions, split out of broader ones. Every role that had the broad one gets the new
--  one too, so nobody gains or loses anything today:
--    camps.manage      ← stages.manage       الكامبات والميني كامب وحفلة التخرج
--    tshirts.manage    ← stages.manage       طلبات التيشيرت
--    rules.manage      ← stages.manage       قواعد النشاط
--    meetings.manage   ← attendance.register الاجتماعات
--    recruit.manage    ← hr.edit             المكالمات والمقابلات وطلبات الانضمام
--    accounts.password ← hr.edit             الباسورد المؤقت
--    absences.review   ← attendance.review / schedule.edit   اعتذارات الحصص
--
--  staff_roles.active: false = the person keeps their roles on paper but has no access.
-- =====================================================================

-- 1) Pause switch -----------------------------------------------------------
alter table public.staff_roles add column if not exists active boolean not null default true;
comment on column public.staff_roles.active is 'false = الصلاحية متسجلة بس موقوفة (مش مفعّلة).';

create or replace function app.my_permissions()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}')
  from (
    select s.role as key from public.staff_roles s where s.email = app.email() and s.active
    union
    select case when cl.role = 'نائب' then 'committee_deputy' else 'committee_leader' end
      from public.committee_leaders cl where cl.email = app.email()
  ) mine
  join public.roles r on r.key = mine.key
  cross join lateral unnest(r.permissions) p
$$;

create or replace function app.emails_with(p text)
returns extensions.citext[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct e), '{}')
  from (
    select s.email as e from public.staff_roles s join public.roles r on r.key = s.role
     where s.active and p = any (r.permissions)
    union
    select cl.email from public.committee_leaders cl
      join public.roles r on r.key = case when cl.role = 'نائب' then 'committee_deputy' else 'committee_leader' end
     where p = any (r.permissions)
  ) x
$$;

create or replace function app.my_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.staff_roles where email = app.email() and active limit 1
$$;

-- 2) Give the new permissions to whoever had the broad one -------------------
alter table public.roles disable trigger roles_guard;
update public.roles r set permissions = coalesce((
  select array_agg(distinct x) from unnest(
    r.permissions
    || case when 'stages.manage' = any (r.permissions) then array['camps.manage','tshirts.manage','rules.manage'] else '{}'::text[] end
    || case when 'attendance.register' = any (r.permissions) then array['meetings.manage'] else '{}'::text[] end
    || case when 'hr.edit' = any (r.permissions) then array['recruit.manage','accounts.password'] else '{}'::text[] end
    || case when 'attendance.review' = any (r.permissions) or 'schedule.edit' = any (r.permissions) then array['absences.review'] else '{}'::text[] end
  ) x
), '{}');
-- The admin always has everything.
update public.roles set permissions = (select array_agg(distinct x) from unnest(permissions || array[
  'volunteers.view_all','volunteers.edit','directory.view','national_id.view','national_id.edit','accounts.password','certificates.review',
  'recruit.manage','hr.view','hr.notes','hr.edit',
  'attendance.register','attendance.any_date','attendance.review','attendance.view_all','attendance.delete','meetings.manage',
  'schedule.edit','absences.review',
  'stages.manage','camps.manage','tshirts.manage','rules.manage',
  'stats.view','data.export','data.import','backup.manage','log.view',
  'settings.manage','roles.manage']) x)
 where key = 'admin';
alter table public.roles enable trigger roles_guard;

-- 3) Point the checks at the new permissions -------------------------------
-- Rewrites each function's own source, swapping one permission name for another.
create or replace function app._swap_perm_in_function(p_schema text, p_name text, p_old text, p_new text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  f record;
  src text;
  n int := 0;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = p_schema and p.proname = p_name
  loop
    src := pg_get_functiondef(f.oid);
    if position(p_old in src) > 0 then
      execute replace(src, p_old, p_new);
      n := n + 1;
    end if;
  end loop;
  if n = 0 then
    raise exception 'swap_perm: %.% has no %', p_schema, p_name, p_old;
  end if;
  return n;
end;
$$;

-- Same for a policy's USING / WITH CHECK.
create or replace function app._swap_perm_in_policy(p_schema text, p_table text, p_policy text, p_old text, p_new text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  pol record;
  stmt text;
begin
  select qual, with_check into pol from pg_policies
   where schemaname = p_schema and tablename = p_table and policyname = p_policy;
  if not found then
    raise exception 'swap_perm: policy % on %.% not found', p_policy, p_schema, p_table;
  end if;
  stmt := format('alter policy %I on %I.%I', p_policy, p_schema, p_table);
  if pol.qual is not null then stmt := stmt || ' using (' || replace(pol.qual, p_old, p_new) || ')'; end if;
  if pol.with_check is not null then stmt := stmt || ' with check (' || replace(pol.with_check, p_old, p_new) || ')'; end if;
  execute stmt;
end;
$$;

do $$
begin
  -- camps
  perform app._swap_perm_in_function('public', f, '''stages.manage''', '''camps.manage''')
    from unnest(array['camp_stats','cancel_camp','register_camp','remind_camp','set_camp_attendance']) f;
  perform app._swap_perm_in_function('app', 'camp_registration_guard', '''stages.manage''', '''camps.manage''');
  perform app._swap_perm_in_policy('public', 'camps', 'camps_write', '''stages.manage''', '''camps.manage''');
  perform app._swap_perm_in_policy('public', 'camp_registrations', 'camp_reg_read', '''stages.manage''', '''camps.manage''');

  -- t-shirts
  perform app._swap_perm_in_policy('public', 'tshirt_requests', p, '''stages.manage''', '''tshirts.manage''')
    from unnest(array['tshirt_cancel','tshirt_read','tshirt_review']) p;

  -- activity rules
  perform app._swap_perm_in_function('public', f, '''stages.manage''', '''rules.manage''')
    from unnest(array['save_rules','rules_report']) f;
  perform app._swap_perm_in_policy('public', 'rule_answers', 'rule_answers_read', '''stages.manage''', '''rules.manage''');

  -- meetings
  perform app._swap_perm_in_function('public', 'save_meeting', '''attendance.register''', '''meetings.manage''');
  perform app._swap_perm_in_policy('public', 'meetings', p, '''attendance.register''', '''meetings.manage''')
    from unnest(array['meetings_read','meetings_write']) p;
  perform app._swap_perm_in_policy('public', 'meeting_photos', p, '''attendance.register''', '''meetings.manage''')
    from unnest(array['meeting_photos_write','meeting_photos_delete']) p;

  -- recruitment
  perform app._swap_perm_in_function('public', f, '''hr.edit''', '''recruit.manage''')
    from unnest(array['recruit_call','recruit_interview','recruit_reopen','accept_volunteer','review_registration']) f;

  -- temporary passwords
  perform app._swap_perm_in_function('public', 'account_target', '''hr.edit''', '''accounts.password''');

  -- class absences
  perform app._swap_perm_in_function('public', f, '''attendance.review''', '''absences.review''')
    from unnest(array['request_absence','review_absence']) f;
  perform app._swap_perm_in_policy('public', 'class_absences', p.policyname, '''attendance.review''', '''absences.review''')
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'class_absences'
     and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%attendance.review%';
end;
$$;

-- Meeting photos sit in the activity photos bucket: meetings.manage may upload there too.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'storage' and tablename = 'objects' and policyname in ('activity_photos_write','activity_photos_delete')
  loop
    perform app._swap_perm_in_policy('storage', 'objects', pol.policyname,
      'app.has_perm(''attendance.register''::text)',
      '(app.has_perm(''attendance.register''::text) OR app.has_perm(''meetings.manage''::text))');
  end loop;
end;
$$;

drop function app._swap_perm_in_function(text, text, text, text);
drop function app._swap_perm_in_policy(text, text, text, text, text);

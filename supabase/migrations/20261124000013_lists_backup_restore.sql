-- =====================================================================
-- 13) Editable status lists, team WhatsApp group, backup download/restore
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Status lists become editable.
--    حالة المتطوع / حالة القبول are Postgres enums: renaming a value renames
--    it in every row at once (ALTER TYPE ... RENAME VALUE), adding one adds
--    it to the enum. Values cannot be removed from an enum, so "delete" hides.
--    The values the app's own rules depend on stay locked.
--    The "اليوم" list is dropped: the day comes from the date.
-- ---------------------------------------------------------------------
delete from public.lookups where list = 'اليوم';

create or replace function app.list_is_fixed(p_list text)
returns boolean language sql immutable as $$ select false $$;

create or replace function app.list_enum(p_list text)
returns text language sql immutable as $$
  select case p_list when 'حالة المتطوع' then 'volunteer_status' when 'حالة القبول' then 'acceptance_grade' end
$$;

create or replace function app.lookup_locked(p_list text, p_value text)
returns boolean language sql immutable as $$
  select (p_list = 'حالة المتطوع' and p_value in ('تحت المتابعة', 'خارج المتابعة'))
      or (p_list = 'حالة القبول' and p_value in ('اختبار', 'مقبول'))
$$;

-- New value in an enum-backed list → add it to the enum too.
create or replace function app.lookup_enum_add()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  e text := app.list_enum(new.list);
begin
  if e is not null then
    new.value := btrim(new.value);
    execute format('alter type public.%I add value if not exists %L', e, new.value);
  end if;
  return new;
end;
$$;
drop trigger if exists lookups_enum_add on public.lookups;
create trigger lookups_enum_add before insert on public.lookups
  for each row execute function app.lookup_enum_add();

-- Direct edits of an enum list's value go through rename_lookup only.
create or replace function app.lookup_enum_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.list_enum(old.list) is not null and new.value is distinct from old.value
     and current_setting('app.enum_rename', true) is distinct from 'on' then
    raise exception 'غيّر القيمة من زرار التعديل' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists lookups_enum_guard on public.lookups;
create trigger lookups_enum_guard before update on public.lookups
  for each row execute function app.lookup_enum_guard();

create or replace function public.rename_lookup(p_id bigint, p_value text, p_update_data boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.lookups;
  new_value text := btrim(p_value);
  n int := 0;
  c int;
  e text;
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    raise exception 'القيمة دي مش موجودة';
  end if;
  if app.lookup_locked(l.list, l.value) then
    raise exception 'القيمة «%» السيستم بيعتمد عليها ومينفعش تتغير', l.value using errcode = '42501';
  end if;
  if coalesce(new_value, '') = '' then
    raise exception 'اكتب القيمة الجديدة';
  end if;
  if new_value = l.value then
    return jsonb_build_object('rows', 0);
  end if;
  if exists (select 1 from public.lookups where list = l.list and value = new_value and parent is not distinct from l.parent) then
    raise exception 'القيمة «%» موجودة في القايمة قبل كده', new_value;
  end if;

  e := app.list_enum(l.list);
  if e is not null then
    -- Renaming an enum value renames it everywhere; there is no "keep old data" option.
    execute format('alter type public.%I rename value %L to %L', e, l.value, new_value);
    if e = 'volunteer_status' then
      select count(*) into n from public.volunteers where status::text = new_value;
    else
      select count(*) into n from public.volunteer_hr where acceptance::text = new_value;
    end if;
    perform set_config('app.enum_rename', 'on', true);
    update public.lookups set value = new_value where id = p_id;
    perform set_config('app.enum_rename', 'off', true);
  else
    update public.lookups set value = new_value where id = p_id;
  end if;

  if p_update_data and e is null then
    perform app.begin_internal();
    perform set_config('app.skip_audit', 'on', true);
    case l.list
      when 'اللجنة' then
        update public.volunteers set main_committee = new_value where main_committee = l.value; get diagnostics c = row_count; n := n + c;
        update public.volunteers set sub_committee = new_value where sub_committee = l.value; get diagnostics c = row_count; n := n + c;
        update public.committee_leaders set committee = new_value where committee = l.value; get diagnostics c = row_count; n := n + c;
      when 'الحدث' then
        update public.participations set event = new_value where event = l.value; get diagnostics c = row_count; n := n + c;
        update public.group_activities set event = new_value where event = l.value; get diagnostics c = row_count; n := n + c;
        update public.lookups set parent = new_value where list = 'نوع الحدث' and parent = l.value;
      when 'نوع الحدث' then
        update public.participations set subject = new_value where subject = l.value and (l.parent is null or event = l.parent); get diagnostics c = row_count; n := n + c;
        update public.group_activities set subject = new_value where subject = l.value and (l.parent is null or event = l.parent); get diagnostics c = row_count; n := n + c;
        update public.schedule_slots set subject = new_value where subject = l.value; get diagnostics c = row_count; n := n + c;
      when 'السنة الدراسية' then
        update public.participations set grade = new_value where grade = l.value; get diagnostics c = row_count; n := n + c;
        update public.group_activities set grade = new_value where grade = l.value; get diagnostics c = row_count; n := n + c;
        update public.schedule_slots set grade = new_value where grade = l.value; get diagnostics c = row_count; n := n + c;
      when 'المكان' then
        update public.participations set place = new_value where place = l.value; get diagnostics c = row_count; n := n + c;
        update public.group_activities set place = new_value where place = l.value; get diagnostics c = row_count; n := n + c;
      when 'القائم على المقابلة' then
        update public.volunteer_hr set interviewer = new_value where interviewer = l.value; get diagnostics c = row_count; n := n + c;
      else
        null;
    end case;
    perform set_config('app.skip_audit', 'off', true);
    perform app.end_internal();
  end if;

  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (app.email(), 'lookups', 'UPDATE', p_id::text,
          jsonb_build_object('list', l.list, 'value', l.value),
          jsonb_build_object('list', l.list, 'value', new_value, 'rows_updated', n));
  return jsonb_build_object('rows', n);
exception
  when unique_violation then
    raise exception 'التغيير ده هيعمل مشاركات متكررة لنفس المتطوع. راجع القيمتين الأول.';
end;
$$;

create or replace function public.delete_lookup(p_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.lookups;
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    return;
  end if;
  if app.lookup_locked(l.list, l.value) then
    raise exception 'القيمة «%» السيستم بيعتمد عليها ومينفعش تتشال', l.value using errcode = '42501';
  end if;
  if app.list_enum(l.list) is not null then
    -- Enum values can't be dropped: hide it from the choices instead.
    update public.lookups set is_active = false where id = p_id;
  else
    delete from public.lookups where id = p_id;
  end if;
  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (app.email(), 'lookups', 'DELETE', p_id::text, jsonb_build_object('list', l.list, 'value', l.value), null);
end;
$$;

-- ---------------------------------------------------------------------
-- 2) «فريق العمل» group: its own link, shown only to مشروع مسئول / مسئول
--    and committee leaders. Takes over the old «مسئول نشاط» committee link.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value)
select 'team_group_link', link from public.lookups where list = 'اللجنة' and value = 'مسئول نشاط' and link is not null
on conflict (key) do nothing;
update public.lookups set link = null where list = 'اللجنة' and value = 'مسئول نشاط';

-- The link itself is only readable by the people it is for.
create or replace function public.team_group_link()
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.value from public.app_settings s
   where s.key = 'team_group_link'
     and (app.has_perm('settings.manage')
          or exists (select 1 from public.committee_leaders cl where cl.email = app.email())
          or exists (select 1 from public.volunteers v where v.email = app.email() and v.status::text in ('مشروع مسئول', 'مسئول')))
$$;
revoke all on function public.team_group_link() from public, anon;
grant execute on function public.team_group_link() to authenticated;

-- app_settings is readable by every signed-in user: keep this key out of it.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'app_settings' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.app_settings', p.policyname);
  end loop;
end $$;
create policy app_settings_read on public.app_settings for select to authenticated
  using (key <> 'team_group_link' or (select app.has_perm('settings.manage')));

-- ---------------------------------------------------------------------
-- 3) Backup download / restore from the site (permission backup.manage)
-- ---------------------------------------------------------------------
update public.roles
   set permissions = array(select distinct unnest(permissions || array['backup.manage']))
 where key = 'admin';

create or replace function app.backup_tables()
returns text[] language sql immutable as $$
  select array['app_settings', 'lookups', 'roles', 'volunteers', 'volunteer_private', 'volunteer_hr', 'staff_roles',
               'committee_leaders', 'group_activities', 'participations', 'schedule_slots', 'certificate_requests',
               'notifications', 'audit_log']
$$;

create or replace function public.export_backup()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  t text;
  rows jsonb;
  tables jsonb := '{}';
  counts jsonb := '{}';
  total bigint := 0;
begin
  if not app.has_perm('backup.manage') then
    raise exception 'محتاج صلاحية النسخ الاحتياطي' using errcode = '42501';
  end if;
  foreach t in array app.backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into rows;
    tables := tables || jsonb_build_object(t, rows);
    counts := counts || jsonb_build_object(t, jsonb_array_length(rows));
    total := total + jsonb_array_length(rows);
  end loop;
  return jsonb_build_object('app', 'droos-volunteers', 'schema', 13, 'exported_at', now(), 'exported_by', app.email(),
                            'counts', counts, 'rows', total, 'tables', tables);
end;
$$;
revoke all on function public.export_backup() from public, anon;
grant execute on function public.export_backup() to authenticated;

-- Replaces the data of every table in the backup with the backup's rows.
-- All or nothing. Triggers are off during the load, so rows keep their ids,
-- codes, dates and authors; old rows may break rules added later (NOT VALID checks).
create or replace function public.restore_backup(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t text;
  cols text;
  n bigint;
  counts jsonb := '{}';
  present text[];
  r record;
  lax jsonb;
begin
  if not app.has_perm('backup.manage') then
    raise exception 'محتاج صلاحية النسخ الاحتياطي' using errcode = '42501';
  end if;
  if p ->> 'app' is distinct from 'droos-volunteers' or jsonb_typeof(p -> 'tables') is distinct from 'object' then
    raise exception 'الملف ده مش نسخة احتياطية من الموقع' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(p -> 'tables' -> 'volunteers'), 0) = 0 then
    raise exception 'النسخة دي مفيهاش متطوعين، مش هسترجعها' using errcode = '22023';
  end if;

  select array_agg(x) into present from unnest(app.backup_tables()) x where p -> 'tables' ? x;

  select coalesce(jsonb_agg(jsonb_build_object('tbl', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(oid))), '[]')
    into lax
    from pg_constraint
   where contype = 'c' and not convalidated and connamespace = 'public'::regnamespace
     and conrelid::regclass::text = any (select 'public.' || x from unnest(present) x union select x from unnest(present) x);
  for r in select * from jsonb_to_recordset(lax) as (tbl text, name text, def text) loop
    execute format('alter table %s drop constraint %I', r.tbl, r.name);
  end loop;

  foreach t in array present loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(present) x) || ' cascade';

  foreach t in array present loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and is_generated = 'NEVER';
    execute format(
      'insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)',
      t, cols, cols, t) using p -> 'tables' -> t;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  for r in select c.table_name, c.column_name from information_schema.columns c
            where c.table_schema = 'public' and c.is_identity = 'YES' and c.table_name = any (present) loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
                   'public.' || r.table_name, r.column_name, r.column_name, r.table_name);
  end loop;

  foreach t in array present loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  for r in select * from jsonb_to_recordset(lax) as (tbl text, name text, def text) loop
    execute format('alter table %s add constraint %I %s not valid', r.tbl, r.name, r.def);
  end loop;

  -- An older copy must not lock admins out of restoring again.
  update public.roles set permissions = array(select distinct unnest(permissions || array['backup.manage'])) where key = 'admin';

  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (app.email(), 'backup', 'INSERT', null, null,
          jsonb_build_object('exported_at', p ->> 'exported_at', 'counts', counts));
  return jsonb_build_object('restored_from', p ->> 'exported_at', 'counts', counts);
end;
$$;
revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- How many ID card photos the last Drive copy held
alter table public.backup_runs add column if not exists images int;

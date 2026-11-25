-- =====================================================================
-- 32) Backups include the students tables.
--
--  * app.backup_tables() keeps the volunteers' tables as they are; the students tables come after
--    them as «students.<table>» (so an old backup file still reads the same).
--  * export_backup / restore_backup understand those names.
--  * Restoring an old backup that has no students in it is refused while students exist:
--    emptying the volunteers' tables would empty the students' classes with them.
-- =====================================================================

create or replace function app.backup_tables()
returns text[]
language sql immutable
as $$
  select array['app_settings', 'lookups', 'roles', 'volunteers', 'volunteer_private', 'volunteer_hr', 'staff_roles',
               'committee_leaders', 'group_activities', 'meetings', 'participations', 'meeting_photos', 'schedule_slots',
               'class_absences', 'certificate_requests', 'stages', 'stage_done', 'rules_acceptances', 'activity_rules',
               'rule_answers', 'tshirt_requests', 'camps', 'camp_registrations', 'recruit_log', 'registration_requests',
               'notifications', 'audit_log',
               -- students (parents before children)
               'students.settings', 'students.org_info', 'students.terms', 'students.grades', 'students.attendance_marks',
               'students.guardians', 'students.students', 'students.student_private', 'students.phones', 'students.accounts',
               'students.applications', 'students.enrollments', 'students.groups', 'students.group_members',
               'students.whatsapp_groups', 'students.class_sessions', 'students.audiences', 'students.schedule_pauses',
               'students.slot_requests', 'students.attendance', 'students.exam_results', 'students.flags', 'students.leaves',
               'students.notes', 'students.announcements', 'students.change_requests', 'students.dismissal_requests']
$$;

-- 'volunteers' → public.volunteers ; 'students.notes' → students.notes
create or replace function app.backup_schema(t text) returns text language sql immutable as $$
  select case when position('.' in t) > 0 then split_part(t, '.', 1) else 'public' end
$$;
create or replace function app.backup_name(t text) returns text language sql immutable as $$
  select case when position('.' in t) > 0 then split_part(t, '.', 2) else t end
$$;
create or replace function app.backup_rel(t text) returns text language sql immutable as $$
  select format('%I.%I', app.backup_schema(t), app.backup_name(t))
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
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x', app.backup_rel(t)) into rows;
    tables := tables || jsonb_build_object(t, rows);
    counts := counts || jsonb_build_object(t, jsonb_array_length(rows));
    total := total + jsonb_array_length(rows);
  end loop;
  return jsonb_build_object('app', 'droos-volunteers', 'schema', 32, 'exported_at', now(), 'exported_by', app.email(),
                            'counts', counts, 'rows', total, 'tables', tables);
end;
$$;

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
  if not (p -> 'tables' ? 'students.students') and exists (select 1 from students.students) then
    raise exception 'النسخة دي من قبل الطلاب، واسترجاعها هيمسح حصص الطلاب. استرجع نسخة أحدث' using errcode = '22023';
  end if;

  select array_agg(x) into present from unnest(app.backup_tables()) x where p -> 'tables' ? x;

  select coalesce(jsonb_agg(jsonb_build_object('tbl', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(oid))), '[]')
    into lax
    from pg_constraint
   where contype = 'c' and not convalidated
     and connamespace in ('public'::regnamespace, 'students'::regnamespace)
     and conrelid = any (select app.backup_rel(x)::regclass from unnest(present) x);
  for r in select * from jsonb_to_recordset(lax) as (tbl text, name text, def text) loop
    execute format('alter table %s drop constraint %I', r.tbl, r.name);
  end loop;

  foreach t in array present loop
    execute format('alter table %s disable trigger user', app.backup_rel(t));
  end loop;
  execute 'truncate ' || (select string_agg(app.backup_rel(x), ', ') from unnest(present) x) || ' cascade';

  foreach t in array present loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = app.backup_schema(t) and table_name = app.backup_name(t) and is_generated = 'NEVER';
    execute format(
      'insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, $1)',
      app.backup_rel(t), cols, cols, app.backup_rel(t)) using p -> 'tables' -> t;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  for r in select c.table_schema, c.table_name, c.column_name from information_schema.columns c
            where c.is_identity = 'YES'
              and (c.table_schema, c.table_name) in (select app.backup_schema(x), app.backup_name(x) from unnest(present) x) loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from %I.%I), 0) + 1, false)',
                   format('%I.%I', r.table_schema, r.table_name), r.column_name, r.column_name, r.table_schema, r.table_name);
  end loop;

  foreach t in array present loop
    execute format('alter table %s enable trigger user', app.backup_rel(t));
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
revoke all on function public.export_backup() from public, anon;
grant execute on function public.export_backup() to authenticated;
revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

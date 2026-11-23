-- =====================================================================
-- Automation: defaults, derived fields, status rules, notifications,
-- audit log, and the RPCs the app calls.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Generic: updated_at / updated_by
-- ---------------------------------------------------------------------
create or replace function app.touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.email()::text, new.updated_by);
  return new;
end;
$$;

create trigger volunteers_touch before update on public.volunteers
  for each row execute function app.touch();
create trigger participations_touch before update on public.participations
  for each row execute function app.touch();
create trigger schedule_slots_touch before update on public.schedule_slots
  for each row execute function app.touch();

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create or replace function app.notify(recipients extensions.citext[], p_title text, p_body text, p_link text default null)
returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_email, title, body, link)
  select distinct r, p_title, p_body, p_link
  from unnest(recipients) as r
  where r is not null
$$;

create or replace function app.emails_of(roles public.app_role[])
returns extensions.citext[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(email), '{}') from public.staff_roles where role = any (roles)
$$;

-- ---------------------------------------------------------------------
-- Volunteers: whatsapp default, companion rows, status timestamp
-- ---------------------------------------------------------------------
create or replace function app.volunteer_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(trim(new.whatsapp), '') is null then
    new.whatsapp := new.phone;
  end if;
  return new;
end;
$$;

create trigger volunteers_defaults before insert or update of phone, whatsapp on public.volunteers
  for each row execute function app.volunteer_defaults();

create or replace function app.volunteer_companions()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.volunteer_private (volunteer_id) values (new.id) on conflict do nothing;
  insert into public.volunteer_hr (volunteer_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;

create trigger volunteers_companions after insert on public.volunteers
  for each row execute function app.volunteer_companions();

create or replace function app.volunteer_status_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.volunteer_hr set status_changed_at = now() where volunteer_id = new.id;
  return null;
end;
$$;

create trigger volunteers_status_changed after update of status on public.volunteers
  for each row when (old.status is distinct from new.status)
  execute function app.volunteer_status_changed();

create or replace function app.acceptance_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.acceptance is distinct from old.acceptance then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger volunteer_hr_acceptance before update on public.volunteer_hr
  for each row execute function app.acceptance_changed();

-- ---------------------------------------------------------------------
-- National id → birth date and gender; change requests
-- ---------------------------------------------------------------------
create or replace function app.parse_national_id(nid text, out birth_date date, out gender text)
language plpgsql immutable
set search_path = ''
as $$
begin
  if nid !~ '^[23][0-9]{13}$' then
    return;
  end if;
  begin
    birth_date := make_date(
      (case left(nid, 1) when '2' then 1900 else 2000 end) + substr(nid, 2, 2)::int,
      substr(nid, 4, 2)::int,
      substr(nid, 6, 2)::int);
  exception when others then
    birth_date := null;
  end;
  gender := case when substr(nid, 13, 1)::int % 2 = 1 then 'ذكر' else 'أنثى' end;
end;
$$;

create or replace function app.national_id_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  parsed record;
begin
  if tg_op = 'INSERT' or new.national_id is distinct from old.national_id then
    parsed := app.parse_national_id(new.national_id);
    if parsed.birth_date is not null or parsed.gender is not null then
      perform app.begin_internal();
      update public.volunteers
         set birth_date = coalesce(parsed.birth_date, birth_date),
             gender = coalesce(parsed.gender, gender)
       where id = new.volunteer_id;
      perform app.end_internal();
    end if;
  end if;

  if new.requested_national_id is not null
     and (tg_op = 'INSERT' or new.requested_national_id is distinct from old.requested_national_id) then
    perform app.notify(
      app.emails_of(array['admin', 'activity_leader', 'hr']::public.app_role[]),
      'طلب تغيير رقم قومي',
      (select full_name_ar from public.volunteers where id = new.volunteer_id)
        || ' طالب يغيّر الرقم القومي لـ ' || new.requested_national_id,
      '/requests/national-id');
  end if;
  return null;
end;
$$;

create trigger volunteer_private_changed after insert or update on public.volunteer_private
  for each row execute function app.national_id_changed();

-- HR approves or rejects a national id change request.
create or replace function public.review_national_id(p_volunteer_id uuid, p_approve boolean)
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if not app.is_full() then
    raise exception 'الموافقة على الرقم القومي للـ HR بس' using errcode = '42501';
  end if;

  update public.volunteer_private
     set national_id = case when p_approve then requested_national_id else national_id end,
         requested_national_id = null
   where volunteer_id = p_volunteer_id
     and requested_national_id is not null;

  if not found then
    raise exception 'مفيش طلب تغيير رقم قومي للمتطوع ده';
  end if;

  perform app.notify(
    array[(select email from public.volunteers where id = p_volunteer_id)],
    case when p_approve then 'تم تغيير الرقم القومي' else 'طلب تغيير الرقم القومي اترفض' end,
    null, '/me');
end;
$$;

-- ---------------------------------------------------------------------
-- Participations: who registered, status by role, date windows
-- ---------------------------------------------------------------------
create or replace function app.participation_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_internal() then
    return new;
  end if;

  new.created_by := app.email();

  if app.is_staff() then
    if app.is_organizer() and (new.activity_date > app.today() or new.activity_date < app.today() - 7) then
      raise exception 'التنظيم يسجّل لحد 7 أيام فاتوا بس' using errcode = '42501';
    end if;
    new.status := 'accepted';
    new.reviewed_by := app.email();
    new.reviewed_at := now();
  else
    if new.volunteer_id is distinct from app.my_volunteer_id() then
      raise exception 'تقدر تسجّل حضورك إنت بس' using errcode = '42501';
    end if;
    if new.activity_date <> app.today() then
      raise exception 'تقدر تسجّل حضور النهارده بس' using errcode = '42501';
    end if;
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

create trigger participations_before_insert before insert on public.participations
  for each row execute function app.participation_before_insert();

create or replace function app.participation_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := app.email();
    new.reviewed_at := now();
  end if;
  if not (app.is_full() or app.is_internal())
     and (new.volunteer_id is distinct from old.volunteer_id
          or new.activity_date < app.today() - 7) then
    raise exception 'التنظيم يعدّل آخر 7 أيام بس' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger participations_before_update before update on public.participations
  for each row execute function app.participation_before_update();

-- After a participation is saved: mini camp, back to follow-up, notifications.
create or replace function app.participation_after_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.volunteers;
  became_accepted boolean :=
    new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted');
begin
  select * into v from public.volunteers where id = new.volunteer_id;

  if became_accepted then
    perform app.begin_internal();
    if new.event = 'ميني كامب' then
      -- mini camp marks attendance but never changes the status
      update public.volunteers
         set attended_minicamp = true,
             minicamp_date = coalesce(minicamp_date, new.activity_date)
       where id = new.volunteer_id;
    elsif v.status = 'خارج المتابعة' then
      update public.volunteers set status = 'تحت المتابعة' where id = new.volunteer_id;
      perform app.notify(
        array[v.email] || app.emails_of(array['admin', 'activity_leader', 'hr']::public.app_role[]),
        'رجوع تحت المتابعة',
        v.full_name_ar || ' رجع تحت المتابعة بعد مشاركة ' || new.event,
        '/volunteers/' || v.id);
    end if;
    perform app.end_internal();
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    perform app.notify(
      app.emails_of(array['admin', 'activity_leader', 'hr', 'organizer']::public.app_role[]),
      'طلب حضور مستني موافقة',
      v.full_name_ar || ' سجّل ' || new.event || ' يوم ' || to_char(new.activity_date, 'DD/MM'),
      '/requests');
  end if;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' then
    perform app.notify(
      array[v.email],
      case new.status when 'accepted' then 'طلب الحضور اتقبل' else 'طلب الحضور اترفض' end,
      new.event || ' يوم ' || to_char(new.activity_date, 'DD/MM'),
      '/me/activities');
  end if;

  return null;
end;
$$;

create trigger participations_after_write after insert or update on public.participations
  for each row execute function app.participation_after_write();

-- ---------------------------------------------------------------------
-- RPC: register an activity for one or many volunteers
-- Skips anyone who already has the same activity (same day, event,
-- subject and grade). Runs with the caller's rights, so RLS and the
-- triggers above still apply.
-- ---------------------------------------------------------------------
create or replace function public.register_activity(p_activity jsonb, p_volunteer_ids uuid[])
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  ids        uuid[] := array(select distinct unnest(p_volunteer_ids));
  group_id   uuid;
  inserted   uuid[];
  a_date     date := coalesce((p_activity ->> 'activity_date')::date, app.today());
begin
  if not app.is_staff() then
    raise exception 'تسجيل النشاط للإدارة والتنظيم بس' using errcode = '42501';
  end if;
  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'اختار متطوع واحد على الأقل';
  end if;
  if nullif(p_activity ->> 'event', '') is null then
    raise exception 'اختار الحدث';
  end if;

  if array_length(ids, 1) > 1 then
    insert into public.group_activities (activity_date, event, subject, place, grade, beneficiaries, notes, created_by)
    values (a_date, p_activity ->> 'event', nullif(p_activity ->> 'subject', ''), nullif(p_activity ->> 'place', ''),
            nullif(p_activity ->> 'grade', ''), nullif(p_activity ->> 'beneficiaries', '')::int,
            nullif(p_activity ->> 'notes', ''), app.email())
    returning id into group_id;
  end if;

  with ins as (
    insert into public.participations
      (volunteer_id, activity_date, event, subject, place, grade, beneficiaries, notes, method, group_activity_id)
    select vid, a_date, p_activity ->> 'event', nullif(p_activity ->> 'subject', ''), nullif(p_activity ->> 'place', ''),
           nullif(p_activity ->> 'grade', ''), nullif(p_activity ->> 'beneficiaries', '')::int,
           nullif(p_activity ->> 'notes', ''),
           case when group_id is null then 'individual' else 'group' end::public.entry_method,
           group_id
    from unnest(ids) as vid
    on conflict (volunteer_id, activity_date, event, coalesce(subject, ''), coalesce(grade, ''))
      where status <> 'rejected'
      do nothing
    returning volunteer_id
  )
  select coalesce(array_agg(volunteer_id), '{}') into inserted from ins;

  return jsonb_build_object(
    'group_id', group_id,
    'inserted', coalesce(array_length(inserted, 1), 0),
    'skipped_ids', to_jsonb(array(select x from unnest(ids) x where not x = any (inserted)))
  );
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: who am I (the app builds its menu from this)
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'email', app.email(),
    'role', app.my_role(),
    'is_full', app.is_full(),
    'is_staff', app.is_staff(),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id()
  )
$$;

-- ---------------------------------------------------------------------
-- Audit log on every main table
-- ---------------------------------------------------------------------
create or replace function app.audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and old_j = new_j then
    return null;
  end if;
  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (
    coalesce(app.email()::text, case when app.is_internal() then 'system' end),
    tg_table_name,
    tg_op,
    coalesce(new_j, old_j) ->> coalesce(tg_argv[0], 'id'),
    old_j,
    new_j);
  return null;
end;
$$;

create trigger audit_volunteers after insert or update or delete on public.volunteers
  for each row execute function app.audit('id');
create trigger audit_volunteer_private after insert or update or delete on public.volunteer_private
  for each row execute function app.audit('volunteer_id');
create trigger audit_volunteer_hr after insert or update or delete on public.volunteer_hr
  for each row execute function app.audit('volunteer_id');
create trigger audit_participations after insert or update or delete on public.participations
  for each row execute function app.audit('id');
create trigger audit_group_activities after insert or update or delete on public.group_activities
  for each row execute function app.audit('id');
create trigger audit_schedule_slots after insert or update or delete on public.schedule_slots
  for each row execute function app.audit('id');
create trigger audit_staff_roles after insert or update or delete on public.staff_roles
  for each row execute function app.audit('email');
create trigger audit_committee_leaders after insert or update or delete on public.committee_leaders
  for each row execute function app.audit('email');

-- ---------------------------------------------------------------------
-- Daily and monthly jobs (scheduled in the cron migration)
-- ---------------------------------------------------------------------
create or replace function app.run_daily_jobs()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  moved_out int;
  accepted  int;
begin
  perform app.begin_internal();

  -- 1) No accepted participation for 90 days → خارج المتابعة
  with stale as (
    update public.volunteers v
       set status = 'خارج المتابعة'
     where v.status = 'تحت المتابعة'
       and v.registered_at < now() - interval '90 days'
       and not exists (
         select 1 from public.participations p
          where p.volunteer_id = v.id
            and p.status = 'accepted'
            and p.activity_date >= app.today() - 90)
    returning v.id
  )
  select count(*) into moved_out from stale;

  -- 2) اختبار with no status change for 90 days → مقبول
  with promote as (
    update public.volunteer_hr h
       set acceptance = 'مقبول'
      from public.volunteers v
     where v.id = h.volunteer_id
       and h.acceptance = 'اختبار'
       and coalesce(h.status_changed_at, h.interview_date::timestamptz, v.registered_at) < now() - interval '90 days'
    returning h.volunteer_id
  )
  select count(*) into accepted from promote;

  perform app.end_internal();
  return jsonb_build_object('moved_out', moved_out, 'accepted', accepted);
end;
$$;

create or replace function app.run_monthly_summary()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  first_day date := date_trunc('month', app.today() - interval '1 month')::date;
  last_day  date := (date_trunc('month', app.today()) - interval '1 day')::date;
  sent int;
begin
  insert into public.notifications (recipient_email, title, body, link)
  select v.email,
         'ملخص مشاركاتك',
         'شاركت ' || count(p.id) || ' مرة في ' || to_char(first_day, 'MM/YYYY'),
         '/me/activities'
    from public.volunteers v
    left join public.participations p
      on p.volunteer_id = v.id and p.status = 'accepted'
     and p.activity_date between first_day and last_day
   where v.email is not null and v.status <> 'خارج المتابعة'
   group by v.email;
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke execute on function app.run_daily_jobs(), app.run_monthly_summary() from authenticated;
grant execute on function public.register_activity(jsonb, uuid[]), public.review_national_id(uuid, boolean),
  public.my_context() to authenticated;
revoke execute on function public.register_activity(jsonb, uuid[]), public.review_national_id(uuid, boolean),
  public.my_context() from anon;

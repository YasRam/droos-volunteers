-- =====================================================================
-- 37) One class for volunteers and students.
--
--  The weekly class (public.schedule_slots) makes a dated class (students.class_sessions);
--  from now on the dated class is the one truth both sides read and act on:
--
--   * its teachers follow the weekly class: «بالتبادل» puts only that week's teacher,
--     and an approved excuse takes the teacher off that date;
--   * no teacher left → «محتاجة بديل» for the organizers; still none the night before
--     → cancelled, and the students' families and the teachers are told;
--   * changing the weekly class (time, teachers, day, ending it) updates the coming classes;
--   * the teachers' reminders come from the dated classes, so a cancelled, postponed or
--     substituted class reminds the right people (or nobody);
--   * an approved cancel / postpone / pause tells the teachers too, not only the families.
-- =====================================================================

alter table students.class_sessions add column if not exists needs_substitute boolean not null default false;
comment on column students.class_sessions.needs_substitute is 'المدرس اعتذر ومفيش غيره: التنظيم يختار بديل، وإلا بتتلغي بالليل قبلها';

-- The teachers of a weekly class on a date: that week's turn, minus approved excuses.
-- (app.slot_due, from 27, already does exactly that.)

-- ---------------------------------------------------------------------
-- 1) Dated classes from the weekly ones
-- ---------------------------------------------------------------------
create or replace function students.ensure_sessions(p_from date default null, p_to date default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  d0 date := coalesce(p_from, app.today() - 7);
  d1 date := least(coalesce(p_to, app.today() + 14), app.today() + 60);
  n int;
begin
  update public.schedule_slots set status = 'متوقفة'
   where status = 'شغالة' and ends_on is not null and ends_on < app.today();

  insert into students.class_sessions (slot_id, on_date, starts_at, ends_at, subject, kind, takes_attendance, teacher_ids,
                                       needs_substitute, created_by)
  select s.id, d::date, s.starts_at, s.ends_at, s.subject,
         case when s.kind ilike '%امتحان%' then 'امتحان' else 'حصة' end,
         coalesce(s.takes_attendance, true),
         app.slot_due(s, d::date),
         cardinality(app.slot_due(s, d::date)) = 0 and s.teacher_name is null,
         'system'
    from public.schedule_slots s
    cross join generate_series(d0, d1, interval '1 day') d
   where s.status = 'شغالة'
     and s.starts_at is not null and s.ends_at is not null and s.ends_at > s.starts_at
     and s.day = students.weekday_ar(d::date)
     and (s.starts_on is null or d::date >= s.starts_on)
     and (s.ends_on is null or d::date <= s.ends_on)
     and not students.is_paused(s.id, s.grade, d::date)
     -- a class of that date already there (also a cancelled or postponed one) is not made again
     and not exists (select 1 from students.class_sessions c where c.slot_id = s.id and c.on_date = d::date)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The dated class of a weekly class on a date (made if missing).
create or replace function students.session_for(p_slot uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  select id into sid from students.class_sessions
   where slot_id = p_slot and on_date = p_date and status <> 'اتأجلت' order by created_at limit 1;
  if sid is null then
    perform students.ensure_sessions(p_date, p_date);
    select id into sid from students.class_sessions
     where slot_id = p_slot and on_date = p_date and status <> 'اتأجلت' order by created_at limit 1;
  end if;
  return sid;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Changing the weekly class changes the coming dated ones
-- ---------------------------------------------------------------------
create or replace function students.slot_changed()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from students.class_sessions
     where slot_id = old.id and on_date >= app.today() and status = 'متوقعة' and attendance_at is null;
    return old;
  end if;
  if new.day is distinct from old.day or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on
     or new.status is distinct from old.status then
    -- the coming classes no longer on the plan go away (they are made again where they belong)
    delete from students.class_sessions cs
     where cs.slot_id = new.id and cs.on_date >= app.today() and cs.status = 'متوقعة' and cs.attendance_at is null
       and (new.status <> 'شغالة' or cs.on_date < coalesce(new.starts_on, cs.on_date) or cs.on_date > coalesce(new.ends_on, cs.on_date)
            or new.day <> students.weekday_ar(cs.on_date));
  end if;
  update students.class_sessions cs set
    starts_at = new.starts_at, ends_at = new.ends_at, subject = new.subject,
    takes_attendance = coalesce(new.takes_attendance, true),
    teacher_ids = app.slot_due(new, cs.on_date),
    needs_substitute = cs.substitute_id is null and cardinality(app.slot_due(new, cs.on_date)) = 0 and new.teacher_name is null
   where cs.slot_id = new.id and cs.on_date >= app.today() and cs.status = 'متوقعة' and cs.attendance_at is null
     and new.ends_at > new.starts_at;
  if pg_trigger_depth() < 2 and new.status = 'شغالة' then
    perform students.ensure_sessions(app.today(), app.today() + 14);
  end if;
  return new;
end;
$$;
drop trigger if exists schedule_slots_sessions on public.schedule_slots;
create trigger schedule_slots_sessions after update on public.schedule_slots
  for each row execute function students.slot_changed();
drop trigger if exists schedule_slots_sessions_delete on public.schedule_slots;
create trigger schedule_slots_sessions_delete before delete on public.schedule_slots
  for each row execute function students.slot_changed();

-- ---------------------------------------------------------------------
-- 3) A substitute fills the gap
-- ---------------------------------------------------------------------
create or replace function students.session_staffing()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- a weekly class with nobody to teach it (and no outside teacher named on it) needs a substitute
  if new.substitute_id is distinct from old.substitute_id or new.teacher_ids is distinct from old.teacher_ids then
    new.needs_substitute := new.substitute_id is null and cardinality(new.teacher_ids) = 0 and new.slot_id is not null
      and not exists (select 1 from public.schedule_slots s where s.id = new.slot_id and s.teacher_name is not null and s.volunteer_id is null);
  end if;
  return new;
end;
$$;
drop trigger if exists class_sessions_staffing on students.class_sessions;
create trigger class_sessions_staffing before update of substitute_id, teacher_ids on students.class_sessions
  for each row execute function students.session_staffing();

create or replace function students.substitute_told()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_slots;
begin
  if new.substitute_id is not null and new.substitute_id is distinct from old.substitute_id
     and new.on_date >= app.today() and new.status = 'متوقعة' then
    select * into s from public.schedule_slots where id = new.slot_id;
    perform app.notify(app.emails_of(array[new.substitute_id]), 'هتدّي حصة بدل',
      new.subject || coalesce(' ' || s.grade, '') || ' يوم ' || to_char(new.on_date, 'DD/MM') || ' الساعة ' || to_char(new.starts_at, 'HH12:MI')
        || coalesce(' · ' || s.place, ''),
      '/classes?date=' || new.on_date);
  end if;
  return null;
end;
$$;
drop trigger if exists class_sessions_substitute_told on students.class_sessions;
create trigger class_sessions_substitute_told after update of substitute_id on students.class_sessions
  for each row execute function students.substitute_told();

-- ---------------------------------------------------------------------
-- 4) A teacher's excuse acts on the dated class
-- ---------------------------------------------------------------------
create or replace function public.review_absence(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.class_absences;
  s public.schedule_slots;
  who text;
  sid uuid;
  sess students.class_sessions;
begin
  if not (app.has_perm('absences.review') or app.has_perm('schedule.edit')) then
    raise exception 'محتاج صلاحية مراجعة الطلبات' using errcode = '42501';
  end if;
  select * into a from public.class_absences where id = p_id for update;
  if not found or a.status <> 'pending' then
    raise exception 'الطلب ده اتراجع قبل كده' using errcode = '22023';
  end if;
  update public.class_absences set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = app.email(), reviewed_at = now()
   where id = p_id;
  select * into s from public.schedule_slots where id = a.slot_id;
  select full_name_ar into who from public.volunteers where id = a.volunteer_id;

  perform app.notify(app.emails_of(array[a.volunteer_id]),
    case when p_approve then 'اعتذارك اتقبل' else 'اعتذارك اترفض' end,
    app.slot_label(s) || ' يوم ' || to_char(a.on_date, 'DD/MM')
      || case when p_approve then '' else '. الحصة لسه عليك، كلّم التنظيم لو فيه مشكلة' end,
    '/classes?date=' || a.on_date);

  if p_approve then
    sid := students.session_for(a.slot_id, a.on_date);
    if sid is not null then
      update students.class_sessions set teacher_ids = array_remove(teacher_ids, a.volunteer_id),
             needs_substitute = substitute_id is null and cardinality(array_remove(teacher_ids, a.volunteer_id)) = 0
       where id = sid
      returning * into sess;
    end if;
    perform app.notify(app.emails_of(array_remove(array[s.volunteer_id] || s.co_teachers, a.volunteer_id)),
      'تغيير في حصة', who || ' معتذر عن ' || app.slot_label(s) || ' يوم ' || to_char(a.on_date, 'DD/MM'),
      '/classes?date=' || a.on_date);
    if sess.needs_substitute then
      perform app.notify(app.emails_with('absences.review'), 'حصة محتاجة بديل',
        app.slot_label(s) || ' يوم ' || to_char(a.on_date, 'DD/MM') || ': ' || who
          || ' معتذر ومفيش مدرس تاني. لو محدش اتحط بديل لحد 8 بالليل قبلها هتتلغي والأهالي يتبلغوا.',
        '/classes?date=' || a.on_date);
    end if;
  end if;
end;
$$;
revoke all on function public.review_absence(uuid, boolean) from public, anon;
grant execute on function public.review_absence(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5) The night before: no teacher → cancelled; then the reminders, from the dated classes
-- ---------------------------------------------------------------------
create or replace function students.cancel_unstaffed(p_date date)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  cs students.class_sessions;
  s public.schedule_slots;
  label text;
  n int := 0;
begin
  for cs in select * from students.class_sessions
             where on_date = p_date and status = 'متوقعة' and needs_substitute and substitute_id is null
  loop
    update students.class_sessions set status = 'اتلغت',
           notes = concat_ws(' · ', nullif(notes, ''), 'اتلغت: مفيش مدرس')
     where id = cs.id;
    select * into s from public.schedule_slots where id = cs.slot_id;
    label := cs.subject || coalesce(' ' || s.grade, '') || ' يوم ' || to_char(cs.on_date, 'DD/MM');
    perform students.notify_family(array(select students.class_student_ids(cs.slot_id, cs.id)), 'حصة اتلغت', label || ' اتلغت.');
    perform app.notify(app.emails_with('absences.review'), 'حصة اتلغت', label || ' اتلغت لأن مفيش مدرس ولا بديل.',
                       '/classes?date=' || cs.on_date);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function app.remind_classes_tomorrow()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  d date := app.today() + 1;
  cs students.class_sessions;
  s public.schedule_slots;
  who uuid[];
  n int := 0;
begin
  perform students.ensure_sessions(d, d);
  perform students.cancel_unstaffed(d);
  for cs in select * from students.class_sessions where on_date = d and status = 'متوقعة' and slot_id is not null loop
    who := case when cs.substitute_id is not null then array[cs.substitute_id] else cs.teacher_ids end;
    if cardinality(who) = 0 then continue; end if;
    insert into public.class_reminders_sent values (cs.slot_id, d, 'night') on conflict do nothing;
    if not found then continue; end if;
    select * into s from public.schedule_slots where id = cs.slot_id;
    perform app.notify(app.emails_of(who), 'بكرة عندك حصة',
      cs.subject || ' ' || s.grade || ' الساعة ' || to_char(cs.starts_at, 'HH12:MI')
        || case when cs.starts_at < '12:00' then ' ص' else ' م' end || coalesce(' · ' || s.place, '')
        || case when cs.substitute_id is not null then ' (بدل المدرس)' else '' end || '. مستنيينك 💪',
      '/classes?date=' || d);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function app.remind_classes_soon()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  d date := app.today();
  t time := (now() at time zone 'Africa/Cairo')::time;
  cs students.class_sessions;
  s public.schedule_slots;
  who uuid[];
  n int := 0;
begin
  for cs in select * from students.class_sessions
             where on_date = d and status = 'متوقعة' and slot_id is not null
               and starts_at > t + interval '1 hour 45 minutes' and starts_at <= t + interval '2 hours'
  loop
    who := case when cs.substitute_id is not null then array[cs.substitute_id] else cs.teacher_ids end;
    if cardinality(who) = 0 then continue; end if;
    insert into public.class_reminders_sent values (cs.slot_id, d, 'soon') on conflict do nothing;
    if not found then continue; end if;
    select * into s from public.schedule_slots where id = cs.slot_id;
    perform app.notify(app.emails_of(who), 'حصتك كمان ساعتين',
      cs.subject || ' ' || s.grade || ' الساعة ' || to_char(cs.starts_at, 'HH12:MI') || coalesce(' · ' || s.place, ''),
      '/classes?date=' || d);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function app.remind_classes_tomorrow() from public, anon, authenticated;
revoke all on function app.remind_classes_soon() from public, anon, authenticated;
revoke all on function students.cancel_unstaffed(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) An approved cancel / postpone / pause tells the teachers too
-- ---------------------------------------------------------------------
create or replace function students.slot_request_teachers()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_slots;
  body text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select * into s from public.schedule_slots where id = new.slot_id;
    body := app.slot_label(s) || case new.kind
      when 'إلغاء مرة' then ' يوم ' || to_char(new.on_date, 'DD/MM') || ' اتلغت'
      when 'تأجيل' then ' بتاعة ' || to_char(new.on_date, 'DD/MM') || ' اتأجلت لـ ' || to_char(new.new_date, 'DD/MM')
                       || ' الساعة ' || to_char(new.new_starts_at, 'HH12:MI')
      when 'إيقاف' then ' متوقفة من ' || to_char(new.pause_from, 'DD/MM') || ' لـ ' || to_char(new.pause_to, 'DD/MM')
      else ' اتلغت من ' || to_char(new.from_date, 'DD/MM') end;
    perform app.notify(app.emails_of(array_remove(array[s.volunteer_id] || coalesce(s.co_teachers, '{}'), null)),
      'تغيير في حصة', body, '/classes');
  end if;
  return null;
end;
$$;
drop trigger if exists slot_requests_teachers on students.slot_requests;
create trigger slot_requests_teachers after update of status on students.slot_requests
  for each row execute function students.slot_request_teachers();

-- the coming classes take this week's turn and the approved excuses now
update students.class_sessions cs set teacher_ids = app.slot_due(s, cs.on_date)
  from public.schedule_slots s
 where s.id = cs.slot_id and cs.on_date >= app.today() and cs.status = 'متوقعة' and cs.attendance_at is null
   and cs.substitute_id is null and cs.teacher_ids is distinct from app.slot_due(s, cs.on_date);

-- ---------------------------------------------------------------------
-- 7) Organizers pick the substitute (without needing the students' permissions)
-- ---------------------------------------------------------------------
create or replace function students.set_substitute(p_session uuid, p_volunteer uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (app.has_perm('absences.review') or app.has_perm('schedule.edit') or app.has_perm('students.attendance')) then
    raise exception 'محتاج صلاحية مراجعة الاعتذارات أو تعديل الجدول' using errcode = '42501';
  end if;
  update students.class_sessions set substitute_id = p_volunteer where id = p_session;
  if not found then
    raise exception 'الحصة دي مش موجودة' using errcode = '22023';
  end if;
end;
$$;
revoke all on function students.set_substitute(uuid, uuid) from public, anon;
grant execute on function students.set_substitute(uuid, uuid) to authenticated;

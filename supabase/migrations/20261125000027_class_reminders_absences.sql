-- =====================================================================
-- 27) Class reminders and excuses
--   * the night before (8 pm Cairo): «بكرة عندك حصة…», with the way to excuse yourself
--   * two hours before: a plain reminder. No excuses on the day itself.
--   * an excuse is a request the organizers approve; once approved, everyone tied
--     to the class is told (the other teachers now; students and parents later)
-- =====================================================================

-- Saturday = 1 … Friday = 7, the order of public.weekday_ar
create or replace function app.weekday_of(d date)
returns public.weekday_ar language sql immutable set search_path = '' as $$
  select (enum_range(null::public.weekday_ar))[((extract(dow from d)::int + 1) % 7) + 1]
$$;

create table if not exists public.class_absences (
  id            uuid primary key default extensions.gen_random_uuid(),
  slot_id       uuid not null references public.schedule_slots (id) on delete cascade,
  on_date       date not null,
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  reason        text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now(),
  reviewed_by   extensions.citext,
  reviewed_at   timestamptz,
  unique (slot_id, on_date, volunteer_id)
);
alter table public.class_absences enable row level security;
create policy class_absences_read on public.class_absences for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('attendance.review'))
         or (select app.has_perm('schedule.edit')));
revoke insert, update, delete on public.class_absences from anon, authenticated;

-- one reminder per class, day and kind
create table if not exists public.class_reminders_sent (
  slot_id  uuid not null references public.schedule_slots (id) on delete cascade,
  on_date  date not null,
  kind     text not null,
  primary key (slot_id, on_date, kind)
);
alter table public.class_reminders_sent enable row level security;
revoke all on public.class_reminders_sent from anon, authenticated;

-- teachers due on a date, minus approved excuses
create or replace function app.slot_due(s public.schedule_slots, d date)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(t), '{}')
    from unnest(app.slot_teacher_on(s, d)) t
   where not exists (select 1 from public.class_absences a
                      where a.slot_id = s.id and a.on_date = d and a.volunteer_id = t and a.status = 'approved')
$$;

create or replace function app.emails_of(ids uuid[])
returns extensions.citext[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(email), '{}') from public.volunteers where id = any (ids) and email is not null
$$;

create or replace function app.slot_label(s public.schedule_slots)
returns text language sql stable set search_path = '' as $$
  select s.subject || ' ' || s.grade || ' الساعة ' || to_char(s.starts_at, 'HH12:MI') ||
         case when s.starts_at < '12:00' then ' ص' else ' م' end || coalesce(' · ' || s.place, '')
$$;

-- The night before
create or replace function app.remind_classes_tomorrow()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  d date := app.today() + 1;
  s public.schedule_slots;
  n int := 0;
begin
  for s in select * from public.schedule_slots where day = app.weekday_of(d) loop
    if cardinality(app.slot_due(s, d)) = 0 then continue; end if;
    insert into public.class_reminders_sent values (s.id, d, 'night') on conflict do nothing;
    if not found then continue; end if;
    perform app.notify(app.emails_of(app.slot_due(s, d)), 'بكرة عندك حصة',
      app.slot_label(s) || '. لو مش هتقدر تيجي اعتذر دلوقتي عشان التنظيم يلحق',
      '/schedule?absence=' || s.id || '&date=' || d);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Two hours before (runs every 15 minutes)
create or replace function app.remind_classes_soon()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  d date := app.today();
  t time := (now() at time zone 'Africa/Cairo')::time;
  s public.schedule_slots;
  n int := 0;
begin
  for s in select * from public.schedule_slots
            where day = app.weekday_of(d)
              and starts_at > t + interval '1 hour 45 minutes' and starts_at <= t + interval '2 hours'
  loop
    if cardinality(app.slot_due(s, d)) = 0 then continue; end if;
    insert into public.class_reminders_sent values (s.id, d, 'soon') on conflict do nothing;
    if not found then continue; end if;
    perform app.notify(app.emails_of(app.slot_due(s, d)), 'حصتك كمان ساعتين', app.slot_label(s), '/schedule');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function app.remind_classes_tomorrow() from public, anon, authenticated;
revoke all on function app.remind_classes_soon() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('class-reminder-night', 'class-reminder-soon');
select cron.schedule('class-reminder-night', '0 18 * * *', $$select app.remind_classes_tomorrow()$$);   -- 8 pm Cairo
select cron.schedule('class-reminder-soon', '*/15 * * * *', $$select app.remind_classes_soon()$$);

-- A teacher excuses themselves from a coming class (not on the day itself)
create or replace function public.request_absence(p_slot uuid, p_date date, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  vid uuid := app.my_volunteer_id();
  s public.schedule_slots;
begin
  select * into s from public.schedule_slots where id = p_slot;
  if not found then
    raise exception 'الحصة دي مش موجودة' using errcode = '22023';
  end if;
  if p_date <= app.today() then
    raise exception 'مينفعش تعتذر عن حصة في نفس يومها. كلّم التنظيم على طول' using errcode = '22023';
  end if;
  if app.weekday_of(p_date) <> s.day then
    raise exception 'الحصة دي مش يوم %', app.weekday_of(p_date) using errcode = '22023';
  end if;
  if vid is null or not (vid = any (app.slot_teacher_on(s, p_date))) then
    raise exception 'الحصة دي مش عليك اليوم ده' using errcode = '42501';
  end if;
  insert into public.class_absences (slot_id, on_date, volunteer_id, reason)
  values (p_slot, p_date, vid, nullif(btrim(p_reason), ''))
  on conflict (slot_id, on_date, volunteer_id) do update
    set reason = excluded.reason, status = 'pending', reviewed_by = null, reviewed_at = null, created_at = now();
  perform app.notify(app.emails_with('attendance.review'), 'اعتذار عن حصة',
    (select full_name_ar from public.volunteers where id = vid) || ' معتذر عن ' || app.slot_label(s) || ' يوم ' || to_char(p_date, 'DD/MM')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''),
    '/requests?tab=absences');
end;
$$;
revoke all on function public.request_absence(uuid, date, text) from public, anon;
grant execute on function public.request_absence(uuid, date, text) to authenticated;

-- Organizers decide; approval tells everyone tied to the class
create or replace function public.review_absence(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.class_absences;
  s public.schedule_slots;
  who text;
  left_ids uuid[];
begin
  if not (app.has_perm('attendance.review') or app.has_perm('schedule.edit')) then
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
    '/schedule');

  if p_approve then
    -- the other teachers on the class (students and parents join here once they are in the system)
    left_ids := app.slot_due(s, a.on_date);
    perform app.notify(app.emails_of(array_remove(array[s.volunteer_id] || s.co_teachers, a.volunteer_id)),
      case when cardinality(left_ids) = 0 then 'حصة اتلغت' else 'تغيير في حصة' end,
      who || ' معتذر عن ' || app.slot_label(s) || ' يوم ' || to_char(a.on_date, 'DD/MM')
        || case when cardinality(left_ids) = 0 then '. الحصة مش هتتعمل إلا لو التنظيم لقى بديل' else '' end,
      '/schedule');
  end if;
end;
$$;
revoke all on function public.review_absence(uuid, boolean) from public, anon;
grant execute on function public.review_absence(uuid, boolean) to authenticated;

create or replace function app.backup_tables()
returns text[] language sql immutable as $$
  select array['app_settings', 'lookups', 'roles', 'volunteers', 'volunteer_private', 'volunteer_hr', 'staff_roles',
               'committee_leaders', 'group_activities', 'meetings', 'participations', 'meeting_photos', 'schedule_slots',
               'class_absences', 'certificate_requests', 'stages', 'stage_done', 'rules_acceptances', 'activity_rules',
               'rule_answers', 'tshirt_requests', 'camps', 'camp_registrations', 'recruit_log', 'registration_requests',
               'notifications', 'audit_log']
$$;

-- =====================================================================
-- 14) Meetings, follow-up data, report mapping, report queries
--
-- Built from the three sheets the branch reports with:
--   * تقييم فني (layout «اقتراح»): per day, counts per activity column, grouped by committee
--   * شيت الاجتماعات: one row per meeting
--   * شيت المتابعة: per volunteer, per day 1 = في الفرع / 2 = من المنزل, plus follow-up data
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Follow-up data on the volunteer
-- ---------------------------------------------------------------------
alter table public.volunteers
  add column if not exists facebook          text,
  add column if not exists study_year        text,   -- السنة الدراسية للمتطوع (طالب / خريج ...)
  add column if not exists follower_id       uuid references public.volunteers (id) on delete set null,  -- المتابع
  add column if not exists follower_trainee_id uuid references public.volunteers (id) on delete set null, -- متابع تحت التدريب
  add column if not exists follow_head_id    uuid references public.volunteers (id) on delete set null,  -- هيد المتابعة
  add column if not exists follow_notes_1    text,
  add column if not exists follow_notes_2    text,
  add column if not exists follow_notes_3    text,
  add column if not exists out_reason        text;   -- الأعمدة: سبب الخروج من المتابعة

-- Who may change them: facebook / study_year are personal (the volunteer or volunteers.edit);
-- follow-up assignment, notes and the leaving reason need volunteers.edit (or the committee leader for notes).
create or replace function app.guard_volunteer_followup()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  full_access boolean := app.has_perm('volunteers.edit') or app.is_internal();
  is_self     boolean := old.email is not null and old.email = app.email();
  is_leader   boolean := app.leads(old.main_committee, old.sub_committee);
begin
  if full_access then
    return new;
  end if;
  if not is_self and (new.facebook is distinct from old.facebook or new.study_year is distinct from old.study_year) then
    raise exception 'البيانات الشخصية يعدّلها المتطوع نفسه أو اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
  end if;
  if new.follower_id is distinct from old.follower_id
     or new.follower_trainee_id is distinct from old.follower_trainee_id
     or new.follow_head_id is distinct from old.follow_head_id
     or new.out_reason is distinct from old.out_reason then
    raise exception 'المتابع وسبب الخروج يحددهم اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
  end if;
  if not is_leader and (
       new.follow_notes_1 is distinct from old.follow_notes_1
    or new.follow_notes_2 is distinct from old.follow_notes_2
    or new.follow_notes_3 is distinct from old.follow_notes_3) then
    raise exception 'ملاحظات المتابعة يكتبها ليدر اللجنة أو اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists volunteers_guard_followup on public.volunteers;
create trigger volunteers_guard_followup before update on public.volunteers
  for each row execute function app.guard_volunteer_followup();

-- Leaving reasons (column «الأعمدة» in the follow-up sheet). A reason puts the volunteer out of follow-up there.
insert into public.lookups (list, value, sort_order)
select 'سبب الخروج', v, n
  from unnest(array['مسئول مجمد', 'مشروع مجمد', 'مسئول مرفود أعمدة', 'مشروع مرفود أعمدة', 'مسئول مستقيل', 'مشروع مستقيل',
                    'داخل المتابعة رافض المسئوليه', 'مرفود غرامة انترفيو', 'مسئول رفد شيت', 'مشروع رفد شيت',
                    'داخل المتابعة أكثر من 6 شهور']) with ordinality as t(v, n)
on conflict do nothing;

insert into public.lookups (list, value, sort_order)
select 'السنة الدراسية للمتطوع', v, n
  from unnest(array['طالب ثانوي', 'سنة أولى جامعة', 'سنة تانية جامعة', 'سنة تالتة جامعة', 'سنة رابعة جامعة', 'سنة خامسة جامعة', 'خريج']) with ordinality as t(v, n)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2) Which column of the evaluation sheet each event goes to
-- ---------------------------------------------------------------------
alter table public.lookups add column if not exists report_column text;

-- New events the evaluation sheet counts
insert into public.lookups (list, value, sort_order, form)
select 'الحدث', v, 100 + n, 'optional'
  from unnest(array['ورشة فنية', 'حصة سلوكية', 'ندوة دينية', 'تحفيظ قرآن وسيرة', 'يوم رياضي', 'كرنفال ودعاية', 'رحلة', 'ايفينت']) with ordinality as t(v, n)
on conflict do nothing;

update public.lookups l set report_column = m.col
  from (values
    ('تدريس', 'classes'), ('تأسيس', 'foundation'), ('تحضير محتوى', 'content'), ('امتحان شهري', 'exam'),
    ('تنظيم', 'organizers'), ('اداريات', 'admin'), ('انترفيو', 'admin'), ('أجتماع', 'meetings'), ('اجتماع', 'meetings'),
    ('كامب', 'camps'), ('ميني كامب', 'camps'), ('ورشة فنية', 'workshop'), ('يوم رياضي', 'sports'), ('رحلة', 'trips'),
    ('حصة سلوكية', 'behavior'), ('ندوة دينية', 'religious'), ('تربية دينية', 'religious'), ('تحفيظ قرآن وسيرة', 'quran'),
    ('اتصالات', 'calls'), ('ميديا', 'media'), ('كرنفال ودعاية', 'media'), ('كورس', 'courses'), ('ايفينت', 'events')
  ) as m(value, col)
 where l.list = 'الحدث' and l.value = m.value and l.report_column is null;

-- ---------------------------------------------------------------------
-- 3) Meetings
-- ---------------------------------------------------------------------
create table if not exists public.meetings (
  id              uuid primary key default extensions.gen_random_uuid(),
  meeting_date    date not null,
  committee       text not null,                 -- اللجنة / فريق العمل
  head_id         uuid references public.volunteers (id) on delete set null,
  head_name       text,                          -- لو الهيد مش متطوع عندنا
  head_role       text,                          -- دوره في الهيكل
  meeting_type    text not null default 'الفرع',  -- اونلاين / الفرع / اوفلاين
  goal            text,
  achievements    text,
  minutes_link    text,
  attendees_extra int not null default 0 check (attendees_extra >= 0),  -- حاضرين مش متسجلين كمتطوعين
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists meetings_date_idx on public.meetings (meeting_date desc);

alter table public.participations add column if not exists meeting_id uuid references public.meetings (id) on delete cascade;

alter table public.meetings enable row level security;
create policy meetings_read on public.meetings for select to authenticated
  using ((select app.has_perm('attendance.view_all')) or (select app.has_perm('attendance.register'))
         or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email())));
create policy meetings_write on public.meetings for all to authenticated
  using ((select app.has_perm('attendance.register')) or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email()) and cl.committee = meetings.committee))
  with check ((select app.has_perm('attendance.register')) or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email()) and cl.committee = meetings.committee));

create trigger audit_meetings after insert or update or delete on public.meetings
  for each row execute function app.audit();

-- Save a meeting with its attendees in one go. Each attendee gets an accepted «أجتماع» participation.
create or replace function public.save_meeting(p jsonb, p_attendees uuid[])
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  m_id uuid := nullif(p ->> 'id', '')::uuid;
  m public.meetings;
  ev text := coalesce((select value from public.lookups where list = 'الحدث' and report_column = 'meetings' order by sort_order limit 1), 'أجتماع');
begin
  if not (app.has_perm('attendance.register')
          or exists (select 1 from public.committee_leaders cl where cl.email = app.email() and cl.committee = p ->> 'committee')) then
    raise exception 'مش مسموح لك تسجل اجتماع' using errcode = '42501';
  end if;
  if coalesce(p ->> 'meeting_date', '') = '' or coalesce(p ->> 'committee', '') = '' then
    raise exception 'التاريخ واللجنة مطلوبين' using errcode = '22023';
  end if;

  if m_id is null then
    insert into public.meetings (meeting_date, committee, head_id, head_name, head_role, meeting_type, goal, achievements, minutes_link, attendees_extra, created_by)
    values ((p ->> 'meeting_date')::date, p ->> 'committee', nullif(p ->> 'head_id', '')::uuid, nullif(p ->> 'head_name', ''),
            nullif(p ->> 'head_role', ''), coalesce(nullif(p ->> 'meeting_type', ''), 'الفرع'), nullif(p ->> 'goal', ''),
            nullif(p ->> 'achievements', ''), nullif(p ->> 'minutes_link', ''), coalesce((p ->> 'attendees_extra')::int, 0), app.email())
    returning * into m;
  else
    update public.meetings set
      meeting_date = (p ->> 'meeting_date')::date, committee = p ->> 'committee', head_id = nullif(p ->> 'head_id', '')::uuid,
      head_name = nullif(p ->> 'head_name', ''), head_role = nullif(p ->> 'head_role', ''),
      meeting_type = coalesce(nullif(p ->> 'meeting_type', ''), 'الفرع'), goal = nullif(p ->> 'goal', ''),
      achievements = nullif(p ->> 'achievements', ''), minutes_link = nullif(p ->> 'minutes_link', ''),
      attendees_extra = coalesce((p ->> 'attendees_extra')::int, 0), updated_at = now()
    where id = m_id
    returning * into m;
    if m is null then
      raise exception 'الاجتماع ده مش موجود';
    end if;
  end if;

  perform app.begin_internal();
  -- attendees removed from the list lose the meeting's participation
  delete from public.participations where meeting_id = m.id and not (volunteer_id = any (coalesce(p_attendees, '{}')));
  update public.participations set activity_date = m.meeting_date, subject = m.committee where meeting_id = m.id;
  insert into public.participations (volunteer_id, activity_date, event, subject, place, status, method, meeting_id, created_by, reviewed_by, reviewed_at)
  select a, m.meeting_date, ev, m.committee, case when m.meeting_type = 'اونلاين' then 'اونلاين' else 'الفرع' end,
         'accepted', 'group', m.id, app.email(), app.email(), now()
    from unnest(coalesce(p_attendees, '{}')) a
   where not exists (select 1 from public.participations x where x.meeting_id = m.id and x.volunteer_id = a)
  on conflict do nothing;
  perform app.end_internal();
  return m.id;
end;
$$;
revoke all on function public.save_meeting(jsonb, uuid[]) from public, anon;
grant execute on function public.save_meeting(jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Report queries (site preview + the Google Sheets writer through the backup function)
-- ---------------------------------------------------------------------
create or replace function app.can_report()
returns boolean language sql stable set search_path = '' as $$
  select app.has_perm('stats.view') or app.is_internal()
$$;

-- Evaluation sheet («اقتراح» layout): one row per day of the month.
create or replace function public.report_eval(p_month date)
returns table (
  day date, classes int, foundation int, content int, exam_primary int, exam_prep int, organizers int, admin int,
  meetings_desc text, meetings int, camps int, workshop_type text, workshops int, sports int, trips int, behavior int,
  religious int, quran int, calls int, media int, courses_type text, courses int, events int, other_type text, other int
)
language sql stable security definer
set search_path = ''
as $$
  with days as (
    select d::date as day
      from generate_series(date_trunc('month', p_month), date_trunc('month', p_month) + interval '1 month' - interval '1 day', interval '1 day') d
  ),
  p as (
    select pa.*, coalesce(l.report_column, 'other') as col,
           -- one session = same event, subject, grade and place that day (several volunteers count once)
           pa.event || '|' || coalesce(pa.subject, '') || '|' || coalesce(pa.grade, '') || '|' || coalesce(pa.place, '') as session
      from public.participations pa
      left join public.lookups l on l.list = 'الحدث' and l.value = pa.event
     where pa.status = 'accepted' and app.can_report()
       and pa.activity_date >= date_trunc('month', p_month) and pa.activity_date < date_trunc('month', p_month) + interval '1 month'
  ),
  mt as (
    select meeting_date, string_agg(distinct committee, ' - ') as descr, count(*)::int as n
      from public.meetings
     where app.can_report() and meeting_date >= date_trunc('month', p_month) and meeting_date < date_trunc('month', p_month) + interval '1 month'
     group by meeting_date
  )
  select d.day,
    count(distinct p.session) filter (where p.col = 'classes')::int,
    count(distinct p.session) filter (where p.col = 'foundation')::int,
    count(distinct p.session) filter (where p.col = 'content')::int,
    count(distinct p.session) filter (where p.col = 'exam' and p.grade ~ '^[4-6] ?ب')::int,
    count(distinct p.session) filter (where p.col = 'exam' and p.grade ~ '^[1-3] ?ع')::int,
    count(distinct p.volunteer_id) filter (where p.col = 'organizers')::int,
    count(distinct p.session) filter (where p.col = 'admin')::int,
    max(mt.descr),
    coalesce(max(mt.n), count(distinct p.session) filter (where p.col = 'meetings'))::int,
    count(distinct p.session) filter (where p.col = 'camps')::int,
    string_agg(distinct coalesce(p.subject, p.event), ' - ') filter (where p.col = 'workshop'),
    count(distinct p.session) filter (where p.col = 'workshop')::int,
    count(distinct p.session) filter (where p.col = 'sports')::int,
    count(distinct p.session) filter (where p.col = 'trips')::int,
    count(distinct p.session) filter (where p.col = 'behavior')::int,
    count(distinct p.session) filter (where p.col = 'religious')::int,
    count(distinct p.session) filter (where p.col = 'quran')::int,
    count(distinct p.session) filter (where p.col = 'calls')::int,
    count(distinct p.session) filter (where p.col = 'media')::int,
    string_agg(distinct coalesce(p.subject, p.event), ' - ') filter (where p.col = 'courses'),
    count(distinct p.session) filter (where p.col = 'courses')::int,
    count(distinct p.session) filter (where p.col = 'events')::int,
    string_agg(distinct p.event, ' - ') filter (where p.col = 'other'),
    count(distinct p.session) filter (where p.col = 'other')::int
  from days d
  left join p on p.activity_date = d.day
  left join mt on mt.meeting_date = d.day
  group by d.day
  order by d.day
$$;
revoke all on function public.report_eval(date) from public, anon;
grant execute on function public.report_eval(date) to authenticated, service_role;

-- Meetings sheet: one row per meeting of the month.
create or replace function public.report_meetings(p_month date)
returns table (
  n bigint, meeting_date date, committee text, head text, head_role text, attendees int, goal text, achievements text,
  meeting_type text, minutes_link text
)
language sql stable security definer
set search_path = ''
as $$
  select row_number() over (order by m.meeting_date, m.created_at), m.meeting_date, m.committee,
         coalesce(v.full_name_ar, m.head_name), coalesce(m.head_role, v.position),
         ((select count(*) from public.participations x where x.meeting_id = m.id) + m.attendees_extra)::int,
         m.goal, m.achievements, m.meeting_type, m.minutes_link
    from public.meetings m
    left join public.volunteers v on v.id = m.head_id
   where app.can_report()
     and m.meeting_date >= date_trunc('month', p_month) and m.meeting_date < date_trunc('month', p_month) + interval '1 month'
   order by m.meeting_date, m.created_at
$$;
revoke all on function public.report_meetings(date) from public, anon;
grant execute on function public.report_meetings(date) to authenticated, service_role;

-- Follow-up sheet: per volunteer per day, 1 = في الفرع, 2 = من المنزل (online / outside counts as home).
create or replace function public.report_followup_days(p_from date, p_to date)
returns table (volunteer_id uuid, day date, code int)
language sql stable security definer
set search_path = ''
as $$
  select pa.volunteer_id, pa.activity_date,
         case when bool_or(coalesce(pa.place, 'الفرع') = 'الفرع') then 1 else 2 end
    from public.participations pa
   where pa.status = 'accepted' and app.can_report()
     and pa.activity_date between p_from and p_to
   group by pa.volunteer_id, pa.activity_date
$$;
revoke all on function public.report_followup_days(date, date) from public, anon;
grant execute on function public.report_followup_days(date, date) to authenticated, service_role;

-- Where the reports are written (Google Sheets links, set in the settings page)
insert into public.app_settings (key, value) values ('report_sheet_eval', null), ('report_sheet_meetings', null)
on conflict (key) do nothing;

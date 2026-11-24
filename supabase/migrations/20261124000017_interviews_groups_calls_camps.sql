-- =====================================================================
-- 17) Interviewer is a volunteer (interview counts for both), group activities with photos
--     (meetings + family days), calls count and duration, camps / graduation party outside
--     the daily follow-up and required before «مسئول», automatic report sync
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Interviews: the interviewer is a volunteer; the interview is a participation for both
-- ---------------------------------------------------------------------
alter table public.volunteer_hr add column if not exists interviewer_id uuid references public.volunteers (id) on delete set null;
alter table public.participations add column if not exists auto_ref text;   -- set by the system (interview:<id>)
create index if not exists participations_auto_ref on public.participations (auto_ref) where auto_ref is not null;

create or replace function app.interview_participations()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  ref text := 'interview:' || new.volunteer_id;
  ev text := coalesce((select value from public.lookups where list = 'الحدث' and value in ('انترفيو', 'إنترفيو') order by sort_order limit 1), 'انترفيو');
  who text := (select full_name_ar from public.volunteers where id = new.volunteer_id);
begin
  if new.interviewer_id is not null then
    new.interviewer := coalesce((select full_name_ar from public.volunteers where id = new.interviewer_id), new.interviewer);
  end if;
  if tg_op = 'UPDATE' and new.interview_date is not distinct from old.interview_date
     and new.interviewer_id is not distinct from old.interviewer_id then
    return new;
  end if;
  perform app.begin_internal();
  delete from public.participations where auto_ref = ref;
  if new.interview_date is not null then
    insert into public.participations (volunteer_id, activity_date, event, subject, place, status, method, auto_ref, created_by, reviewed_by, reviewed_at)
    select x.vid, new.interview_date, ev, x.subj, 'الفرع', 'accepted', 'group', ref, app.email(), app.email(), now()
      from (values (new.volunteer_id, 'مقابلة جديدة'), (new.interviewer_id, 'مقابلة ' || coalesce(who, ''))) as x(vid, subj)
     where x.vid is not null
    on conflict do nothing;
  end if;
  perform app.end_internal();
  return new;
end;
$$;
drop trigger if exists hr_interview_participations on public.volunteer_hr;
create trigger hr_interview_participations before insert or update on public.volunteer_hr
  for each row execute function app.interview_participations();

-- ---------------------------------------------------------------------
-- 2) Group activities: meetings and family days, with photos and editable attendees
-- ---------------------------------------------------------------------
alter table public.meetings add column if not exists event text not null default 'أجتماع';

insert into public.lookups (list, value, sort_order, form)
select 'الحدث', 'يوم عائلي', 150, 'optional'
 where not exists (select 1 from public.lookups where list = 'الحدث' and value = 'يوم عائلي');

create table if not exists public.meeting_photos (
  id          uuid primary key default extensions.gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  path        text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
alter table public.meeting_photos enable row level security;
create policy meeting_photos_read on public.meeting_photos for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id));           -- same people who see the meeting
create policy meeting_photos_write on public.meeting_photos for insert to authenticated
  with check (exists (select 1 from public.meetings m where m.id = meeting_id
                       and ((select app.has_perm('attendance.register'))
                            or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email()) and cl.committee = m.committee))));
create policy meeting_photos_delete on public.meeting_photos for delete to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id
                  and ((select app.has_perm('attendance.register'))
                       or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email()) and cl.committee = m.committee))));
create or replace function app.photo_stamp() returns trigger language plpgsql set search_path = '' as $$
begin new.created_by := app.email(); return new; end; $$;
create trigger meeting_photos_stamp before insert on public.meeting_photos for each row execute function app.photo_stamp();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('activity-photos', 'activity-photos', false, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
create policy activity_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'activity-photos'
         and exists (select 1 from public.meetings m where m.id::text = (storage.foldername(name))[1]));
create policy activity_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'activity-photos'
              and exists (select 1 from public.meetings m where m.id::text = (storage.foldername(name))[1]
                           and ((select app.has_perm('attendance.register'))
                                or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email()) and cl.committee = m.committee))));
create policy activity_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'activity-photos'
         and exists (select 1 from public.meetings m where m.id::text = (storage.foldername(name))[1]
                      and ((select app.has_perm('attendance.register'))
                           or exists (select 1 from public.committee_leaders cl where cl.email = (select app.email()) and cl.committee = m.committee))));

-- save_meeting now records the event (اجتماع / يوم عائلي) too
create or replace function public.save_meeting(p jsonb, p_attendees uuid[])
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  m_id uuid := nullif(p ->> 'id', '')::uuid;
  m public.meetings;
  ev text := coalesce(nullif(p ->> 'event', ''),
                      (select value from public.lookups where list = 'الحدث' and report_column = 'meetings' order by sort_order limit 1),
                      'أجتماع');
begin
  if not (app.has_perm('attendance.register')
          or exists (select 1 from public.committee_leaders cl where cl.email = app.email() and cl.committee = p ->> 'committee')) then
    raise exception 'مش مسموح لك تسجل النشاط ده' using errcode = '42501';
  end if;
  if coalesce(p ->> 'meeting_date', '') = '' or coalesce(p ->> 'committee', '') = '' then
    raise exception 'التاريخ واللجنة مطلوبين' using errcode = '22023';
  end if;

  if m_id is null then
    insert into public.meetings (event, meeting_date, committee, head_id, head_name, head_role, meeting_type, goal, achievements, minutes_link, attendees_extra, created_by)
    values (ev, (p ->> 'meeting_date')::date, p ->> 'committee', nullif(p ->> 'head_id', '')::uuid, nullif(p ->> 'head_name', ''),
            nullif(p ->> 'head_role', ''), coalesce(nullif(p ->> 'meeting_type', ''), 'الفرع'), nullif(p ->> 'goal', ''),
            nullif(p ->> 'achievements', ''), nullif(p ->> 'minutes_link', ''), coalesce((p ->> 'attendees_extra')::int, 0), app.email())
    returning * into m;
  else
    update public.meetings set
      event = ev, meeting_date = (p ->> 'meeting_date')::date, committee = p ->> 'committee', head_id = nullif(p ->> 'head_id', '')::uuid,
      head_name = nullif(p ->> 'head_name', ''), head_role = nullif(p ->> 'head_role', ''),
      meeting_type = coalesce(nullif(p ->> 'meeting_type', ''), 'الفرع'), goal = nullif(p ->> 'goal', ''),
      achievements = nullif(p ->> 'achievements', ''), minutes_link = nullif(p ->> 'minutes_link', ''),
      attendees_extra = coalesce((p ->> 'attendees_extra')::int, 0), updated_at = now()
    where id = m_id
    returning * into m;
    if m is null then
      raise exception 'النشاط ده مش موجود';
    end if;
  end if;

  perform app.begin_internal();
  delete from public.participations where meeting_id = m.id and not (volunteer_id = any (coalesce(p_attendees, '{}')));
  update public.participations set activity_date = m.meeting_date, subject = m.committee, event = m.event,
         place = case when m.meeting_type = 'اونلاين' then 'اونلاين' else 'الفرع' end
   where meeting_id = m.id;
  insert into public.participations (volunteer_id, activity_date, event, subject, place, status, method, meeting_id, created_by, reviewed_by, reviewed_at)
  select a, m.meeting_date, m.event, m.committee, case when m.meeting_type = 'اونلاين' then 'اونلاين' else 'الفرع' end,
         'accepted', 'group', m.id, app.email(), app.email(), now()
    from unnest(coalesce(p_attendees, '{}')) a
   where not exists (select 1 from public.participations x where x.meeting_id = m.id and x.volunteer_id = a)
  on conflict do nothing;
  perform app.end_internal();
  return m.id;
end;
$$;

-- Meetings report: meetings only (family days are counted as events)
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
   where app.can_report() and m.event <> 'يوم عائلي'
     and m.meeting_date >= date_trunc('month', p_month) and m.meeting_date < date_trunc('month', p_month) + interval '1 month'
   order by m.meeting_date, m.created_at
$$;

-- ---------------------------------------------------------------------
-- 3) Calls: how many and how long
-- ---------------------------------------------------------------------
alter table public.participations add column if not exists duration_minutes int check (duration_minutes is null or duration_minutes > 0);
alter table public.lookups drop constraint if exists lookups_form_check;
alter table public.lookups add constraint lookups_form_check check (form is null or form in ('teaching', 'none', 'optional', 'calls'));
update public.lookups set form = 'calls' where list = 'الحدث' and value = 'اتصالات';

-- ---------------------------------------------------------------------
-- 4) Camp, mini camp and graduation party: recorded on the volunteer (camps page),
--    not in the daily follow-up; all three are required before «مسئول»
-- ---------------------------------------------------------------------
alter table public.camps drop constraint if exists camps_kind_check;
alter table public.camps add constraint camps_kind_check check (kind in ('ميني كامب', 'كامب', 'حفلة تخرج'));

alter table public.volunteers
  add column if not exists attended_camp       boolean not null default false,
  add column if not exists camp_date           date,
  add column if not exists attended_graduation boolean not null default false,
  add column if not exists graduation_date     date;

-- No longer picked in the daily check-in
update public.lookups set is_active = false where list = 'الحدث' and value in ('ميني كامب', 'كامب');

create or replace function public.set_camp_attendance(p_camp uuid, p_volunteer uuid, p_attended boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.camps;
  still boolean;
begin
  if not app.has_perm('stages.manage') then
    raise exception 'محتاج صلاحية مراحل التطوع' using errcode = '42501';
  end if;
  select * into c from public.camps where id = p_camp;
  insert into public.camp_registrations (camp_id, volunteer_id, status, attended)
  values (p_camp, p_volunteer, 'confirmed', p_attended)
  on conflict (camp_id, volunteer_id) do update set attended = p_attended,
    status = case when p_attended then 'confirmed' else public.camp_registrations.status end;
  -- still attended another camp of the same kind?
  select exists (select 1 from public.camp_registrations r join public.camps k on k.id = r.camp_id
                  where r.volunteer_id = p_volunteer and r.attended and k.kind = c.kind) into still;
  perform app.begin_internal();
  -- Marking sets the flag and date; unmarking clears them only if this camp set them and no other one counts
  if c.kind = 'ميني كامب' then
    update public.volunteers set
      attended_minicamp = case when p_attended or still then true when minicamp_date = c.camp_date then false else attended_minicamp end,
      minicamp_date     = case when p_attended then c.camp_date when not still and minicamp_date = c.camp_date then null else minicamp_date end
     where id = p_volunteer;
  elsif c.kind = 'كامب' then
    update public.volunteers set
      attended_camp = case when p_attended or still then true when camp_date = c.camp_date then false else attended_camp end,
      camp_date     = case when p_attended then c.camp_date when not still and camp_date = c.camp_date then null else camp_date end
     where id = p_volunteer;
  else
    update public.volunteers set
      attended_graduation = case when p_attended or still then true when graduation_date = c.camp_date then false else attended_graduation end,
      graduation_date     = case when p_attended then c.camp_date when not still and graduation_date = c.camp_date then null else graduation_date end
     where id = p_volunteer;
  end if;
  perform app.end_internal();
end;
$$;

-- Nobody becomes «مسئول» before the mini camp, the camp and the graduation party
create or replace function app.guard_responsible()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  missing text[] := '{}';
begin
  if new.status::text = 'مسئول' and old.status is distinct from new.status and not app.is_internal() then
    if not new.attended_minicamp then missing := missing || 'الميني كامب'::text; end if;
    if not new.attended_camp then missing := missing || 'الكامب'::text; end if;
    if not new.attended_graduation then missing := missing || 'حفلة التخرج'::text; end if;
    if array_length(missing, 1) > 0 then
      raise exception 'مينفعش يبقى «مسئول» قبل ما يحضر: %', array_to_string(missing, ' و') using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists volunteers_guard_responsible on public.volunteers;
create trigger volunteers_guard_responsible before update on public.volunteers
  for each row execute function app.guard_responsible();

-- Invitations by kind: everyone in follow-up who hasn't attended this kind yet
create or replace function app.camp_invitees(p_camp uuid)
returns extensions.citext[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.email), '{}')
    from public.volunteers v, public.camps c
   where c.id = p_camp
     and v.email is not null
     and v.status::text <> 'خارج المتابعة'
     and not case c.kind when 'ميني كامب' then v.attended_minicamp when 'كامب' then v.attended_camp else v.attended_graduation end
     and not exists (select 1 from public.camp_registrations r where r.camp_id = p_camp and r.volunteer_id = v.id and r.status <> 'cancelled')
$$;

create or replace function app.camp_announce()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.registration_open and new.camp_date >= app.today() and (tg_op = 'INSERT' or not old.registration_open) then
    perform app.notify(app.camp_invitees(new.id),
      new.kind || ' يوم ' || to_char(new.camp_date, 'DD/MM'),
      'لسه محضرتش ' || new.kind || '. سجّل مكانك' || coalesce(' · ' || new.capacity || ' مكان', '') || coalesce(' · ' || new.place, ''),
      '/');
  end if;
  return null;
end;
$$;

create or replace function public.remind_camp(p_camp uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.camps;
  who extensions.citext[];
begin
  if not app.has_perm('stages.manage') then
    raise exception 'محتاج صلاحية مراحل التطوع' using errcode = '42501';
  end if;
  select * into c from public.camps where id = p_camp;
  who := app.camp_invitees(p_camp);
  perform app.notify(who, 'تذكير: ' || c.kind || ' يوم ' || to_char(c.camp_date, 'DD/MM'),
    'لسه محضرتش ' || c.kind || '. سجّل مكانك قبل ما الأماكن تخلص' || coalesce(' · ' || c.place, ''), '/');
  return coalesce(array_length(who, 1), 0);
end;
$$;

-- Stages for the camp and the graduation party
alter table public.stages drop constraint if exists stages_source_check;
alter table public.stages add constraint stages_source_check check (source in (
  'registered', 'interview', 'rules', 'joined_group', 'committee_test', 'tshirt', 'minicamp', 'camp', 'graduation',
  'first_activity', 'accepted', 'manual'));
insert into public.stages (key, name, description, source, self_complete, sort_order, is_builtin) values
  ('camp',       'الكامب',       'احضر الكامب',       'camp',       true, 85, true),
  ('graduation', 'حفلة التخرج', 'احضر حفلة التخرج', 'graduation', true, 95, true)
on conflict (key) do nothing;

create or replace function public.volunteer_stages(p_volunteer uuid default null)
returns table (key text, name text, description text, source text, self_complete boolean, sort_order int, done boolean, done_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  vid uuid := coalesce(p_volunteer, app.my_volunteer_id());
  v public.volunteers;
  hr public.volunteer_hr;
  ver int := coalesce((select a.value::int from public.app_settings a where a.key = 'rules_version'), 1);
begin
  select * into v from public.volunteers where id = vid;
  if v is null then
    return;
  end if;
  if not (vid = app.my_volunteer_id() or app.has_perm('volunteers.view_all') or app.has_perm('stages.manage')
          or app.leads(v.main_committee, v.sub_committee)) then
    raise exception 'مش مسموح لك تشوف مراحل المتطوع ده' using errcode = '42501';
  end if;
  select * into hr from public.volunteer_hr where volunteer_id = vid;
  return query
  select s.key, s.name, s.description, s.source, s.self_complete, s.sort_order,
         (d.volunteer_id is not null or case s.source
            when 'registered'     then true
            when 'interview'      then hr.interview_date is not null or hr.acceptance is not null
            when 'rules'          then exists (select 1 from public.rules_acceptances r where r.volunteer_id = vid and r.version = ver)
            when 'joined_group'   then v.joined_group
            when 'committee_test' then v.passed_committee_test
            when 'tshirt'         then v.bought_tshirt
            when 'minicamp'       then v.attended_minicamp
            when 'camp'           then v.attended_camp
            when 'graduation'     then v.attended_graduation
            when 'first_activity' then exists (select 1 from public.participations p where p.volunteer_id = vid and p.status = 'accepted')
            when 'accepted'       then hr.acceptance::text = 'مقبول'
            else false
          end) as done,
         coalesce(d.done_at, case s.source
            when 'registered' then v.registered_at
            when 'minicamp'   then v.minicamp_date::timestamptz
            when 'camp'       then v.camp_date::timestamptz
            when 'graduation' then v.graduation_date::timestamptz
            when 'rules'      then (select r.accepted_at from public.rules_acceptances r where r.volunteer_id = vid and r.version = ver)
            when 'first_activity' then (select min(p.activity_date)::timestamptz from public.participations p where p.volunteer_id = vid and p.status = 'accepted')
          end)
    from public.stages s
    left join public.stage_done d on d.volunteer_id = vid and d.stage_key = s.key
   where s.is_active
   order by s.sort_order, s.name;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Reports: calls = number of calls; camps from the camps page;
--    the sheet sync (service role, through the backup function) may read them
-- ---------------------------------------------------------------------
create or replace function app.can_report()
returns boolean language sql stable set search_path = '' as $$
  select app.has_perm('stats.view') or app.is_internal()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

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
           coalesce(pa.meeting_id::text, pa.event || '|' || coalesce(pa.subject, '') || '|' || coalesce(pa.grade, '') || '|' || coalesce(pa.place, '')) as session
      from public.participations pa
      left join public.lookups l on l.list = 'الحدث' and l.value = pa.event
     where pa.status = 'accepted' and app.can_report() and not app.is_camp(pa.event)
       and pa.activity_date >= date_trunc('month', p_month) and pa.activity_date < date_trunc('month', p_month) + interval '1 month'
  ),
  mt as (
    select meeting_date, string_agg(distinct committee, ' - ') as descr, count(*)::int as n
      from public.meetings
     where app.can_report() and event <> 'يوم عائلي'
       and meeting_date >= date_trunc('month', p_month) and meeting_date < date_trunc('month', p_month) + interval '1 month'
     group by meeting_date
  ),
  cp as (
    select camp_date, count(*)::int as n from public.camps
     where app.can_report() and camp_date >= date_trunc('month', p_month) and camp_date < date_trunc('month', p_month) + interval '1 month'
     group by camp_date
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
    coalesce(max(cp.n), 0)::int,
    string_agg(distinct coalesce(p.subject, p.event), ' - ') filter (where p.col = 'workshop'),
    count(distinct p.session) filter (where p.col = 'workshop')::int,
    count(distinct p.session) filter (where p.col = 'sports')::int,
    count(distinct p.session) filter (where p.col = 'trips')::int,
    count(distinct p.session) filter (where p.col = 'behavior')::int,
    count(distinct p.session) filter (where p.col = 'religious')::int,
    count(distinct p.session) filter (where p.col = 'quran')::int,
    coalesce(sum(coalesce(p.beneficiaries, 1)) filter (where p.col = 'calls'), 0)::int,
    count(distinct p.session) filter (where p.col = 'media')::int,
    string_agg(distinct coalesce(p.subject, p.event), ' - ') filter (where p.col = 'courses'),
    count(distinct p.session) filter (where p.col = 'courses')::int,
    count(distinct p.session) filter (where p.col = 'events')::int,
    string_agg(distinct p.event, ' - ') filter (where p.col = 'other'),
    count(distinct p.session) filter (where p.col = 'other')::int
  from days d
  left join p on p.activity_date = d.day
  left join mt on mt.meeting_date = d.day
  left join cp on cp.camp_date = d.day
  group by d.day
  order by d.day
$$;

-- Check-in keeps the calls' duration too
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
  if not app.has_perm('attendance.register') then
    raise exception 'محتاج صلاحية تسجيل الحضور' using errcode = '42501';
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
      (volunteer_id, activity_date, event, subject, place, grade, beneficiaries, duration_minutes, notes, method, group_activity_id)
    select vid, a_date, p_activity ->> 'event', nullif(p_activity ->> 'subject', ''), nullif(p_activity ->> 'place', ''),
           nullif(p_activity ->> 'grade', ''), nullif(p_activity ->> 'beneficiaries', '')::int,
           nullif(p_activity ->> 'duration_minutes', '')::int,
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

-- The interviewer volunteer is visible to everyone who reads interview data
create or replace view public.volunteer_hr_read
with (security_barrier = true)
as
select h.volunteer_id, h.acceptance, h.interview_date, h.interviewer,
       case when (select app.has_perm('hr.notes')) then h.hr_notes end as hr_notes,
       h.status_changed_at, h.interviewer_id
from public.volunteer_hr h
where (select app.has_perm('hr.view'));

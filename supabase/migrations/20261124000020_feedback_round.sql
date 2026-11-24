-- =====================================================================
-- 20) Feedback round
--   * check-in: the last 6 days only (volunteers too, still waiting for approval)
--   * a meeting / family day recorded from the check-in becomes a meeting row
--     (so it shows on the meetings page and the meetings sheet); old ones backfilled
--   * evaluation sheet: any exam counts (split by stage of the grade, unknown → second column)
--   * 3 months in «اختبار» → the committee leaders are told (once); no auto-acceptance
--   * graduation party attended (with the mini camp and the camp) → «مسئول» automatically
--   * camp only for «مشروع مسئول»; graduation party only for those who attended the camp
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Six days
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

  if new.activity_date > app.today() then
    raise exception 'مينفعش تسجّل يوم لسه مجاش' using errcode = '42501';
  end if;

  if app.has_perm('attendance.register') then
    if not app.has_perm('attendance.any_date') and new.activity_date < app.today() - 6 then
      raise exception 'تقدر تسجّل آخر 6 أيام بس' using errcode = '42501';
    end if;
    new.status := 'accepted';
    new.reviewed_by := app.email();
    new.reviewed_at := now();
  else
    if new.volunteer_id is distinct from app.my_volunteer_id() then
      raise exception 'تقدر تسجّل حضورك إنت بس' using errcode = '42501';
    end if;
    if new.activity_date < app.today() - 6 then
      raise exception 'تقدر تسجّل آخر 6 أيام بس' using errcode = '42501';
    end if;
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

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
  if not (app.has_perm('attendance.any_date') or app.is_internal())
     and (new.volunteer_id is distinct from old.volunteer_id
          or new.activity_date < app.today() - 6) then
    raise exception 'تقدر تعدّل آخر 6 أيام بس' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy participations_insert on public.participations;
create policy participations_insert on public.participations for insert to authenticated
  with check (
    (select app.has_perm('attendance.register'))
    or (volunteer_id = (select app.my_volunteer_id())
        and activity_date between (select app.today()) - 6 and (select app.today()))
  );

drop policy participations_update on public.participations;
create policy participations_update on public.participations for update to authenticated
  using (
    (select app.has_perm('attendance.review'))
    and ((select app.has_perm('attendance.any_date')) or activity_date >= (select app.today()) - 6)
  );

-- ---------------------------------------------------------------------
-- 2) Meetings and family days from the check-in
-- ---------------------------------------------------------------------
create or replace function app.is_meeting_event(p_event text)
returns boolean language sql stable set search_path = '' as $$
  select p_event = 'يوم عائلي'
      or exists (select 1 from public.lookups l where l.list = 'الحدث' and l.value = p_event and l.report_column = 'meetings')
$$;

create or replace function app.participation_meeting()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  com text := coalesce(nullif(btrim(new.subject), ''), 'عام');
  mtype text := case when new.place = 'اونلاين' then 'اونلاين' else 'الفرع' end;
  mid uuid;
begin
  if new.meeting_id is not null or not app.is_meeting_event(new.event) then
    return new;
  end if;
  select id into mid from public.meetings
   where meeting_date = new.activity_date and event = new.event and committee = com
   order by created_at limit 1;
  if mid is null then
    insert into public.meetings (event, meeting_date, committee, meeting_type, goal, created_by)
    values (new.event, new.activity_date, com, mtype, nullif(new.notes, ''), coalesce(app.email()::text, new.created_by::text))
    returning id into mid;
  end if;
  new.meeting_id := mid;
  return new;
end;
$$;
drop trigger if exists participations_meeting on public.participations;
create trigger participations_meeting before insert on public.participations
  for each row execute function app.participation_meeting();

-- Backfill: group the old check-in rows into meetings
do $$
declare
  r record;
  mid uuid;
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in
    select activity_date, event, coalesce(nullif(btrim(subject), ''), 'عام') as com,
           bool_or(place = 'اونلاين') as online, min(created_by::text) as who, max(notes) as notes
      from public.participations
     where meeting_id is null and app.is_meeting_event(event)
     group by 1, 2, 3
  loop
    select id into mid from public.meetings where meeting_date = r.activity_date and event = r.event and committee = r.com limit 1;
    if mid is null then
      insert into public.meetings (event, meeting_date, committee, meeting_type, goal, created_by)
      values (r.event, r.activity_date, r.com, case when r.online then 'اونلاين' else 'الفرع' end, nullif(r.notes, ''), r.who)
      returning id into mid;
    end if;
    update public.participations set meeting_id = mid
     where meeting_id is null and activity_date = r.activity_date and event = r.event
       and coalesce(nullif(btrim(subject), ''), 'عام') = r.com;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Evaluation sheet: any exam
-- ---------------------------------------------------------------------
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
    select pa.*,
           case when pa.event like '%امتحان%' then 'exam' else coalesce(l.report_column, 'other') end as col,
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
    count(distinct p.session) filter (where p.col = 'exam' and coalesce(p.grade, '') ~ '(^|[^0-9])[1-6] ?ب|ابتدائ')::int,
    count(distinct p.session) filter (where p.col = 'exam' and not coalesce(p.grade, '') ~ '(^|[^0-9])[1-6] ?ب|ابتدائ')::int,
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

-- ---------------------------------------------------------------------
-- 4) Three months in «اختبار» → tell the committee leaders (once per volunteer)
-- ---------------------------------------------------------------------
alter table public.volunteer_hr add column if not exists test_alerted_at timestamptz;

create or replace function app.test_since(h public.volunteer_hr, v public.volunteers)
returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(h.status_changed_at, h.interview_date::timestamptz, v.registered_at)
$$;

create or replace function app.alert_committee_tests()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  sent int := 0;
  r record;
begin
  for r in
    select cl.email, count(distinct v.id) as n
      from public.volunteer_hr h
      join public.volunteers v on v.id = h.volunteer_id
      join public.committee_leaders cl on cl.committee in (v.main_committee, v.sub_committee)
     where h.acceptance::text = 'اختبار' and h.test_alerted_at is null
       and v.status::text <> 'خارج المتابعة'
       and app.test_since(h, v) < now() - interval '3 months'
     group by cl.email
  loop
    perform app.notify(array[r.email]::extensions.citext[],
      'اختبار اللجنة',
      r.n || ' متطوع عدّى عليهم 3 شهور في «اختبار». محتاجين قرار: مقبول ولا لأ',
      '/');
    sent := sent + 1;
  end loop;
  perform set_config('app.skip_audit', 'on', true);
  update public.volunteer_hr h set test_alerted_at = now()
    from public.volunteers v
   where v.id = h.volunteer_id and h.acceptance::text = 'اختبار' and h.test_alerted_at is null
     and app.test_since(h, v) < now() - interval '3 months';
  return sent;
end;
$$;
revoke all on function app.alert_committee_tests() from public, anon, authenticated;

-- New result → may be alerted again next time
create or replace function app.reset_test_alert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.acceptance is distinct from old.acceptance then
    new.test_alerted_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists volunteer_hr_reset_test_alert on public.volunteer_hr;
create trigger volunteer_hr_reset_test_alert before update on public.volunteer_hr
  for each row execute function app.reset_test_alert();

-- The list for the home page: the leader's committees, or everyone for HR
create or replace function public.test_overdue()
returns table (id uuid, code text, full_name_ar text, committee text, since date)
language sql stable security definer
set search_path = ''
as $$
  select v.id, v.code, v.full_name_ar, coalesce(v.sub_committee, v.main_committee), app.test_since(h, v)::date
    from public.volunteer_hr h
    join public.volunteers v on v.id = h.volunteer_id
   where h.acceptance::text = 'اختبار'
     and v.status::text <> 'خارج المتابعة'
     and app.test_since(h, v) < now() - interval '3 months'
     and (app.has_perm('hr.view') or app.leads(v.main_committee, v.sub_committee))
   order by 5
$$;
revoke all on function public.test_overdue() from public, anon;
grant execute on function public.test_overdue() to authenticated;

-- The daily job no longer accepts people by itself
create or replace function app.run_daily_jobs()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  moved_out int;
begin
  perform app.begin_internal();
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
  perform app.end_internal();
  return jsonb_build_object('moved_out', moved_out);
end;
$$;
revoke execute on function app.run_daily_jobs() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'committee-test-alert';
select cron.schedule('committee-test-alert', '0 6 * * *', $$select app.alert_committee_tests()$$);

-- ---------------------------------------------------------------------
-- 5) Graduation party → «مسئول»
-- ---------------------------------------------------------------------
create or replace function app.status_at(i int)
returns public.volunteer_status language sql stable set search_path = '' as $$
  select (enum_range(null::public.volunteer_status))[i]
$$;

create or replace function app.graduate()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- enum order: تحت المتابعة, مشروع مسئول, مسئول, مدرب, خارج المتابعة (names can be renamed, the order stays)
  if new.attended_graduation and new.attended_camp and new.attended_minicamp
     and not (old.attended_graduation and old.attended_camp and old.attended_minicamp)
     and new.status in (app.status_at(1), app.status_at(2), app.status_at(5)) then
    new.status := app.status_at(3);
  end if;
  return new;
end;
$$;
drop trigger if exists volunteers_graduate on public.volunteers;
create trigger volunteers_graduate before update on public.volunteers
  for each row execute function app.graduate();

-- ---------------------------------------------------------------------
-- 6) Who each kind is for
-- ---------------------------------------------------------------------
create or replace function app.camp_eligible(v public.volunteers, p_kind text)
returns boolean language sql stable set search_path = '' as $$
  select v.status <> app.status_at(5) and case p_kind
    when 'ميني كامب' then not v.attended_minicamp
    when 'كامب'      then not v.attended_camp and v.status = app.status_at(2)
    else not v.attended_graduation and v.attended_camp
  end
$$;

create or replace function app.camp_invitees(p_camp uuid)
returns extensions.citext[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.email), '{}')
    from public.volunteers v, public.camps c
   where c.id = p_camp
     and v.email is not null
     and app.camp_eligible(v, c.kind)
     and not exists (select 1 from public.camp_registrations r where r.camp_id = p_camp and r.volunteer_id = v.id and r.status <> 'cancelled')
$$;

create or replace function app.camp_registration_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v public.volunteers;
  k text;
begin
  if app.is_internal() or app.has_perm('stages.manage') or new.status = 'cancelled' then
    return new;
  end if;
  select * into v from public.volunteers where id = new.volunteer_id;
  select kind into k from public.camps where id = new.camp_id;
  if not app.camp_eligible(v, k) then
    raise exception '%', case k
      when 'كامب' then 'الكامب لـ «مشروع مسئول» بس'
      when 'حفلة تخرج' then 'حفلة التخرج للي حضر الكامب بس'
      else 'إنت حضرت الميني كامب قبل كده' end using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists camp_registrations_guard on public.camp_registrations;
create trigger camp_registrations_guard before insert or update on public.camp_registrations
  for each row execute function app.camp_registration_guard();

-- The coming dates I can sign up for, with seats and my place — one call
create or replace function public.my_camps()
returns table (id uuid, kind text, title text, camp_date date, end_date date, place text, capacity int, notes text,
               registration_open boolean, confirmed int, waitlist int, my_status text)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.kind, c.title, c.camp_date, c.end_date, c.place, c.capacity, c.notes, c.registration_open,
         (select count(*) from public.camp_registrations r where r.camp_id = c.id and r.status = 'confirmed')::int,
         (select count(*) from public.camp_registrations r where r.camp_id = c.id and r.status = 'waitlist')::int,
         (select r.status from public.camp_registrations r where r.camp_id = c.id and r.volunteer_id = v.id)
    from public.camps c
    join public.volunteers v on v.id = app.my_volunteer_id()
   where c.camp_date >= app.today()
     and (app.camp_eligible(v, c.kind)
          or exists (select 1 from public.camp_registrations r where r.camp_id = c.id and r.volunteer_id = v.id and r.status <> 'cancelled'))
   order by c.camp_date
$$;
revoke all on function public.my_camps() from public, anon;
grant execute on function public.my_camps() to authenticated;

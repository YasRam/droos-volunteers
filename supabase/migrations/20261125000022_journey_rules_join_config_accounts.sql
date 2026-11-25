-- =====================================================================
-- 22) The volunteer journey as rules, editable join form, committee roles,
--     first sign-in without Google
--
-- The journey (it can't be skipped or broken):
--   تحت المتابعة → الميني كامب → مشروع مسئول → الكامب → حفلة التخرج → مسئول
--   * «مشروع مسئول» needs the mini camp
--   * the camp needs the mini camp and «مشروع مسئول» (or later)
--   * the graduation party needs the camp
--   * «مسئول» needs all three (and comes by itself after the graduation party)
--   * a step can't be taken back while a later one depends on it
-- «خارج المتابعة» can happen at any point. «مدرب» is outside the journey.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Journey rules
-- ---------------------------------------------------------------------
create or replace function app.guard_journey()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s1 public.volunteer_status := app.status_at(1);   -- تحت المتابعة
  s2 public.volunteer_status := app.status_at(2);   -- مشروع مسئول
  s3 public.volunteer_status := app.status_at(3);   -- مسئول
begin
  -- only what changed is checked, so older records that break the rules can still be edited elsewhere
  if new.status is distinct from old.status then
    if new.status = s2 and not new.attended_minicamp then
      raise exception 'مينفعش يبقى «%» قبل ما يحضر الميني كامب', s2 using errcode = '23514', constraint = 'journey';
    end if;
    if new.status = s3 and not (new.attended_minicamp and new.attended_camp and new.attended_graduation) then
      raise exception 'مينفعش يبقى «%» قبل الميني كامب والكامب وحفلة التخرج', s3 using errcode = '23514', constraint = 'journey';
    end if;
  end if;
  if new.attended_camp and not old.attended_camp then
    if not new.attended_minicamp then
      raise exception 'مينفعش يحضر الكامب قبل الميني كامب' using errcode = '23514', constraint = 'journey';
    end if;
    if new.status in (s1) then
      raise exception 'الكامب لـ «%» بس', s2 using errcode = '23514', constraint = 'journey';
    end if;
  end if;
  if new.attended_graduation and not old.attended_graduation and not new.attended_camp then
    raise exception 'مينفعش يحضر حفلة التخرج قبل الكامب' using errcode = '23514', constraint = 'journey';
  end if;
  -- taking a step back
  if old.attended_minicamp and not new.attended_minicamp and (new.attended_camp or new.status in (s2, s3)) then
    raise exception 'مينفعش تشيل الميني كامب وهو «%» أو حضر الكامب', new.status using errcode = '23514', constraint = 'journey';
  end if;
  if old.attended_camp and not new.attended_camp and (new.attended_graduation or new.status = s3) then
    raise exception 'مينفعش تشيل الكامب وهو حضر حفلة التخرج أو «%»', s3 using errcode = '23514', constraint = 'journey';
  end if;
  if old.attended_graduation and not new.attended_graduation and new.status = s3 then
    raise exception 'مينفعش تشيل حفلة التخرج وهو «%»', s3 using errcode = '23514', constraint = 'journey';
  end if;
  return new;
end;
$$;
-- runs after the graduation promotion (volunteers_graduate) and replaces the older «مسئول» check
drop trigger if exists volunteers_guard_responsible on public.volunteers;
drop trigger if exists volunteers_journey on public.volunteers;
create trigger volunteers_journey before update on public.volunteers
  for each row execute function app.guard_journey();

-- The graduation party makes them «مسئول» (all three are guaranteed by the rules above)
create or replace function app.graduate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.attended_graduation and not old.attended_graduation
     and new.attended_minicamp and new.attended_camp
     and new.status in (app.status_at(1), app.status_at(2), app.status_at(5)) then
    new.status := app.status_at(3);
  end if;
  return new;
end;
$$;

-- People whose records break the journey today, for a one-time clean-up
create or replace function public.journey_problems()
returns table (id uuid, code text, full_name_ar text, status text, problem text)
language sql stable security definer
set search_path = ''
as $$
  select v.id, v.code, v.full_name_ar, v.status::text, p.problem
    from public.volunteers v
    cross join lateral (values
      (case when v.status = app.status_at(2) and not v.attended_minicamp then 'مشروع مسئول من غير الميني كامب' end),
      (case when v.status = app.status_at(3) and not (v.attended_minicamp and v.attended_camp and v.attended_graduation) then 'مسئول وناقصه ميني كامب أو كامب أو تخرج' end),
      (case when v.attended_camp and not v.attended_minicamp then 'حضر الكامب من غير الميني كامب' end),
      (case when v.attended_graduation and not v.attended_camp then 'حضر التخرج من غير الكامب' end)
    ) as p(problem)
   where p.problem is not null and app.has_perm('stages.manage')
   order by v.full_name_ar
$$;
revoke all on function public.journey_problems() from public, anon;
grant execute on function public.journey_problems() to authenticated;

-- ---------------------------------------------------------------------
-- 2) No reminder for a date that has passed
-- ---------------------------------------------------------------------
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
  if coalesce(c.end_date, c.camp_date) < app.today() then
    raise exception 'الميعاد ده عدّى، مفيش تذكير' using errcode = '22023';
  end if;
  who := app.camp_invitees(p_camp);
  perform app.notify(who, 'تذكير: ' || c.kind || ' يوم ' || to_char(c.camp_date, 'DD/MM'),
    'لسه محضرتش ' || c.kind || '. سجّل مكانك قبل ما الأماكن تخلص' || coalesce(' · ' || c.place, ''), '/');
  return coalesce(array_length(who, 1), 0);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Interviews no longer add «مقابلة فلان» to the event-type list
-- ---------------------------------------------------------------------
create or replace function app.remember_event_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- automatic records (interviews) carry generated text: not a suggestion for anyone
  if new.auto_ref is not null or new.event = 'انترفيو' then
    return new;
  end if;
  if new.status = 'accepted' and nullif(btrim(new.subject), '') is not null then
    insert into public.lookups (list, value, parent, sort_order)
    select 'نوع الحدث', part, new.event,
           coalesce((select max(sort_order) + 1 from public.lookups where list = 'نوع الحدث'), 0)
    from (select distinct btrim(x) as part from unnest(string_to_array(new.subject, '،')) x) s
    where s.part <> ''
    on conflict on constraint lookups_unique do nothing;
  end if;
  return new;
end;
$$;
update public.lookups set is_active = false
 where list = 'نوع الحدث' and (value like 'مقابلة %' or parent = 'انترفيو');

-- ---------------------------------------------------------------------
-- 4) Committee leaders and deputies get permissions you can edit, like any type
-- ---------------------------------------------------------------------
insert into public.roles (key, name, description, permissions, is_builtin, sort_order) values
  ('committee_leader', 'ليدر لجنة', 'بتتطبق لوحدها على كل ليدر لجنة (فوق اللي بيعمله على لجنته)', '{}', true, 60),
  ('committee_deputy', 'نائب ليدر لجنة', 'بتتطبق لوحدها على كل نائب ليدر لجنة (فوق اللي بيعمله على لجنته)', '{}', true, 61)
on conflict (key) do nothing;

create or replace function app.my_permissions()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}')
  from (
    select s.role as key from public.staff_roles s where s.email = app.email()
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
    select s.email as e from public.staff_roles s join public.roles r on r.key = s.role where p = any (r.permissions)
    union
    select cl.email from public.committee_leaders cl
      join public.roles r on r.key = case when cl.role = 'نائب' then 'committee_deputy' else 'committee_leader' end
     where p = any (r.permissions)
  ) x
$$;

-- ---------------------------------------------------------------------
-- 5) The join form: texts, WhatsApp group and which fields show — editable from the site
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('join_form', jsonb_build_object(
  'title', 'التطوع في نشاط دروس التقوية',
  'intro', 'املا بياناتك وفريق الـ HR هيتواصل معاك. لو اتسجلت قبل كده ابعت بياناتك الجديدة عادي.',
  'success_title', 'بياناتك وصلت 🎉',
  'success_message', 'فريق الـ HR هيتواصل معاك على رقمك عشان نحدد ميعاد المقابلة. ادخل جروب الواتساب عشان توصلك أخبار النشاط.',
  'whatsapp_link', '',
  'fields', jsonb_build_object(
    'whatsapp', 'optional', 'email', 'optional', 'full_name_en', 'optional', 'study_year', 'optional',
    'qualification', 'optional', 'job', 'optional', 'area', 'optional', 'referral_source', 'optional',
    'facebook', 'optional', 'availability_notes', 'optional'))::text)
on conflict (key) do nothing;

-- anyone (no account) reads the form's setup
create or replace function public.join_form()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select value::jsonb from public.app_settings where key = 'join_form'), '{}'::jsonb)
$$;
revoke all on function public.join_form() from public;
grant execute on function public.join_form() to anon, authenticated;

-- join_activity: the fields marked «required» in the setup are required on the server too
create or replace function app.join_required(p jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  f record;
  label jsonb := '{"whatsapp":"رقم الواتساب","email":"الإيميل","full_name_en":"الاسم بالإنجليزي","study_year":"الكلية والسنة الدراسية","qualification":"المؤهل","job":"الشغل","area":"المنطقة","referral_source":"عرفت النشاط منين","facebook":"لينك الفيسبوك","availability_notes":"المواعيد اللي تناسبك"}';
begin
  for f in select key, value #>> '{}' as mode from jsonb_each(coalesce(public.join_form()->'fields', '{}')) loop
    if f.mode = 'required' and nullif(btrim(coalesce(p->>f.key, '')), '') is null then
      raise exception 'خانة «%» مطلوبة', coalesce(label->>f.key, f.key) using errcode = '22023';
    end if;
  end loop;
end;
$$;

do $$
declare
  src text;
begin
  -- add the required-fields check at the start of join_activity (after the robot trap)
  select pg_get_functiondef('public.join_activity(jsonb)'::regprocedure) into src;
  if position('app.join_required' in src) = 0 then
    src := replace(src, 'if nid !~ ''^[23][0-9]{13}$'' then', 'perform app.join_required(p);
  if nid !~ ''^[23][0-9]{13}$'' then');
    execute src;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6) The request card: who this person is to us, not just old vs new
-- ---------------------------------------------------------------------
drop function if exists public.registration_requests_list(text);
create or replace function public.registration_requests_list(p_status text default 'pending')
returns table (id uuid, created_at timestamptz, volunteer_id uuid, code text, data jsonb, prev_data jsonb,
               status text, volunteer_status text, acceptance text, recruit_status text, out_reason text,
               hr_notes text, interview_date date, follow_notes text[], participations int, last_activity date,
               registered_at timestamptz, history jsonb, earlier_requests int)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.created_at, r.volunteer_id, v.code, r.data, r.prev_data, r.status,
         v.status::text, h.acceptance::text, v.recruit_status, v.out_reason,
         case when app.has_perm('hr.notes') then h.hr_notes end,
         h.interview_date,
         array_remove(array[v.follow_notes_1, v.follow_notes_2, v.follow_notes_3], null),
         (select count(*) from public.participations pa where pa.volunteer_id = v.id and pa.status = 'accepted')::int,
         (select max(activity_date) from public.participations pa where pa.volunteer_id = v.id and pa.status = 'accepted'),
         v.registered_at,
         (select coalesce(jsonb_agg(jsonb_build_object('at', x.created_at, 'kind', x.kind, 'outcome', x.outcome, 'notes', x.notes) order by x.created_at desc), '[]')
            from (select * from public.recruit_log l where l.volunteer_id = v.id order by created_at desc limit 5) x),
         (select count(*) from public.registration_requests e where e.volunteer_id = v.id and e.id <> r.id)::int
    from public.registration_requests r
    join public.volunteers v on v.id = r.volunteer_id
    left join public.volunteer_hr h on h.volunteer_id = v.id
   where app.has_perm('hr.view') and r.status = p_status
   order by r.created_at desc
   limit 300
$$;
revoke all on function public.registration_requests_list(text) from public, anon;
grant execute on function public.registration_requests_list(text) to authenticated;

-- ---------------------------------------------------------------------
-- 7) First sign-in without Google (used by the «account» edge function only)
-- ---------------------------------------------------------------------
create table if not exists public.account_attempts (
  at     timestamptz not null default now(),
  email  extensions.citext not null,
  ok     boolean not null
);
alter table public.account_attempts enable row level security;
revoke all on public.account_attempts from anon, authenticated;

-- Does this email + national ID + phone belong to one volunteer? (service role only)
create or replace function public.account_check(p_email text, p_nid text, p_phone text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v record;
  fails int;
begin
  select count(*) into fails from public.account_attempts
   where email = lower(p_email) and not ok and at > now() - interval '1 hour';
  if fails >= 5 or (select count(*) from public.account_attempts where not ok and at > now() - interval '1 hour') >= 50 then
    return jsonb_build_object('ok', false, 'error', 'محاولات كتير، جرّب بعد ساعة');
  end if;
  select vo.id, vo.full_name_ar, vo.status::text as status into v
    from public.volunteers vo join public.volunteer_private p on p.volunteer_id = vo.id
   where lower(vo.email) = lower(p_email) and p.national_id = btrim(p_nid)
     and regexp_replace(coalesce(vo.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  insert into public.account_attempts (email, ok) values (lower(p_email), v.id is not null);
  if v.id is null then
    return jsonb_build_object('ok', false, 'error', 'البيانات دي مش متطابقة مع اللي عندنا. اتأكد من الإيميل والرقم القومي والموبايل');
  end if;
  return jsonb_build_object('ok', true, 'volunteer_id', v.id,
    'user_id', (select u.id from auth.users u where lower(u.email) = lower(p_email) limit 1),
    -- people with permissions keep Google (or a password set from inside): no reset by personal data
    'staff', exists (select 1 from public.staff_roles s where lower(s.email) = lower(p_email))
             or exists (select 1 from public.committee_leaders c where lower(c.email) = lower(p_email)));
end;
$$;
revoke all on function public.account_check(text, text, text) from public, anon, authenticated;
grant execute on function public.account_check(text, text, text) to service_role;

-- HR sets a temporary password for a volunteer: who it is and whether the caller may (service role only)
create or replace function public.account_target(p_caller text, p_volunteer uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with caller as (
    select array_agg(distinct p) as perms
      from public.staff_roles s join public.roles r on r.key = s.role
      cross join lateral unnest(r.permissions) p
     where lower(s.email) = lower(p_caller)
  )
  select jsonb_build_object(
    'email', v.email,
    'name', v.full_name_ar,
    'allowed', coalesce('hr.edit' = any (c.perms) or 'roles.manage' = any (c.perms), false),
    'staff', exists (select 1 from public.staff_roles s where lower(s.email) = lower(v.email)),
    'caller_manages_roles', coalesce('roles.manage' = any (c.perms), false),
    'user_id', (select u.id from auth.users u where lower(u.email) = lower(v.email) limit 1))
  from public.volunteers v, caller c
  where v.id = p_volunteer
$$;
revoke all on function public.account_target(text, uuid) from public, anon, authenticated;
grant execute on function public.account_target(text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 8) Backups: the tables added since the backup was built were missing
--    (order = restore order: parents before children)
-- ---------------------------------------------------------------------
create or replace function app.backup_tables()
returns text[] language sql immutable as $$
  select array['app_settings', 'lookups', 'roles', 'volunteers', 'volunteer_private', 'volunteer_hr', 'staff_roles',
               'committee_leaders', 'group_activities', 'meetings', 'participations', 'meeting_photos', 'schedule_slots',
               'certificate_requests', 'stages', 'stage_done', 'rules_acceptances', 'tshirt_requests', 'camps',
               'camp_registrations', 'recruit_log', 'registration_requests', 'notifications', 'audit_log']
$$;

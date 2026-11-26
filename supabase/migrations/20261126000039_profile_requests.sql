-- «بياناتي» becomes a page to read. A volunteer changes his own data (and his photo) by sending a
-- request; HR (hr.edit) or whoever edits volunteers (volunteers.edit) accepts or refuses it.
--
--  * public.profile_requests: one open request per volunteer (sending again replaces it).
--  * submit_profile_request(changes, photo_path) / review_profile_request(id, approve, note).
--  * The volunteer can no longer change his personal fields or his photo directly; HR (hr.edit)
--    and volunteers.edit still can, and every change stays in the log. Accepting a request applies it.
--  * Fix: camp / graduation and recruitment fields had no guard, so a volunteer could mark himself
--    as having attended the camp or the graduation (which also moves his status). Now only
--    stages.manage / camps.manage / his committee leader (camps) and HR / recruitment can.

create table if not exists public.profile_requests (
  id            uuid primary key default extensions.gen_random_uuid(),
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  changes       jsonb not null default '{}',
  old_values    jsonb not null default '{}',
  photo_path    text,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  note          text,
  created_at    timestamptz not null default now(),
  reviewed_by   text,
  reviewed_at   timestamptz
);
create unique index if not exists profile_requests_one_open on public.profile_requests (volunteer_id) where status = 'pending';
create index if not exists profile_requests_status_idx on public.profile_requests (status, created_at desc);
alter table public.profile_requests enable row level security;
grant select on public.profile_requests to authenticated;
grant all on public.profile_requests to service_role;
create policy profile_requests_read on public.profile_requests for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('hr.edit')) or (select app.has_perm('volunteers.edit')));

-- The fields a volunteer may ask to change
create or replace function app.profile_fields()
returns text[] language sql immutable set search_path = '' as $$
  select array['full_name_ar', 'full_name_en', 'phone', 'whatsapp', 'email', 'qualification', 'area', 'study_year']
$$;

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.guard_volunteer_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  full_access boolean := app.has_perm('volunteers.edit') or app.is_internal();
  is_leader   boolean := app.leads(old.main_committee, old.sub_committee);
  applying    boolean := coalesce(current_setting('app.profile_apply', true), '') = 'on';
begin
  if full_access then
    return new;
  end if;

  if new.code is distinct from old.code
     or new.registered_at is distinct from old.registered_at
     or new.birth_date is distinct from old.birth_date
     or new.gender is distinct from old.gender then
    raise exception 'الحقل ده بيتحسب تلقائي ومينفعش يتعدّل' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     or new.main_committee is distinct from old.main_committee
     or new.sub_committee is distinct from old.sub_committee then
    raise exception 'الحالة واللجان بيعدّلها اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
  end if;

  if not applying and not app.has_perm('hr.edit') and (
       new.full_name_ar is distinct from old.full_name_ar
    or new.full_name_en is distinct from old.full_name_en
    or new.phone is distinct from old.phone
    or new.whatsapp is distinct from old.whatsapp
    or new.email is distinct from old.email
    or new.qualification is distinct from old.qualification
    or new.job is distinct from old.job
    or new.area is distinct from old.area
    or new.availability_notes is distinct from old.availability_notes
    or new.referral_source is distinct from old.referral_source
    or new.facebook is distinct from old.facebook
    or new.study_year is distinct from old.study_year) then
    raise exception 'البيانات الشخصية بتتعدّل بطلب من «بياناتي» والـ HR بيراجعه' using errcode = '42501';
  end if;

  if not is_leader and (
       new.contacted is distinct from old.contacted
    or new.passed_committee_test is distinct from old.passed_committee_test
    or new.joined_group is distinct from old.joined_group
    or new.is_active is distinct from old.is_active
    or new.bought_tshirt is distinct from old.bought_tshirt
    or new.attended_minicamp is distinct from old.attended_minicamp
    or new.minicamp_date is distinct from old.minicamp_date) then
    raise exception 'بيانات اللجنة يعدّلها ليدر اللجنة أو اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
  end if;

  if not (is_leader or app.has_perm('stages.manage') or app.has_perm('camps.manage')) and (
       new.attended_camp is distinct from old.attended_camp
    or new.camp_date is distinct from old.camp_date
    or new.attended_graduation is distinct from old.attended_graduation
    or new.graduation_date is distinct from old.graduation_date) then
    raise exception 'الكامب وحفلة التخرج بيتسجلوا من «مراحل التطوع»' using errcode = '42501';
  end if;

  if not (app.has_perm('hr.edit') or app.has_perm('hr.view') or app.has_perm('recruit.manage')) and (
       new.recruit_status is distinct from old.recruit_status
    or new.interview_at is distinct from old.interview_at) then
    raise exception 'بيانات المقابلة بيعدّلها الـ HR' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function app.guard_volunteer_followup()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  full_access boolean := app.has_perm('volunteers.edit') or app.is_internal();
  is_leader   boolean := app.leads(old.main_committee, old.sub_committee);
begin
  if full_access then
    return new;
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

-- The photo: staff directly, the volunteer by request
create or replace function public.set_photo(p_volunteer uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (app.has_perm('hr.edit') or app.has_perm('volunteers.edit')) then
    raise exception 'صورتك بتتغير بطلب من «بياناتي» والـ HR بيراجعه' using errcode = '42501';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_volunteer::text then
    raise exception 'مكان الصورة غلط' using errcode = '22023';
  end if;
  insert into public.volunteer_private (volunteer_id, photo_path) values (p_volunteer, p_path)
  on conflict (volunteer_id) do update set photo_path = excluded.photo_path;
end;
$$;

-- ---------------------------------------------------------------------
-- Send / review
-- ---------------------------------------------------------------------
create or replace function public.submit_profile_request(p_changes jsonb, p_photo text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  vid uuid := app.my_volunteer_id();
  cur jsonb;
  clean jsonb := '{}';
  k text;
  val text;
  rid uuid;
  who text;
begin
  if vid is null then
    raise exception 'الحساب ده مش مربوط بمتطوع' using errcode = '42501';
  end if;
  select to_jsonb(v) into cur from public.volunteers v where v.id = vid;
  for k in select jsonb_object_keys(coalesce(p_changes, '{}')) loop
    if not (k = any (app.profile_fields())) then
      continue;
    end if;
    val := nullif(btrim(coalesce(p_changes->>k, '')), '');
    if k = 'email' then val := lower(val); end if;
    if k in ('phone', 'whatsapp') and val is not null and val !~ '^01[0125][0-9]{8}$' then
      raise exception 'رقم التليفون لازم يكون 11 رقم ويبدأ بـ 01' using errcode = '22023';
    end if;
    if k = 'email' and val is not null and val !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'الإيميل مش صحيح' using errcode = '22023';
    end if;
    if k in ('full_name_ar', 'phone') and val is null then
      raise exception 'الاسم والتليفون مينفعش يبقوا فاضيين' using errcode = '22023';
    end if;
    if val is distinct from (cur->>k) then
      clean := clean || jsonb_build_object(k, val);
    end if;
  end loop;
  if p_photo is not null and split_part(p_photo, '/', 1) <> vid::text then
    raise exception 'مكان الصورة غلط' using errcode = '22023';
  end if;
  if clean = '{}' and p_photo is null then
    raise exception 'مفيش حاجة اتغيرت' using errcode = '22023';
  end if;

  delete from public.profile_requests where volunteer_id = vid and status = 'pending';
  insert into public.profile_requests (volunteer_id, changes, old_values, photo_path)
  values (vid, clean,
          (select coalesce(jsonb_object_agg(x, cur->x), '{}') from jsonb_object_keys(clean) x),
          p_photo)
  returning id into rid;

  who := cur->>'full_name_ar';
  perform app.notify(
    (select coalesce(array_agg(distinct e), '{}') from unnest(app.emails_with('hr.edit') || app.emails_with('volunteers.edit')) e),
    'طلب تعديل بيانات',
    who || ' عايز يعدّل ' || case when clean <> '{}' and p_photo is not null then 'بياناته وصورته'
                                   when p_photo is not null then 'صورته' else 'بياناته' end,
    '/requests?tab=profiles');
  return rid;
end;
$$;

create or replace function public.review_profile_request(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.profile_requests;
  c jsonb;
  email_to text;
begin
  if not (app.has_perm('hr.edit') or app.has_perm('volunteers.edit')) then
    raise exception 'محتاج صلاحية تعديل بيانات المقابلة أو تعديل المتطوعين' using errcode = '42501';
  end if;
  select * into r from public.profile_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then
    raise exception 'الطلب ده اتراجع خلاص أو مش موجود';
  end if;
  c := r.changes;

  if p_approve then
    perform set_config('app.profile_apply', 'on', true);
    update public.volunteers v set
      full_name_ar  = case when c ? 'full_name_ar'  then c->>'full_name_ar'  else v.full_name_ar end,
      full_name_en  = case when c ? 'full_name_en'  then c->>'full_name_en'  else v.full_name_en end,
      phone         = case when c ? 'phone'         then c->>'phone'         else v.phone end,
      whatsapp      = case when c ? 'whatsapp'      then c->>'whatsapp'      else v.whatsapp end,
      email         = case when c ? 'email'         then (c->>'email')::extensions.citext else v.email end,
      qualification = case when c ? 'qualification' then c->>'qualification' else v.qualification end,
      area          = case when c ? 'area'          then c->>'area'          else v.area end,
      study_year    = case when c ? 'study_year'    then c->>'study_year'    else v.study_year end
    where v.id = r.volunteer_id;
    perform set_config('app.profile_apply', 'off', true);
    if r.photo_path is not null then
      insert into public.volunteer_private (volunteer_id, photo_path) values (r.volunteer_id, r.photo_path)
      on conflict (volunteer_id) do update set photo_path = excluded.photo_path;
    end if;
  end if;

  update public.profile_requests
     set status = case when p_approve then 'accepted' else 'rejected' end,
         note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = app.email()::text, reviewed_at = now()
   where id = p_id;

  select v.email into email_to from public.volunteers v where v.id = r.volunteer_id;
  if email_to is not null then
    perform app.notify(array[email_to]::extensions.citext[],
      case when p_approve then 'طلب تعديل بياناتك اتقبل' else 'طلب تعديل بياناتك اترفض' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), case when p_approve then 'بياناتك اتحدّثت' else 'كلّم الـ HR لو عندك سؤال' end),
      '/me');
  end if;
end;
$$;

revoke all on function public.submit_profile_request(jsonb, text), public.review_profile_request(uuid, boolean, text) from public, anon;
grant execute on function public.submit_profile_request(jsonb, text), public.review_profile_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Fix: a teacher could change anything in his own dated class (date, time, subject, cancel it,
-- who teaches). He only sets the substitute, the exam's full mark and notes; taking attendance
-- marks it done. The rest stays with the organizers.
-- ---------------------------------------------------------------------
create or replace function students.guard_session_teacher()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_internal()
     or app.has_perm('students.edit') or app.has_perm('students.attendance')
     or app.has_perm('absences.review') or app.has_perm('schedule.edit') then
    return new;
  end if;
  if new.slot_id is distinct from old.slot_id
     or new.on_date is distinct from old.on_date
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.subject is distinct from old.subject
     or new.kind is distinct from old.kind
     or new.takes_attendance is distinct from old.takes_attendance
     or new.moved_to is distinct from old.moved_to
     or new.teacher_ids is distinct from old.teacher_ids
     or (new.status is distinct from old.status and new.status <> 'اتعملت') then
    raise exception 'ميعاد الحصة وحالتها ومين بيدّيها بيغيّرها التنظيم. ابعت طلب من «الحصص»' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists class_sessions_guard_teacher on students.class_sessions;
create trigger class_sessions_guard_teacher before update on students.class_sessions
  for each row execute function students.guard_session_teacher();

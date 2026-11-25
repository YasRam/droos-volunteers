-- =====================================================================
-- 21) Public join form, quick acceptance, activity leadership
--   * /join: anyone can register with no account. A new national ID becomes a
--     volunteer in «للتواصل». A known one becomes a request for HR that shows
--     the old and new data side by side, with the person's status and its reason.
--   * accept_volunteer(): «مقبول» in one tap from the home page
--   * the activity has one leader and one deputy (jobs); every committee has
--     leaders and deputies; «مسئول نشاط» is no longer a committee
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Requests from the join form for people already in the system
-- ---------------------------------------------------------------------
create table if not exists public.registration_requests (
  id            uuid primary key default extensions.gen_random_uuid(),
  created_at    timestamptz not null default now(),
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  data          jsonb not null,      -- what they typed now
  prev_data     jsonb not null,      -- what we had when they sent it
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by   extensions.citext,
  reviewed_at   timestamptz
);
create unique index if not exists registration_requests_one_pending
  on public.registration_requests (volunteer_id) where status = 'pending';
alter table public.registration_requests enable row level security;
create policy registration_requests_read on public.registration_requests for select to authenticated
  using ((select app.has_perm('hr.view')));
-- written only through the functions below
revoke insert, update, delete on public.registration_requests from anon, authenticated;

-- Count of new sign-ups from the form, for a simple flood guard
create table if not exists public.join_log (
  at            timestamptz not null default now(),
  volunteer_id  uuid,
  kind          text not null      -- new / update
);
alter table public.join_log enable row level security;
revoke all on public.join_log from anon, authenticated;

create or replace function app.personal_json(v public.volunteers)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'full_name_ar', v.full_name_ar, 'full_name_en', v.full_name_en, 'phone', v.phone, 'whatsapp', v.whatsapp,
    'email', v.email, 'qualification', v.qualification, 'job', v.job, 'area', v.area,
    'availability_notes', v.availability_notes, 'referral_source', v.referral_source,
    'study_year', v.study_year, 'facebook', v.facebook)
$$;

create or replace function public.join_activity(p jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  nid   text := btrim(coalesce(p->>'national_id', ''));
  phone text := regexp_replace(coalesce(p->>'phone', ''), '\s', '', 'g');
  wa    text := nullif(regexp_replace(coalesce(p->>'whatsapp', ''), '\s', '', 'g'), '');
  mail  text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  name  text := btrim(coalesce(p->>'full_name_ar', ''));
  clean jsonb;
  vid   uuid;
  v     public.volunteers;
begin
  -- A field people never see: robots fill it
  if coalesce(p->>'website', '') <> '' then
    return 'ok';
  end if;
  if nid !~ '^[23][0-9]{13}$' then
    raise exception 'الرقم القومي لازم يكون 14 رقم' using errcode = '22023';
  end if;
  if phone !~ '^01[0-9]{9}$' then
    raise exception 'رقم الموبايل لازم يكون 11 رقم ويبدأ بـ 01' using errcode = '22023';
  end if;
  if wa is not null and wa !~ '^01[0-9]{9}$' then
    raise exception 'رقم الواتساب لازم يكون 11 رقم ويبدأ بـ 01' using errcode = '22023';
  end if;
  if array_length(regexp_split_to_array(name, '\s+'), 1) < 3 then
    raise exception 'اكتب الاسم ثلاثي على الأقل' using errcode = '22023';
  end if;
  if mail is not null and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'الإيميل مش صحيح' using errcode = '22023';
  end if;
  if (select count(*) from public.join_log where at > now() - interval '1 hour') >= 60 then
    raise exception 'فيه ضغط على التسجيل دلوقتي، جرّب كمان شوية' using errcode = '54000';
  end if;

  clean := jsonb_strip_nulls(jsonb_build_object(
    'full_name_ar', name,
    'full_name_en', nullif(btrim(coalesce(p->>'full_name_en', '')), ''),
    'phone', phone, 'whatsapp', wa, 'email', mail,
    'qualification', nullif(btrim(coalesce(p->>'qualification', '')), ''),
    'job', nullif(btrim(coalesce(p->>'job', '')), ''),
    'area', nullif(btrim(coalesce(p->>'area', '')), ''),
    'availability_notes', nullif(btrim(coalesce(p->>'availability_notes', '')), ''),
    'referral_source', nullif(btrim(coalesce(p->>'referral_source', '')), ''),
    'study_year', nullif(btrim(coalesce(p->>'study_year', '')), ''),
    'facebook', nullif(btrim(coalesce(p->>'facebook', '')), '')));

  select volunteer_id into vid from public.volunteer_private where national_id = nid limit 1;
  perform set_config('app.skip_audit', 'off', true);
  perform app.begin_internal();

  if vid is null then
    -- the email may already belong to someone else: keep the person, drop the email
    if mail is not null and exists (select 1 from public.volunteers where lower(email) = mail) then
      clean := clean - 'email';
    end if;
    insert into public.volunteers (full_name_ar, full_name_en, phone, whatsapp, email, qualification, job, area,
                                   availability_notes, referral_source, study_year, facebook)
    values (clean->>'full_name_ar', clean->>'full_name_en', clean->>'phone', clean->>'whatsapp', clean->>'email',
            clean->>'qualification', clean->>'job', clean->>'area', clean->>'availability_notes',
            coalesce(clean->>'referral_source', 'فورم التسجيل'), clean->>'study_year', clean->>'facebook')
    returning id into vid;
    update public.volunteer_private set national_id = nid where volunteer_id = vid;
    insert into public.join_log (volunteer_id, kind) values (vid, 'new');
    perform app.notify(app.emails_with('hr.edit'), 'متطوع جديد سجّل',
      name || ' سجّل من فورم التسجيل، وبقى في قايمة «للتواصل»', '/recruit');
  else
    select * into v from public.volunteers where id = vid;
    insert into public.registration_requests (volunteer_id, data, prev_data)
    values (vid, clean, app.personal_json(v))
    on conflict (volunteer_id) where status = 'pending'
      do update set data = excluded.data, created_at = now();
    insert into public.join_log (volunteer_id, kind) values (vid, 'update');
    perform app.notify(app.emails_with('hr.edit'), 'تسجيل تاني لمتطوع موجود',
      v.full_name_ar || ' سجّل تاني من الفورم. راجع البيانات القديمة والجديدة', '/requests?tab=join');
  end if;

  perform app.end_internal();
  -- the same answer either way: the form never tells whether someone is already registered
  return 'ok';
end;
$$;
revoke all on function public.join_activity(jsonb) from public;
grant execute on function public.join_activity(jsonb) to anon, authenticated;

-- For HR: each pending request with who the person is now and why
create or replace function public.registration_requests_list(p_status text default 'pending')
returns table (id uuid, created_at timestamptz, volunteer_id uuid, code text, data jsonb, prev_data jsonb,
               status text, volunteer_status text, acceptance text, recruit_status text, out_reason text,
               hr_notes text, last_outcome text, last_notes text, last_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.created_at, r.volunteer_id, v.code, r.data, r.prev_data, r.status,
         v.status::text, h.acceptance::text, v.recruit_status, v.out_reason,
         case when app.has_perm('hr.notes') then h.hr_notes end,
         l.outcome, l.notes, l.created_at
    from public.registration_requests r
    join public.volunteers v on v.id = r.volunteer_id
    left join public.volunteer_hr h on h.volunteer_id = v.id
    left join lateral (select outcome, notes, created_at from public.recruit_log x
                        where x.volunteer_id = v.id order by created_at desc limit 1) l on true
   where app.has_perm('hr.view') and r.status = p_status
   order by r.created_at desc
   limit 300
$$;
revoke all on function public.registration_requests_list(text) from public, anon;
grant execute on function public.registration_requests_list(text) to authenticated;

create or replace function public.review_registration(p_id uuid, p_approve boolean, p_reopen boolean default false)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.registration_requests;
  d jsonb;
  mail text;
begin
  if not app.has_perm('hr.edit') then
    raise exception 'محتاج صلاحية تعديل بيانات المقابلة' using errcode = '42501';
  end if;
  select * into r from public.registration_requests where id = p_id and status = 'pending' for update;
  if not found then
    raise exception 'الطلب ده اتراجع قبل كده' using errcode = '22023';
  end if;
  d := r.data;
  if p_approve then
    mail := d->>'email';
    if mail is not null and exists (select 1 from public.volunteers where lower(email) = lower(mail) and id <> r.volunteer_id) then
      d := d - 'email';
    end if;
    perform app.begin_internal();
    update public.volunteers set
      full_name_ar       = coalesce(d->>'full_name_ar', full_name_ar),
      full_name_en       = coalesce(d->>'full_name_en', full_name_en),
      phone              = coalesce(d->>'phone', phone),
      whatsapp           = coalesce(d->>'whatsapp', whatsapp),
      email              = coalesce(d->>'email', email),
      qualification      = coalesce(d->>'qualification', qualification),
      job                = coalesce(d->>'job', job),
      area               = coalesce(d->>'area', area),
      availability_notes = coalesce(d->>'availability_notes', availability_notes),
      study_year         = coalesce(d->>'study_year', study_year),
      facebook           = coalesce(d->>'facebook', facebook)
     where id = r.volunteer_id;
    perform app.end_internal();
    if p_reopen then
      perform public.recruit_reopen(r.volunteer_id, 'سجّل تاني من فورم التسجيل');
    end if;
  end if;
  update public.registration_requests
     set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = app.email(), reviewed_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.review_registration(uuid, boolean, boolean) from public, anon;
grant execute on function public.review_registration(uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2) «مقبول» in one tap (HR, or the leader of that volunteer's committee)
-- ---------------------------------------------------------------------
create or replace function public.accept_volunteer(p_volunteer uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.volunteers;
begin
  select * into v from public.volunteers where id = p_volunteer;
  if not (app.has_perm('hr.edit') or app.leads(v.main_committee, v.sub_committee)) then
    raise exception 'القبول للـ HR أو ليدر لجنته' using errcode = '42501';
  end if;
  perform app.begin_internal();
  update public.volunteer_hr set acceptance = 'مقبول' where volunteer_id = p_volunteer;
  perform app.end_internal();
end;
$$;
revoke all on function public.accept_volunteer(uuid) from public, anon;
grant execute on function public.accept_volunteer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Activity leadership: one leader and one deputy; committees have leaders and deputies
-- ---------------------------------------------------------------------
alter table public.committee_leaders add column if not exists role text not null default 'ليدر';
alter table public.committee_leaders drop constraint if exists committee_leaders_role_check;
alter table public.committee_leaders add constraint committee_leaders_role_check check (role in ('ليدر', 'نائب'));

alter table public.volunteers drop constraint if exists volunteers_position_check;
alter table public.volunteers add constraint volunteers_position_check
  check (position in ('متطوع', 'HR', 'تنظيم', 'ليدر لجنة', 'نائب ليدر لجنة', 'نائب ليدر النشاط', 'ليدر النشاط'));

-- «مسئول نشاط» was set up as a committee: its leader is the activity leader
do $$
declare
  lead_id uuid;
begin
  perform app.begin_internal();
  select volunteer_id into lead_id from public.committee_leaders where committee = 'مسئول نشاط' and volunteer_id is not null limit 1;
  if lead_id is not null and not exists (select 1 from public.volunteers where position = 'ليدر النشاط') then
    update public.volunteers set position = 'ليدر النشاط' where id = lead_id;
  end if;
  delete from public.committee_leaders where committee = 'مسئول نشاط';
  update public.lookups set is_active = false where list = 'اللجنة' and value = 'مسئول نشاط';
  perform app.end_internal();
end $$;

create unique index if not exists volunteers_one_activity_leader on public.volunteers (position) where position = 'ليدر النشاط';
create unique index if not exists volunteers_one_activity_deputy on public.volunteers (position) where position = 'نائب ليدر النشاط';

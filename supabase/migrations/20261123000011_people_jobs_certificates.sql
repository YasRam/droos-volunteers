-- =====================================================================
-- People and jobs, several permission roles per person, camps, event forms,
-- national ID without self-service, certificate requests, regularity stats.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Several roles per person: staff_roles key becomes (email, role)
-- ---------------------------------------------------------------------
alter table public.staff_roles drop constraint staff_roles_pkey;
alter table public.staff_roles add primary key (email, role);
comment on table public.staff_roles is 'الصلاحيات: الشخص ممكن ياخد أكتر من صلاحية (صف لكل صلاحية). لو مش متطوع بيظهر في السجل بس.';

create or replace function app.my_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.role from public.staff_roles s join public.roles r on r.key = s.role
  where s.email = app.email() order by r.sort_order limit 1
$$;

create or replace function app.my_permissions()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}')
  from public.staff_roles s
  join public.roles r on r.key = s.role
  cross join lateral unnest(r.permissions) p
  where s.email = app.email()
$$;

create or replace function app.emails_with(p text)
returns extensions.citext[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.email), '{}')
  from public.staff_roles s join public.roles r on r.key = s.role
  where p = any (r.permissions)
$$;

create or replace function app.my_name()
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select v.full_name_ar from public.volunteers v where v.id = app.my_volunteer_id()),
    (select s.full_name from public.staff_roles s where s.email = app.email() limit 1),
    (select c.full_name from public.committee_leaders c where c.email = app.email() limit 1)
  )
$$;

-- ---------------------------------------------------------------------
-- 2) Job (الوظيفة): one per volunteer. Drives the structure tree.
-- ---------------------------------------------------------------------
alter table public.volunteers add column position text not null default 'متطوع'
  check (position in ('متطوع', 'HR', 'تنظيم', 'ليدر لجنة', 'نائب ليدر النشاط', 'ليدر النشاط'));
comment on column public.volunteers.position is 'الوظيفة: متطوع، HR، تنظيم، ليدر لجنة، نائب ليدر النشاط، ليدر النشاط.';

select app.begin_internal();
update public.volunteers v set position = 'ليدر لجنة'
 where exists (select 1 from public.committee_leaders c where c.volunteer_id = v.id or c.email = v.email);
update public.volunteers v set position = 'HR'
 where position = 'متطوع' and exists (select 1 from public.staff_roles s where s.role = 'hr' and (s.volunteer_id = v.id or s.email = v.email));
update public.volunteers v set position = 'تنظيم'
 where position = 'متطوع' and exists (select 1 from public.staff_roles s where s.role = 'organizer' and (s.volunteer_id = v.id or s.email = v.email));
update public.volunteers v set position = 'ليدر النشاط'
 where exists (select 1 from public.staff_roles s where s.role = 'activity_leader' and (s.volunteer_id = v.id or s.email = v.email));
select app.end_internal();

-- Only people allowed to edit volunteers change a job.
create or replace function app.guard_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.position is distinct from old.position
     and not (app.has_perm('volunteers.edit') or app.is_internal()) then
    raise exception 'الوظيفة بيغيّرها اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger volunteers_guard_position before update of position on public.volunteers
  for each row execute function app.guard_position();

-- ---------------------------------------------------------------------
-- 3) Camps: «ميني كامب» and «كامب» behave the same everywhere
-- ---------------------------------------------------------------------
create or replace function app.is_camp(p_event text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_event in ('ميني كامب', 'كامب')
$$;

insert into public.lookups (list, value, sort_order)
select 'الحدث', 'كامب', coalesce(max(sort_order), 0) + 1 from public.lookups where list = 'الحدث'
on conflict on constraint lookups_unique do nothing;

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
    if app.is_camp(new.event) then
      -- camps (ميني كامب / كامب) mark attendance but never change the status
      update public.volunteers
         set attended_minicamp = true,
             minicamp_date = coalesce(minicamp_date, new.activity_date)
       where id = new.volunteer_id;
    elsif v.status = 'خارج المتابعة' then
      update public.volunteers set status = 'تحت المتابعة' where id = new.volunteer_id;
      perform app.notify(
        array[v.email] || app.emails_with('volunteers.edit'),
        'رجوع تحت المتابعة',
        v.full_name_ar || ' رجع تحت المتابعة بعد مشاركة ' || new.event,
        '/volunteers/' || v.id);
    end if;
    perform app.end_internal();
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    perform app.notify(
      app.emails_with('attendance.review'),
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

-- ---------------------------------------------------------------------
-- 4) Event forms: what each «الحدث» asks for
--    teaching → المادة والسنة (ممكن أكتر من واحدة) وعدد الطلاب
--    none     → مفيش نوع حدث (زي التنظيم)
--    optional → نوع الحدث اختياري
-- ---------------------------------------------------------------------
alter table public.lookups add column if not exists form text
  check (form is null or form in ('teaching', 'none', 'optional'));
update public.lookups set form = 'teaching' where list = 'الحدث' and value in ('تدريس', 'تأسيس', 'امتحان شهري', 'كورس');
update public.lookups set form = 'none' where list = 'الحدث' and value = 'تنظيم';
update public.lookups set form = 'optional' where list = 'الحدث' and form is null;

-- Several subjects/grades are saved as one text joined by «، »; each joins the suggestions.
create or replace function app.remember_event_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

-- ---------------------------------------------------------------------
-- 5) National ID: nobody changes their own; no change requests anymore
-- ---------------------------------------------------------------------
drop policy if exists volunteer_private_self_request on public.volunteer_private;
select app.begin_internal();
update public.volunteer_private set requested_national_id = null where requested_national_id is not null;
select app.end_internal();

-- ---------------------------------------------------------------------
-- 6) Certificate requests: the volunteer uploads an ID card photo;
--    reviewers get the photo with a summary of the participations.
-- ---------------------------------------------------------------------
update public.roles
   set permissions = array(select distinct unnest(permissions || array['certificates.review']))
 where key in ('admin', 'activity_leader', 'hr');

create table public.certificate_requests (
  id             uuid primary key default extensions.gen_random_uuid(),
  volunteer_id   uuid not null references public.volunteers (id) on delete cascade,
  id_card_path   text not null,
  purpose        text,
  status         public.request_status not null default 'pending',
  review_note    text,
  created_at     timestamptz not null default now(),
  reviewed_by    text,
  reviewed_at    timestamptz
);
create index certificate_requests_volunteer_idx on public.certificate_requests (volunteer_id, created_at desc);
alter table public.certificate_requests enable row level security;
grant select, insert, update, delete on public.certificate_requests to authenticated;

create policy certificates_read on public.certificate_requests for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('certificates.review')));
create policy certificates_insert on public.certificate_requests for insert to authenticated
  with check (volunteer_id = (select app.my_volunteer_id()) and status = 'pending');
create policy certificates_review on public.certificate_requests for update to authenticated
  using ((select app.has_perm('certificates.review')));
create policy certificates_delete on public.certificate_requests for delete to authenticated
  using ((select app.has_perm('certificates.review')));

create or replace function app.certificate_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.volunteers;
begin
  select * into v from public.volunteers where id = new.volunteer_id;
  if tg_op = 'INSERT' then
    perform app.notify(app.emails_with('certificates.review'),
      'طلب شهادة تطوع', v.full_name_ar || ' طالب شهادة تطوع', '/certificates');
  elsif new.status is distinct from old.status and new.status <> 'pending' then
    new.reviewed_by := app.email();
    perform app.notify(array[v.email],
      case new.status when 'accepted' then 'شهادة التطوع جاهزة' else 'طلب شهادة التطوع اترفض' end,
      new.review_note, '/me');
  end if;
  return null;
end;
$$;
create trigger certificate_requests_changed after insert or update on public.certificate_requests
  for each row execute function app.certificate_changed();

create or replace function app.certificate_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := app.email();
    new.reviewed_at := now();
  end if;
  new.volunteer_id := old.volunteer_id;
  new.id_card_path := old.id_card_path;
  return new;
end;
$$;
create trigger certificate_requests_before_update before update on public.certificate_requests
  for each row execute function app.certificate_before_update();

create trigger audit_certificate_requests after insert or update or delete on public.certificate_requests
  for each row execute function app.audit('volunteer_id');

-- What the certificate says: totals and a line per event. Volunteers see their own.
create or replace function public.participation_summary(p_volunteer_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with p as (
    select * from public.participations
    where volunteer_id = p_volunteer_id and status = 'accepted'
  )
  select jsonb_build_object(
    'total', (select count(*) from p),
    'days', (select count(distinct activity_date) from p),
    'beneficiaries', (select coalesce(sum(beneficiaries), 0) from p),
    'first_date', (select min(activity_date) from p),
    'last_date', (select max(activity_date) from p),
    'by_event', coalesce((select jsonb_agg(e order by e ->> 'count' desc) from (
        select jsonb_build_object('event', event, 'count', count(*), 'days', count(distinct activity_date)) e
        from p group by event) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(m order by m ->> 'month') from (
        select jsonb_build_object('month', to_char(activity_date, 'YYYY-MM'), 'count', count(*)) m
        from p group by to_char(activity_date, 'YYYY-MM')) y), '[]'::jsonb)
  )
  where p_volunteer_id = app.my_volunteer_id()
     or app.has_perm('volunteers.view_all')
     or app.has_perm('certificates.review')
     or exists (select 1 from public.volunteers v where v.id = p_volunteer_id and app.leads(v.main_committee, v.sub_committee))
$$;
grant execute on function public.participation_summary(uuid) to authenticated;

-- Private bucket for ID card photos: <volunteer_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-cards', 'id-cards', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy id_cards_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'id-cards' and (storage.foldername(name))[1] = (select app.my_volunteer_id())::text);
create policy id_cards_read on storage.objects for select to authenticated
  using (bucket_id = 'id-cards' and (
    (storage.foldername(name))[1] = (select app.my_volunteer_id())::text
    or (select app.has_perm('certificates.review'))));
create policy id_cards_delete on storage.objects for delete to authenticated
  using (bucket_id = 'id-cards' and (select app.has_perm('certificates.review')));

-- ---------------------------------------------------------------------
-- 7) Regularity: distinct days and weeks per volunteer, sortable
-- ---------------------------------------------------------------------
drop function if exists public.top_participants(date, date, text, text, int);
create function public.top_participants(
  p_from date,
  p_to date,
  p_committee text default null,
  p_event text default null,
  p_limit int default 20,
  p_order text default 'participations'
)
returns table (
  volunteer_id uuid,
  code text,
  full_name_ar text,
  main_committee text,
  status public.volunteer_status,
  participations bigint,
  active_days bigint,
  active_weeks bigint,
  beneficiaries bigint,
  last_date date
)
language sql stable security invoker
set search_path = ''
as $$
  select v.id, v.code, v.full_name_ar, v.main_committee, v.status,
         count(*) as participations,
         count(distinct p.activity_date) as active_days,
         count(distinct date_trunc('week', p.activity_date + 2)) as active_weeks,  -- weeks start Saturday
         coalesce(sum(p.beneficiaries), 0) as beneficiaries,
         max(p.activity_date) as last_date
  from public.participations p
  join public.volunteers v on v.id = p.volunteer_id
  where p.status = 'accepted'
    and p.activity_date between p_from and p_to
    and (p_event is null or p.event = p_event)
    and (p_committee is null or v.main_committee = p_committee or v.sub_committee = p_committee)
  group by v.id
  order by
    case p_order when 'days' then count(distinct p.activity_date)
                 when 'weeks' then count(distinct date_trunc('week', p.activity_date + 2))
                 else count(*) end desc,
    count(*) desc, max(p.activity_date) desc
  limit least(greatest(p_limit, 1), 200)
$$;

-- ---------------------------------------------------------------------
-- 8) Log view: one name per person even with several roles
-- ---------------------------------------------------------------------
create or replace view public.audit_log_read
with (security_barrier = true)
as
select
  a.id,
  a.at,
  a.actor_email,
  coalesce(av.full_name_ar, s.full_name, cl.full_name,
           case when a.actor_email = 'system' or a.actor_email is null then 'السيستم' end,
           a.actor_email) as actor_name,
  a.table_name,
  a.action,
  a.record_id,
  coalesce(tv.full_name_ar, a.new_row ->> 'full_name_ar', a.old_row ->> 'full_name_ar') as target_name,
  tv.id as target_volunteer_id,
  app.redact(a.old_row) as old_row,
  app.redact(a.new_row) as new_row
from public.audit_log a
left join lateral (select x.full_name, x.volunteer_id from public.staff_roles x where x.email = a.actor_email limit 1) s on true
left join lateral (select c.full_name from public.committee_leaders c where c.email = a.actor_email limit 1) cl on true
left join public.volunteers av on av.id = coalesce(s.volunteer_id, (select v.id from public.volunteers v where v.email = a.actor_email limit 1))
left join public.volunteers tv on tv.id::text = case
    when a.table_name in ('volunteers', 'volunteer_private', 'volunteer_hr', 'certificate_requests') then a.record_id
    when a.table_name in ('participations', 'schedule_slots', 'staff_roles', 'committee_leaders') then coalesce(a.new_row, a.old_row) ->> 'volunteer_id'
  end
where (select app.has_perm('log.view'));

-- ---------------------------------------------------------------------
-- 9) my_context(): every role the person holds
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'email', app.email(),
    'full_name', app.my_name(),
    'role', app.my_role(),
    'roles', coalesce((select jsonb_agg(s.role order by r.sort_order) from public.staff_roles s join public.roles r on r.key = s.role where s.email = app.email()), '[]'::jsonb),
    'role_name', (select string_agg(r.name, ' + ' order by r.sort_order) from public.staff_roles s join public.roles r on r.key = s.role where s.email = app.email()),
    'position', (select v.position from public.volunteers v where v.id = app.my_volunteer_id()),
    'permissions', to_jsonb(app.my_permissions()),
    'is_full', app.has_perm('volunteers.edit'),
    'is_staff', app.has_perm('attendance.register'),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id()
  )
$$;

-- =====================================================================
-- Permissions: roles are named sets of permissions, editable from the app.
--
--  * public.roles        one row per role (أدمن، ليدر نشاط، HR، إدارة، تنظيم، and any new one)
--  * staff_roles.role     now points to roles.key (was a fixed enum)
--  * staff_roles / committee_leaders are linked to the person's volunteer record
--  * app.has_perm(p)      the one check every policy and trigger uses
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
create table public.roles (
  key          text primary key,
  name         text not null unique,
  description  text,
  permissions  text[] not null default '{}',
  is_builtin   boolean not null default false,
  sort_order   int not null default 100,
  created_at   timestamptz not null default now()
);
comment on table public.roles is 'كل صلاحية = مجموعة أذونات. الأذونات المتاحة متعرفة في التطبيق (web/src/lib/permissions.ts).';

insert into public.roles (key, name, description, permissions, is_builtin, sort_order) values
  ('admin', 'أدمن', 'كل حاجة', array[
     'volunteers.view_all','volunteers.edit','national_id.view','national_id.edit','hr.view','hr.notes','hr.edit',
     'directory.view','attendance.register','attendance.any_date','attendance.review','attendance.view_all','attendance.delete',
     'schedule.edit','stats.view','data.export','data.import','log.view','settings.manage','roles.manage'], true, 1),
  ('activity_leader', 'ليدر نشاط', 'كل حاجة زي الأدمن', array[
     'volunteers.view_all','volunteers.edit','national_id.view','national_id.edit','hr.view','hr.notes','hr.edit',
     'directory.view','attendance.register','attendance.any_date','attendance.review','attendance.view_all','attendance.delete',
     'schedule.edit','stats.view','data.export','data.import','log.view','settings.manage','roles.manage'], true, 2),
  ('hr', 'HR', 'كل حاجة، ومنها بيانات المقابلة', array[
     'volunteers.view_all','volunteers.edit','national_id.view','national_id.edit','hr.view','hr.notes','hr.edit',
     'directory.view','attendance.register','attendance.any_date','attendance.review','attendance.view_all','attendance.delete',
     'schedule.edit','stats.view','data.export','data.import','log.view','settings.manage','roles.manage'], true, 3),
  ('management', 'إدارة', 'يشوف كل حاجة ما عدا ملاحظات الـ HR، ومش بيعدّل', array[
     'volunteers.view_all','national_id.view','hr.view','directory.view','attendance.view_all','stats.view','data.export','log.view'], true, 4),
  ('organizer', 'تنظيم', 'يسجّل حضور ويوافق على الطلبات (آخر 7 أيام)', array[
     'directory.view','attendance.register','attendance.review','stats.view'], true, 5)
on conflict (key) do nothing;

-- staff_roles.role: enum → text pointing at roles.key
alter table public.staff_roles alter column role type text using role::text;
alter table public.staff_roles
  add constraint staff_roles_role_fkey foreign key (role) references public.roles (key) on update cascade;
comment on table public.staff_roles is 'مين معاه صلاحية إيه. الإيميل = إيميل جوجل، ومربوط بالمتطوع.';

-- link people to their volunteer record
alter table public.staff_roles add column volunteer_id uuid references public.volunteers (id) on delete set null;
alter table public.committee_leaders add column volunteer_id uuid references public.volunteers (id) on delete set null;
update public.staff_roles s set volunteer_id = v.id from public.volunteers v where v.email = s.email and s.volunteer_id is null;
update public.committee_leaders c set volunteer_id = v.id from public.volunteers v where v.email = c.email and c.volunteer_id is null;
create index staff_roles_volunteer_idx on public.staff_roles (volunteer_id);
create index committee_leaders_volunteer_idx on public.committee_leaders (volunteer_id);

-- When a linked volunteer's email changes, their access follows it.
create or replace function app.follow_volunteer_email()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.staff_roles set email = new.email where volunteer_id = new.id;
    update public.committee_leaders set email = new.email where volunteer_id = new.id;
  end if;
  return null;
end;
$$;
create trigger volunteers_email_follow after update of email on public.volunteers
  for each row execute function app.follow_volunteer_email();

-- ---------------------------------------------------------------------
-- The checks
-- ---------------------------------------------------------------------
drop function if exists app.my_role();
create function app.my_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.staff_roles where email = app.email()
$$;

create or replace function app.my_permissions()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select r.permissions from public.staff_roles s join public.roles r on r.key = s.role where s.email = app.email()
  ), '{}')
$$;

create or replace function app.has_perm(p text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p = any (app.my_permissions())
$$;

-- Kept for older code paths; each now means one permission.
create or replace function app.is_full() returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_perm('volunteers.edit') $$;
create or replace function app.is_staff() returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_perm('attendance.register') $$;
create or replace function app.is_organizer() returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_perm('attendance.register') and not app.has_perm('attendance.any_date') $$;
create or replace function app.can_manage_roles() returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_perm('roles.manage') $$;

-- Everyone holding a permission (for notifications).
create or replace function app.emails_with(p text)
returns extensions.citext[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.email), '{}')
  from public.staff_roles s join public.roles r on r.key = s.role
  where p = any (r.permissions)
$$;

drop function if exists app.emails_of(public.app_role[]);
drop type public.app_role;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.begin_internal(), app.end_internal() from authenticated;

-- ---------------------------------------------------------------------
-- roles: everyone signed in reads, roles.manage writes.
-- The admin role always keeps every permission (nobody can lock everyone out).
-- ---------------------------------------------------------------------
alter table public.roles enable row level security;
create policy roles_read on public.roles for select to authenticated using (true);
create policy roles_write on public.roles for all to authenticated
  using ((select app.has_perm('roles.manage'))) with check ((select app.has_perm('roles.manage')));
grant select, insert, update, delete on public.roles to authenticated;

create or replace function app.guard_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_builtin then
      raise exception 'الصلاحيات الأساسية مينفعش تتمسح' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.key = 'admin' and not new.permissions @> old.permissions then
    raise exception 'صلاحية الأدمن بتفضل كاملة' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.key := old.key;
    new.is_builtin := old.is_builtin;
  end if;
  return new;
end;
$$;
create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function app.guard_roles();

-- ---------------------------------------------------------------------
-- Policies rewritten on permissions
-- ---------------------------------------------------------------------
drop policy lookups_write on public.lookups;
create policy lookups_write on public.lookups for all to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));

drop policy app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));

drop policy volunteers_read on public.volunteers;
create policy volunteers_read on public.volunteers for select to authenticated
  using ((select app.has_perm('volunteers.view_all')) or app.leads(main_committee, sub_committee) or email = (select app.email()));

drop policy volunteers_insert on public.volunteers;
create policy volunteers_insert on public.volunteers for insert to authenticated
  with check ((select app.has_perm('volunteers.edit')));

drop policy volunteers_update on public.volunteers;
create policy volunteers_update on public.volunteers for update to authenticated
  using ((select app.has_perm('volunteers.edit')) or app.leads(main_committee, sub_committee) or email = (select app.email()));

drop policy volunteers_delete on public.volunteers;
create policy volunteers_delete on public.volunteers for delete to authenticated
  using ((select app.has_perm('volunteers.edit')));

drop policy volunteer_private_read on public.volunteer_private;
create policy volunteer_private_read on public.volunteer_private for select to authenticated
  using ((select app.has_perm('national_id.view')) or volunteer_id = (select app.my_volunteer_id()));

drop policy volunteer_private_write_full on public.volunteer_private;
create policy volunteer_private_write_full on public.volunteer_private for all to authenticated
  using ((select app.has_perm('national_id.edit'))) with check ((select app.has_perm('national_id.edit')));

create or replace function app.guard_private_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (app.has_perm('national_id.edit') or app.is_internal())
     and new.national_id is distinct from old.national_id then
    raise exception 'تغيير الرقم القومي محتاج موافقة. اكتبه في خانة الرقم المطلوب' using errcode = '42501';
  end if;
  if new.requested_national_id is distinct from old.requested_national_id then
    new.requested_at := case when new.requested_national_id is null then null else now() end;
  end if;
  return new;
end;
$$;

-- Interview data: the table itself for whoever sees the notes (and edits);
-- volunteer_hr_read for anyone with hr.view, notes blanked without hr.notes.
drop policy volunteer_hr_all on public.volunteer_hr;
create policy volunteer_hr_read_notes on public.volunteer_hr for select to authenticated
  using ((select app.has_perm('hr.notes')));
create policy volunteer_hr_write on public.volunteer_hr for all to authenticated
  using ((select app.has_perm('hr.edit'))) with check ((select app.has_perm('hr.edit')));

create view public.volunteer_hr_read
with (security_barrier = true)
as
select h.volunteer_id, h.acceptance, h.interview_date, h.interviewer,
       case when (select app.has_perm('hr.notes')) then h.hr_notes end as hr_notes,
       h.status_changed_at
from public.volunteer_hr h
where (select app.has_perm('hr.view'));
grant select on public.volunteer_hr_read to authenticated;

drop policy participations_read on public.participations;
create policy participations_read on public.participations for select to authenticated
  using (
    (select app.has_perm('attendance.view_all'))
    or ((select app.has_perm('attendance.register')) and activity_date >= (select app.today()) - 7)
    or volunteer_id = (select app.my_volunteer_id())
  );

drop policy participations_insert on public.participations;
create policy participations_insert on public.participations for insert to authenticated
  with check (
    (select app.has_perm('attendance.register'))
    or (volunteer_id = (select app.my_volunteer_id()) and activity_date = (select app.today()))
  );

drop policy participations_update on public.participations;
create policy participations_update on public.participations for update to authenticated
  using (
    (select app.has_perm('attendance.review'))
    and ((select app.has_perm('attendance.any_date')) or activity_date >= (select app.today()) - 7)
  );

drop policy participations_delete on public.participations;
create policy participations_delete on public.participations for delete to authenticated
  using ((select app.has_perm('attendance.delete')));

drop policy group_activities_read on public.group_activities;
create policy group_activities_read on public.group_activities for select to authenticated
  using ((select app.has_perm('attendance.register')) or (select app.has_perm('attendance.view_all')));
drop policy group_activities_insert on public.group_activities;
create policy group_activities_insert on public.group_activities for insert to authenticated
  with check ((select app.has_perm('attendance.register')));
drop policy group_activities_modify on public.group_activities;
create policy group_activities_modify on public.group_activities for update to authenticated
  using ((select app.has_perm('attendance.delete')));
drop policy group_activities_delete on public.group_activities;
create policy group_activities_delete on public.group_activities for delete to authenticated
  using ((select app.has_perm('attendance.delete')));

drop policy schedule_write on public.schedule_slots;
create policy schedule_write on public.schedule_slots for all to authenticated
  using ((select app.has_perm('schedule.edit'))) with check ((select app.has_perm('schedule.edit')));

drop policy audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.has_perm('log.view')) and (select app.has_perm('hr.notes')) and (select app.has_perm('national_id.view')));

create or replace view public.volunteer_directory
with (security_barrier = true)
as
select v.id, v.code, v.full_name_ar, v.phone, coalesce(v.whatsapp, v.phone) as whatsapp, v.status
from public.volunteers v
where (select app.has_perm('directory.view'))
   or (select app.has_perm('volunteers.view_all'))
   or app.leads(v.main_committee, v.sub_committee);

-- ---------------------------------------------------------------------
-- Triggers and RPCs that checked roles
-- ---------------------------------------------------------------------
create or replace function app.guard_volunteer_update()
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

  if not is_self and (
       new.full_name_ar is distinct from old.full_name_ar
    or new.full_name_en is distinct from old.full_name_en
    or new.phone is distinct from old.phone
    or new.whatsapp is distinct from old.whatsapp
    or new.email is distinct from old.email
    or new.qualification is distinct from old.qualification
    or new.job is distinct from old.job
    or new.area is distinct from old.area
    or new.availability_notes is distinct from old.availability_notes
    or new.referral_source is distinct from old.referral_source) then
    raise exception 'البيانات الشخصية يعدّلها المتطوع نفسه أو اللي معاه صلاحية تعديل المتطوعين' using errcode = '42501';
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

  return new;
end;
$$;

create or replace function public.review_national_id(p_volunteer_id uuid, p_approve boolean)
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if not app.has_perm('national_id.edit') then
    raise exception 'محتاج صلاحية تعديل الرقم القومي' using errcode = '42501';
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

  if app.has_perm('attendance.register') then
    if not app.has_perm('attendance.any_date')
       and (new.activity_date > app.today() or new.activity_date < app.today() - 7) then
      raise exception 'تقدر تسجّل لحد 7 أيام فاتوا بس' using errcode = '42501';
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
          or new.activity_date < app.today() - 7) then
    raise exception 'تقدر تعدّل آخر 7 أيام بس' using errcode = '42501';
  end if;
  return new;
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
      app.emails_with('national_id.edit'),
      'طلب تغيير رقم قومي',
      (select full_name_ar from public.volunteers where id = new.volunteer_id)
        || ' طالب يغيّر الرقم القومي لـ ' || new.requested_national_id,
      '/requests/national-id');
  end if;
  return null;
end;
$$;

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
-- my_context(): role name and the permission list for the app
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
    'role_name', (select r.name from public.roles r where r.key = app.my_role()),
    'permissions', to_jsonb(app.my_permissions()),
    'is_full', app.has_perm('volunteers.edit'),
    'is_staff', app.has_perm('attendance.register'),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id()
  )
$$;

-- =====================================================================
-- Security: role helpers, RLS policies, column guards
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers. security definer so they can read staff tables under RLS;
-- stable so Postgres caches them per statement.
-- ---------------------------------------------------------------------
create or replace function app.email()
returns extensions.citext
language sql stable
set search_path = ''
as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')::extensions.citext
$$;

-- Cairo calendar day (the database clock is UTC).
create or replace function app.today()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Cairo')::date
$$;

-- True inside trusted automation (triggers, jobs, service role, migrations).
create or replace function app.is_internal()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(current_setting('app.internal', true), '') = 'on'
      or (app.email() is null and coalesce(auth.jwt() ->> 'role', '') not in ('authenticated', 'anon'))
$$;

create or replace function app.my_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.staff_roles where email = app.email()
$$;

create or replace function app.is_full()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() in ('admin', 'activity_leader', 'hr'), false)
$$;

create or replace function app.is_organizer()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() = 'organizer', false)
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.my_role() is not null
$$;

create or replace function app.can_manage_roles()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_full()
$$;

create or replace function app.my_committees()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(committee), '{}') from public.committee_leaders where email = app.email()
$$;

create or replace function app.leads(main_committee text, sub_committee text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select main_committee = any (app.my_committees()) or sub_committee = any (app.my_committees())
$$;

create or replace function app.my_volunteer_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.volunteers where email = app.email()
$$;

-- Run a block as trusted automation: set the flag for this transaction only.
create or replace function app.begin_internal()
returns void
language sql volatile
set search_path = ''
as $$
  select set_config('app.internal', 'on', true)
$$;

create or replace function app.end_internal()
returns void
language sql volatile
set search_path = ''
as $$
  select set_config('app.internal', 'off', true)
$$;

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.begin_internal(), app.end_internal() from authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
alter table public.staff_roles        enable row level security;
alter table public.committee_leaders  enable row level security;
alter table public.lookups            enable row level security;
alter table public.app_settings       enable row level security;
alter table public.volunteers         enable row level security;
alter table public.volunteer_private  enable row level security;
alter table public.volunteer_hr       enable row level security;
alter table public.group_activities   enable row level security;
alter table public.participations     enable row level security;
alter table public.schedule_slots     enable row level security;
alter table public.notifications      enable row level security;
alter table public.audit_log          enable row level security;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- staff_roles, committee_leaders, lookups, app_settings
-- ---------------------------------------------------------------------
create policy staff_roles_read on public.staff_roles
  for select to authenticated using (true);
create policy staff_roles_write on public.staff_roles
  for all to authenticated
  using ((select app.can_manage_roles())) with check ((select app.can_manage_roles()));

create policy committee_leaders_read on public.committee_leaders
  for select to authenticated using (true);
create policy committee_leaders_write on public.committee_leaders
  for all to authenticated
  using ((select app.can_manage_roles())) with check ((select app.can_manage_roles()));

create policy lookups_read on public.lookups
  for select to authenticated using (true);
create policy lookups_write on public.lookups
  for all to authenticated
  using ((select app.is_full())) with check ((select app.is_full()));

create policy app_settings_read on public.app_settings
  for select to authenticated using (true);
create policy app_settings_write on public.app_settings
  for all to authenticated
  using ((select app.is_full())) with check ((select app.is_full()));

-- ---------------------------------------------------------------------
-- volunteers
-- Organizers read the directory view, not this table (no national id
-- or contact details beyond name and phone).
-- ---------------------------------------------------------------------
create policy volunteers_read on public.volunteers
  for select to authenticated
  using (
    (select app.is_full())
    or app.leads(main_committee, sub_committee)
    or email = (select app.email())
  );

create policy volunteers_insert on public.volunteers
  for insert to authenticated
  with check ((select app.is_full()));

create policy volunteers_update on public.volunteers
  for update to authenticated
  using (
    (select app.is_full())
    or app.leads(main_committee, sub_committee)
    or email = (select app.email())
  );

create policy volunteers_delete on public.volunteers
  for delete to authenticated
  using ((select app.is_full()));

-- Column guard: RLS decides the row, this decides the columns.
create or replace function app.guard_volunteer_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  full_access boolean := app.is_full() or app.is_internal();
  is_self     boolean := old.email is not null and old.email = app.email();
  is_leader   boolean := app.leads(old.main_committee, old.sub_committee);
begin
  if full_access then
    return new;
  end if;

  -- never by hand
  if new.code is distinct from old.code
     or new.registered_at is distinct from old.registered_at
     or new.birth_date is distinct from old.birth_date
     or new.gender is distinct from old.gender then
    raise exception 'الحقل ده بيتحسب تلقائي ومينفعش يتعدّل' using errcode = '42501';
  end if;

  -- interview data: HR only
  if new.status is distinct from old.status
     or new.main_committee is distinct from old.main_committee
     or new.sub_committee is distinct from old.sub_committee then
    raise exception 'بيانات المقابلة يعدّلها الـ HR بس' using errcode = '42501';
  end if;

  -- personal data: the volunteer
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
    raise exception 'البيانات الشخصية يعدّلها المتطوع نفسه أو الـ HR' using errcode = '42501';
  end if;

  -- committee data: committee leader
  if not is_leader and (
       new.contacted is distinct from old.contacted
    or new.passed_committee_test is distinct from old.passed_committee_test
    or new.joined_group is distinct from old.joined_group
    or new.is_active is distinct from old.is_active
    or new.bought_tshirt is distinct from old.bought_tshirt
    or new.attended_minicamp is distinct from old.attended_minicamp
    or new.minicamp_date is distinct from old.minicamp_date) then
    raise exception 'بيانات اللجنة يعدّلها ليدر اللجنة أو الـ HR' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger volunteers_guard
  before update on public.volunteers
  for each row execute function app.guard_volunteer_update();

-- Directory for organizers (and anyone staff): name and phone only.
-- Runs with the owner's rights on purpose; the where clause is the gate.
create view public.volunteer_directory
with (security_barrier = true)
as
select v.id, v.code, v.full_name_ar, v.phone, coalesce(v.whatsapp, v.phone) as whatsapp, v.status
from public.volunteers v
where (select app.is_staff())
   or app.leads(v.main_committee, v.sub_committee);

grant select on public.volunteer_directory to authenticated;

-- ---------------------------------------------------------------------
-- volunteer_private: HR and the volunteer
-- ---------------------------------------------------------------------
create policy volunteer_private_read on public.volunteer_private
  for select to authenticated
  using ((select app.is_full()) or volunteer_id = (select app.my_volunteer_id()));

create policy volunteer_private_write_full on public.volunteer_private
  for all to authenticated
  using ((select app.is_full())) with check ((select app.is_full()));

create policy volunteer_private_self_request on public.volunteer_private
  for update to authenticated
  using (volunteer_id = (select app.my_volunteer_id()))
  with check (volunteer_id = (select app.my_volunteer_id()));

create or replace function app.guard_private_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (app.is_full() or app.is_internal())
     and new.national_id is distinct from old.national_id then
    raise exception 'تغيير الرقم القومي محتاج موافقة الـ HR. اكتبه في خانة الرقم المطلوب' using errcode = '42501';
  end if;
  if new.requested_national_id is distinct from old.requested_national_id then
    new.requested_at := case when new.requested_national_id is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger volunteer_private_guard
  before update on public.volunteer_private
  for each row execute function app.guard_private_update();

-- ---------------------------------------------------------------------
-- volunteer_hr: HR only
-- ---------------------------------------------------------------------
create policy volunteer_hr_all on public.volunteer_hr
  for all to authenticated
  using ((select app.is_full())) with check ((select app.is_full()));

-- ---------------------------------------------------------------------
-- participations
-- ---------------------------------------------------------------------
create policy participations_read on public.participations
  for select to authenticated
  using (
    (select app.is_full())
    or ((select app.is_organizer()) and activity_date >= (select app.today()) - 7)
    or volunteer_id = (select app.my_volunteer_id())
  );

create policy participations_insert on public.participations
  for insert to authenticated
  with check (
    (select app.is_staff())
    or (volunteer_id = (select app.my_volunteer_id()) and activity_date = (select app.today()))
  );

create policy participations_update on public.participations
  for update to authenticated
  using (
    (select app.is_full())
    or ((select app.is_organizer()) and activity_date >= (select app.today()) - 7)
  );

create policy participations_delete on public.participations
  for delete to authenticated
  using ((select app.is_full()));

-- ---------------------------------------------------------------------
-- group_activities
-- ---------------------------------------------------------------------
create policy group_activities_read on public.group_activities
  for select to authenticated using ((select app.is_staff()));
create policy group_activities_insert on public.group_activities
  for insert to authenticated with check ((select app.is_staff()));
create policy group_activities_modify on public.group_activities
  for update to authenticated using ((select app.is_full()));
create policy group_activities_delete on public.group_activities
  for delete to authenticated using ((select app.is_full()));

-- ---------------------------------------------------------------------
-- schedule_slots: everyone signed in reads, HR edits
-- ---------------------------------------------------------------------
create policy schedule_read on public.schedule_slots
  for select to authenticated using (true);
create policy schedule_write on public.schedule_slots
  for all to authenticated
  using ((select app.is_full())) with check ((select app.is_full()));

-- ---------------------------------------------------------------------
-- notifications: your own only; written by triggers
-- ---------------------------------------------------------------------
create policy notifications_read on public.notifications
  for select to authenticated using (recipient_email = (select app.email()));
create policy notifications_mark_read on public.notifications
  for update to authenticated using (recipient_email = (select app.email()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_delete on public.notifications
  for delete to authenticated using (recipient_email = (select app.email()));

-- ---------------------------------------------------------------------
-- audit_log: HR reads, nobody writes by hand
-- ---------------------------------------------------------------------
create policy audit_log_read on public.audit_log
  for select to authenticated using ((select app.is_full()));
revoke insert, update, delete on public.audit_log from authenticated;

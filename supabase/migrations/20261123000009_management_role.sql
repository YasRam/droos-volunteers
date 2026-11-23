-- «إدارة» (management): sees all the data the full roles see, except volunteer_hr.hr_notes,
-- and can't add or change anything. It is not «staff»: no registering others, no reviewing.

create or replace function app.is_management()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() = 'management', false)
$$;

-- Everyone who may read the whole picture.
create or replace function app.can_view_all()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_full() or app.is_management()
$$;

-- Staff = the roles that register and review activities.
create or replace function app.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() <> 'management', false)
$$;

-- ---- read policies: full → full or management --------------------------
drop policy volunteers_read on public.volunteers;
create policy volunteers_read on public.volunteers
  for select to authenticated
  using (
    (select app.can_view_all())
    or app.leads(main_committee, sub_committee)
    or email = (select app.email())
  );

drop policy volunteer_private_read on public.volunteer_private;
create policy volunteer_private_read on public.volunteer_private
  for select to authenticated
  using ((select app.can_view_all()) or volunteer_id = (select app.my_volunteer_id()));

drop policy participations_read on public.participations;
create policy participations_read on public.participations
  for select to authenticated
  using (
    (select app.can_view_all())
    or ((select app.is_organizer()) and activity_date >= (select app.today()) - 7)
    or volunteer_id = (select app.my_volunteer_id())
  );

drop policy group_activities_read on public.group_activities;
create policy group_activities_read on public.group_activities
  for select to authenticated using ((select app.is_staff()) or (select app.can_view_all()));

drop policy audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using ((select app.can_view_all()));

-- Name-and-phone directory: staff, committee leaders, and management.
create or replace view public.volunteer_directory
with (security_barrier = true)
as
select v.id, v.code, v.full_name_ar, v.phone, coalesce(v.whatsapp, v.phone) as whatsapp, v.status
from public.volunteers v
where (select app.is_staff())
   or (select app.is_management())
   or app.leads(v.main_committee, v.sub_committee);

-- Interview data for reading: the table stays full-roles only; management reads this view,
-- which blanks the HR notes for anyone who isn't a full role.
create or replace view public.volunteer_hr_read
with (security_barrier = true)
as
select h.volunteer_id, h.acceptance, h.interview_date, h.interviewer,
       case when (select app.is_full()) then h.hr_notes end as hr_notes,
       h.status_changed_at
from public.volunteer_hr h
where (select app.can_view_all());

grant select on public.volunteer_hr_read to authenticated;

-- my_context(): tell the app about the new role
create or replace function public.my_context()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'email', app.email(),
    'full_name', app.my_name(),
    'role', app.my_role(),
    'is_full', app.is_full(),
    'is_management', app.is_management(),
    'is_staff', app.is_staff(),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id()
  )
$$;

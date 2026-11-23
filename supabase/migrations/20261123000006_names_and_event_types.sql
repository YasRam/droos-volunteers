-- 1) my_context() also returns the person's display name (for greetings and «تسجيل حضور»).
-- 2) Every new «نوع الحدث» used in an accepted participation joins the list for that event,
--    so the next person finds it in the suggestions.

create or replace function app.my_name()
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select v.full_name_ar from public.volunteers v where v.id = app.my_volunteer_id()),
    (select s.full_name from public.staff_roles s where s.email = app.email()),
    (select c.full_name from public.committee_leaders c where c.email = app.email() limit 1)
  )
$$;

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
    'is_staff', app.is_staff(),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id()
  )
$$;

create or replace function app.remember_event_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Pending requests wait: a typo in a request that gets rejected never reaches the list.
  if new.status = 'accepted' and nullif(btrim(new.subject), '') is not null then
    insert into public.lookups (list, value, parent, sort_order)
    select 'نوع الحدث', btrim(new.subject), new.event,
           coalesce((select max(sort_order) + 1 from public.lookups where list = 'نوع الحدث'), 0)
    on conflict on constraint lookups_unique do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists participations_remember_event_type on public.participations;
create trigger participations_remember_event_type
  after insert or update of status, subject, event on public.participations
  for each row execute function app.remember_event_type();

-- =====================================================================
-- 33) The signed-in person's English name, for the English version of the site.
--     my_context() gains «full_name_en» (the volunteer's English name, or null).
--     The site shows it in English and falls back to the Arabic name when it's empty.
-- =====================================================================
create or replace function public.my_context()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'email', app.email(),
    'full_name', app.my_name(),
    'full_name_en', (select nullif(btrim(v.full_name_en), '') from public.volunteers v where v.id = app.my_volunteer_id()),
    'role', app.my_role(),
    'roles', coalesce((select jsonb_agg(s.role order by r.sort_order) from public.staff_roles s join public.roles r on r.key = s.role where s.email = app.email()), '[]'::jsonb),
    'role_name', (select string_agg(r.name, ' + ' order by r.sort_order) from public.staff_roles s join public.roles r on r.key = s.role where s.email = app.email()),
    'position', (select v.position from public.volunteers v where v.id = app.my_volunteer_id()),
    'permissions', to_jsonb(app.my_permissions()),
    'is_full', app.has_perm('volunteers.edit'),
    'is_staff', app.has_perm('attendance.register'),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id(),
    'inactive', app.account_closed(app.email())
  )
$$;

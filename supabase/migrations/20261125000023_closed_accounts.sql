-- =====================================================================
-- 23) Someone who left the activity (مرفوض / مفصول / معتذر نهائى) can't use the site:
--     sign-in still works, but the account sees nothing and the site says why.
--     «خارج المتابعة» is not leaving: those people can still sign in and come back.
--     People with permissions or committee leadership are never closed this way.
-- =====================================================================
create or replace function app.account_closed(p_email text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.volunteers v
      join public.volunteer_hr h on h.volunteer_id = v.id
     where lower(v.email) = lower(p_email)
       and h.acceptance::text in ('مرفوض', 'مفصول', 'معتذر نهائى', 'معتذر نهائي'))
    and not exists (select 1 from public.staff_roles s where lower(s.email) = lower(p_email))
    and not exists (select 1 from public.committee_leaders c where lower(c.email) = lower(p_email))
$$;

-- every «my own row» rule goes through this, so a closed account sees and changes nothing
create or replace function app.my_volunteer_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.volunteers where email = app.email() and not app.account_closed(app.email())
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

-- no password by personal data for a closed account either
do $$
declare
  src text;
begin
  select pg_get_functiondef('public.account_check(text, text, text)'::regprocedure) into src;
  if position('account_closed' in src) = 0 then
    src := replace(src, '  return jsonb_build_object(''ok'', true, ''volunteer_id'', v.id,',
      '  if app.account_closed(p_email) then
    return jsonb_build_object(''ok'', false, ''error'', ''الحساب ده مش فعال. لو ده غلط كلّم الـ HR'');
  end if;
  return jsonb_build_object(''ok'', true, ''volunteer_id'', v.id,');
    execute src;
  end if;
end $$;

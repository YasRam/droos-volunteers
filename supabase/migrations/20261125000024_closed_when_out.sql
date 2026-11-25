-- =====================================================================
-- 24) «خارج المتابعة» for any reason also closes the account
--     (as well as مرفوض / مفصول / معتذر نهائى). Coming back = HR changes the status.
-- =====================================================================
create or replace function app.account_closed(p_email text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.volunteers v
      left join public.volunteer_hr h on h.volunteer_id = v.id
     where lower(v.email) = lower(p_email)
       and (v.status = app.status_at(5)
            or h.acceptance::text in ('مرفوض', 'مفصول', 'معتذر نهائى', 'معتذر نهائي')))
    and not exists (select 1 from public.staff_roles s where lower(s.email) = lower(p_email))
    and not exists (select 1 from public.committee_leaders c where lower(c.email) = lower(p_email))
$$;

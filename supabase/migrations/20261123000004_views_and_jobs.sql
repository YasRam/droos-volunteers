-- =====================================================================
-- Read views for the screens, and scheduled jobs
-- =====================================================================

-- Per-volunteer participation numbers (accepted only). RLS of the
-- underlying tables applies to whoever queries it.
create view public.volunteer_stats
with (security_invoker = true)
as
select
  v.id as volunteer_id,
  max(p.activity_date) as last_participation,
  count(p.id) filter (where p.activity_date >= date_trunc('month', app.today())) as this_month,
  count(p.id) filter (where p.activity_date >= date_trunc('month', app.today()) - interval '1 month'
                        and p.activity_date <  date_trunc('month', app.today())) as last_month,
  count(p.id) as total
from public.volunteers v
left join public.participations p on p.volunteer_id = v.id and p.status = 'accepted'
group by v.id;

-- Accepted participations by month, event and committee (statistics screen).
create view public.monthly_participation
with (security_invoker = true)
as
select
  to_char(p.activity_date, 'YYYY-MM') as month,
  p.event,
  coalesce(v.main_committee, 'بدون لجنة') as committee,
  count(*) as participations,
  count(distinct p.volunteer_id) as volunteers
from public.participations p
join public.volunteers v on v.id = p.volunteer_id
where p.status = 'accepted'
group by 1, 2, 3;

-- Under follow-up with no accepted participation in the last 30 days.
create view public.inactive_volunteers
with (security_invoker = true)
as
select v.id, v.code, v.full_name_ar, coalesce(v.whatsapp, v.phone) as whatsapp,
       v.main_committee, s.last_participation
from public.volunteers v
join public.volunteer_stats s on s.volunteer_id = v.id
where v.status = 'تحت المتابعة'
  and (s.last_participation is null or s.last_participation < app.today() - 30);

grant select on public.volunteer_stats, public.monthly_participation, public.inactive_volunteers to authenticated;

-- ---------------------------------------------------------------------
-- Scheduled jobs (pg_cron runs in UTC; 07:00 UTC = 9:00 Cairo in winter)
-- ---------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('daily-status-rules', '0 7 * * *', $$select app.run_daily_jobs()$$);
select cron.schedule('monthly-summary', '0 7 1 * *', $$select app.run_monthly_summary()$$);

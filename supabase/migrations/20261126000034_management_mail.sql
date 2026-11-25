-- =====================================================================
-- 34) Emails to the branch management (الإدارة), sent from droosmng@gmail.com by the Apps Script.
--
--  The script always answers the management's own email with «reply all», so everyone on it
--  gets it. Which email: the one whose subject matches the setting for that kind.
--
--    followup  every day at dawn: the accepted participations not sent yet, as an Excel file,
--              to this month's email («… {month}/{year}» in the subject). Meetings and family
--              days go with their details and photos.
--    edits     every day late at night: what changed in rows already sent.
--    access    by hand: the volunteers chosen to have access to the place (one fixed email).
--    updates   by hand: news written on the site.
--    requests  by hand: requests written on the site.
--
--  Only «mail.management» sends by hand. Nothing changes in the volunteers' tables: what was
--  sent is remembered in public.mail_items.
-- =====================================================================

create table public.mail_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default false,          -- the daily emails
  management_email  extensions.citext,                       -- optional: only threads from this address
  followup_subject  text not null default 'الميل الشهرى للمتابعة مع نشاط دروس التقويه {month}/{year}',
  followup_body     text not null default 'مرفق ملف فيه المتابعة اليومية الجديدة.',
  edits_body        text not null default 'مرفق ملف فيه التعديلات على المتابعة اللي اتبعتت قبل كده.',
  access_subject    text,
  updates_subject   text,
  requests_subject  text,
  error_email       extensions.citext default 'y.r.a.elnobe@gmail.com',  -- gets a note when the email isn't found
  updated_at        timestamptz not null default now(),
  updated_by        text
);
insert into public.mail_settings default values;
create trigger mail_settings_touch before update on public.mail_settings for each row execute function app.touch();
create trigger audit_mail_settings after update on public.mail_settings for each row execute function app.audit();

-- What was sent, and how it looked then (to find edits later).
create table public.mail_items (
  kind      text not null check (kind in ('participation', 'meeting')),
  item_id   uuid not null,
  sent_at   timestamptz not null default now(),
  snapshot  jsonb not null,
  primary key (kind, item_id)
);

create table public.mail_log (
  id        bigint generated always as identity primary key,
  kind      text not null check (kind in ('followup', 'meetings', 'edits', 'access', 'updates', 'requests')),
  subject   text,
  ok        boolean not null,
  error     text,
  rows      int,
  body      text,
  sent_by   text,           -- null = the daily job
  sent_at   timestamptz not null default now()
);
create index mail_log_sent_idx on public.mail_log (sent_at desc);

alter table public.mail_settings enable row level security;
alter table public.mail_items enable row level security;
alter table public.mail_log enable row level security;
grant select, update on public.mail_settings to authenticated;
grant select on public.mail_log to authenticated;
grant all on public.mail_settings, public.mail_items, public.mail_log to service_role;

create policy mail_settings_read on public.mail_settings for select to authenticated
  using ((select app.has_perm('mail.management')));
create policy mail_settings_write on public.mail_settings for update to authenticated
  using ((select app.has_perm('mail.management'))) with check ((select app.has_perm('mail.management')));
create policy mail_log_read on public.mail_log for select to authenticated
  using ((select app.has_perm('mail.management')));

update public.roles set permissions = array(select distinct unnest(permissions || array['mail.management']))
 where key in ('admin', 'activity_leader');

-- The script (service role) or someone with mail.management.
create or replace function app.can_mail()
returns boolean language sql stable set search_path = '' as $$
  select app.has_perm('mail.management')
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

create or replace function app.day_name_ar(d date)
returns text language sql immutable set search_path = '' as $$
  select (array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'])[extract(dow from d)::int + 1]
$$;

-- One row of the daily follow-up, as it is sent.
create or replace function app.mail_participation(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'date', to_char(p.activity_date, 'DD/MM/YYYY'),
    'day', app.day_name_ar(p.activity_date),
    'name', v.full_name_ar,
    'phone', v.phone,
    'event', p.event,
    'type', p.subject,
    'grade', p.grade,
    'place', p.place,
    'students', p.beneficiaries,
    'notes', p.notes)
  from public.participations p join public.volunteers v on v.id = p.volunteer_id
  where p.id = p_id and p.status = 'accepted'
$$;

create or replace function app.mail_meeting(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id,
    'date', to_char(m.meeting_date, 'DD/MM/YYYY'),
    'day', app.day_name_ar(m.meeting_date),
    'event', m.event,
    'committee', m.committee,
    'head', coalesce(v.full_name_ar, m.head_name),
    'head_role', coalesce(m.head_role, v.position),
    'attendees', ((select count(*) from public.participations x where x.meeting_id = m.id and x.status = 'accepted') + m.attendees_extra)::int,
    'type', m.meeting_type,
    'goal', m.goal,
    'achievements', m.achievements,
    'photos', coalesce((select jsonb_agg(ph.path order by ph.created_at) from public.meeting_photos ph where ph.meeting_id = m.id), '[]'))
  from public.meetings m left join public.volunteers v on v.id = m.head_id
  where m.id = p_id
$$;

-- Everything the dawn email needs: rows and meetings not sent yet (last 60 days).
create or replace function public.mail_followup_batch()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.mail_settings;
begin
  if not app.can_mail() then
    raise exception 'محتاج صلاحية إيميلات الإدارة' using errcode = '42501';
  end if;
  select * into s from public.mail_settings;
  return jsonb_build_object(
    'settings', to_jsonb(s),
    'rows', coalesce((
      select jsonb_agg(app.mail_participation(p.id) order by p.activity_date, v.full_name_ar)
        from public.participations p join public.volunteers v on v.id = p.volunteer_id
       where p.status = 'accepted' and p.activity_date >= app.today() - 60
         and not exists (select 1 from public.mail_items i where i.kind = 'participation' and i.item_id = p.id)), '[]'),
    'meetings', coalesce((
      select jsonb_agg(app.mail_meeting(m.id) order by m.meeting_date, m.created_at)
        from public.meetings m
       where m.meeting_date >= app.today() - 60
         and not exists (select 1 from public.mail_items i where i.kind = 'meeting' and i.item_id = m.id)), '[]'));
end;
$$;

-- Rows already sent that changed since (or were removed): the late-night email.
create or replace function public.mail_followup_edits()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_mail() then
    raise exception 'محتاج صلاحية إيميلات الإدارة' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.mail_settings s),
    'edits', coalesce((
      select jsonb_agg(jsonb_build_object('old', i.snapshot, 'new', cur.row) order by i.snapshot ->> 'date', i.snapshot ->> 'name')
        from public.mail_items i
        cross join lateral (select app.mail_participation(i.item_id) as row) cur
       where i.kind = 'participation' and i.sent_at >= now() - interval '60 days'
         and cur.row is distinct from i.snapshot), '[]'));
end;
$$;

-- The script reports what it sent. followup/meetings/edits remember the rows as they are now.
create or replace function public.mail_mark_sent(p_kind text, p_ids uuid[], p_subject text, p_ok boolean,
                                                 p_error text default null, p_body text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_mail() then
    raise exception 'محتاج صلاحية إيميلات الإدارة' using errcode = '42501';
  end if;
  if p_ok and p_kind in ('followup', 'edits') then
    insert into public.mail_items (kind, item_id, snapshot)
    select 'participation', x, coalesce(app.mail_participation(x), '{"removed": true}')
      from unnest(p_ids) x
    on conflict (kind, item_id) do update set snapshot = excluded.snapshot, sent_at = now();
  elsif p_ok and p_kind = 'meetings' then
    insert into public.mail_items (kind, item_id, snapshot)
    select 'meeting', x, app.mail_meeting(x) from unnest(p_ids) x where app.mail_meeting(x) is not null
    on conflict (kind, item_id) do update set snapshot = excluded.snapshot, sent_at = now();
  end if;
  insert into public.mail_log (kind, subject, ok, error, rows, body, sent_by)
  values (p_kind, p_subject, p_ok, left(p_error, 1000), cardinality(p_ids), left(p_body, 20000),
          case when app.has_perm('mail.management') then app.email()::text end);
end;
$$;

-- «Access to the place»: the chosen volunteers.
create or replace function public.mail_access_rows(p_ids uuid[])
returns table (code text, name text, phone text, committee text)
language sql stable security definer set search_path = '' as $$
  select v.code, v.full_name_ar, v.phone, v.main_committee
    from public.volunteers v
   where app.can_mail() and v.id = any (p_ids)
   order by v.full_name_ar
$$;

revoke all on function public.mail_followup_batch(), public.mail_followup_edits(),
  public.mail_mark_sent(text, uuid[], text, boolean, text, text), public.mail_access_rows(uuid[]) from public, anon;
grant execute on function public.mail_followup_batch(), public.mail_followup_edits(),
  public.mail_mark_sent(text, uuid[], text, boolean, text, text), public.mail_access_rows(uuid[]) to authenticated, service_role;
revoke all on function app.mail_participation(uuid), app.mail_meeting(uuid) from public, anon, authenticated;

-- Backups: the settings and what was sent.
create or replace function app.backup_tables()
returns text[]
language sql immutable
as $$
  select array['app_settings', 'lookups', 'roles', 'volunteers', 'volunteer_private', 'volunteer_hr', 'staff_roles',
               'committee_leaders', 'group_activities', 'meetings', 'participations', 'meeting_photos', 'schedule_slots',
               'class_absences', 'certificate_requests', 'stages', 'stage_done', 'rules_acceptances', 'activity_rules',
               'rule_answers', 'tshirt_requests', 'camps', 'camp_registrations', 'recruit_log', 'registration_requests',
               'notifications', 'audit_log', 'mail_settings', 'mail_items', 'mail_log',
               -- students (parents before children)
               'students.settings', 'students.org_info', 'students.terms', 'students.grades', 'students.attendance_marks',
               'students.guardians', 'students.students', 'students.student_private', 'students.phones', 'students.accounts',
               'students.applications', 'students.enrollments', 'students.groups', 'students.group_members',
               'students.whatsapp_groups', 'students.class_sessions', 'students.audiences', 'students.schedule_pauses',
               'students.slot_requests', 'students.attendance', 'students.exam_results', 'students.flags', 'students.leaves',
               'students.notes', 'students.announcements', 'students.change_requests', 'students.dismissal_requests']
$$;

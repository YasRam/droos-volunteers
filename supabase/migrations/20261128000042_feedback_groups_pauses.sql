-- 1) Feedback: its own table (volunteer, who wrote it, the feedback, when). For volunteers and
--    students, every 3 months or when needed. The interview's HR notes are the first feedback.
--    The volunteer never sees his own feedback; families never see students' feedback.
--    The old fields (follower / trainee / head of follow-up, notes 1-3, HR notes) move into it.
-- 2) Exit reason: only while the status is «خارج المتابعة», free text; the daily job writes
--    «عدم المشاركة لمدة 3 شهور». Leaving that status clears it.
-- 3) The interviewer is a volunteer who has the HR permission.
-- 4) «دخل الجروب»: the volunteer ticks it himself, and sees his WhatsApp groups (the general one,
--    his main and sub committee, the grades and groups he teaches); admins see them all.
-- 5) Pauses can be for a group too (and a grade pause follows the class audience).

-- ---------------------------------------------------------------------
-- 1) feedback
-- ---------------------------------------------------------------------
create table if not exists public.volunteer_feedback (
  id            uuid primary key default extensions.gen_random_uuid(),
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  author_id     uuid references public.volunteers (id) on delete set null,
  author_name   text,                -- for old notes with no author on file
  kind          text not null default 'متابعة' check (kind in ('مقابلة', 'متابعة')),
  body          text not null check (btrim(body) <> ''),
  given_on      date not null default (now() at time zone 'Africa/Cairo')::date,
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists volunteer_feedback_idx on public.volunteer_feedback (volunteer_id, given_on desc);
alter table public.volunteer_feedback enable row level security;
grant select, insert, update, delete on public.volunteer_feedback to authenticated;
grant all on public.volunteer_feedback to service_role;

create or replace function app.can_feedback(p_volunteer uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_volunteer is distinct from app.my_volunteer_id()
     and (app.has_perm('volunteers.edit') or app.has_perm('hr.edit')
          or (not p_write and app.has_perm('hr.notes'))
          or exists (select 1 from public.volunteers v where v.id = p_volunteer and app.leads(v.main_committee, v.sub_committee)))
$$;
create policy volunteer_feedback_read on public.volunteer_feedback for select to authenticated
  using ((select app.can_feedback(volunteer_id, false)));
create policy volunteer_feedback_insert on public.volunteer_feedback for insert to authenticated
  with check ((select app.can_feedback(volunteer_id, true)) and author_id is not distinct from (select app.my_volunteer_id()));
create policy volunteer_feedback_change on public.volunteer_feedback for update to authenticated
  using (author_id = (select app.my_volunteer_id()) or (select app.has_perm('volunteers.edit')))
  with check ((select app.can_feedback(volunteer_id, true)));
create policy volunteer_feedback_delete on public.volunteer_feedback for delete to authenticated
  using (author_id = (select app.my_volunteer_id()) or (select app.has_perm('volunteers.edit')));

-- move the old notes in (once)
insert into public.volunteer_feedback (volunteer_id, author_id, author_name, kind, body, given_on, created_by)
select h.volunteer_id, h.interviewer_id, case when h.interviewer_id is null then h.interviewer end, 'مقابلة', btrim(h.hr_notes),
       coalesce(h.interview_date, (now() at time zone 'Africa/Cairo')::date), 'نقل تلقائي'
  from public.volunteer_hr h
 where btrim(coalesce(h.hr_notes, '')) <> ''
   and not exists (select 1 from public.volunteer_feedback f where f.volunteer_id = h.volunteer_id and f.kind = 'مقابلة');
insert into public.volunteer_feedback (volunteer_id, author_id, kind, body, given_on, created_by)
select v.id, coalesce(v.follower_id, v.follower_trainee_id, v.follow_head_id), 'متابعة', btrim(n.body),
       (now() at time zone 'Africa/Cairo')::date - (3 - n.i) , 'نقل تلقائي'
  from public.volunteers v
  cross join lateral (values (1, v.follow_notes_1), (2, v.follow_notes_2), (3, v.follow_notes_3)) n(i, body)
 where btrim(coalesce(n.body, '')) <> ''
   and not exists (select 1 from public.volunteer_feedback f where f.volunteer_id = v.id and f.kind = 'متابعة' and f.created_by = 'نقل تلقائي');

-- students
create table if not exists students.feedback (
  id          uuid primary key default extensions.gen_random_uuid(),
  student_id  uuid not null references students.students (id) on delete cascade,
  author_id   uuid references public.volunteers (id) on delete set null,
  body        text not null check (btrim(body) <> ''),
  given_on    date not null default (now() at time zone 'Africa/Cairo')::date,
  created_at  timestamptz not null default now()
);
create index if not exists students_feedback_idx on students.feedback (student_id, given_on desc);
alter table students.feedback enable row level security;
grant select, insert, update, delete on students.feedback to authenticated;
grant all on students.feedback to service_role;
create policy feedback_read on students.feedback for select to authenticated
  using (not (select app.is_family())
         and ((select app.has_perm('students.view_all')) or student_id = any ((select students.taught_student_ids())::uuid[])));
create policy feedback_insert on students.feedback for insert to authenticated
  with check (not (select app.is_family()) and author_id is not distinct from (select app.my_volunteer_id())
              and ((select app.has_perm('students.edit')) or (select app.has_perm('students.attendance'))
                   or student_id = any ((select students.taught_student_ids())::uuid[])));
create policy feedback_change on students.feedback for update to authenticated
  using (author_id = (select app.my_volunteer_id()) or (select app.has_perm('students.edit')));
create policy feedback_delete on students.feedback for delete to authenticated
  using (author_id = (select app.my_volunteer_id()) or (select app.has_perm('students.edit')));

-- Who is due a feedback (none in the last 90 days): volunteers under follow-up and students this term
create or replace function app.feedback_due()
returns table (kind text, id uuid, name text, last_on date)
language sql stable security definer set search_path = '' as $$
  select 'volunteer', v.id, v.full_name_ar, (select max(f.given_on) from public.volunteer_feedback f where f.volunteer_id = v.id)
    from public.volunteers v
   where v.status::text <> 'خارج المتابعة'
     and app.can_feedback(v.id, false)
     and not exists (select 1 from public.volunteer_feedback f where f.volunteer_id = v.id and f.given_on > app.today() - 90)
  union all
  select 'student', s.id, s.full_name, (select max(f.given_on) from students.feedback f where f.student_id = s.id)
    from students.students s
    join students.enrollments e on e.student_id = s.id and e.term_id = students.current_term() and e.status in ('نشط', 'تحذير')
   where not app.is_family()
     and (app.has_perm('students.view_all') or s.id = any (students.taught_student_ids()))
     and not exists (select 1 from students.feedback f where f.student_id = s.id and f.given_on > app.today() - 90)
$$;
revoke all on function app.feedback_due() from public, anon;
grant execute on function app.feedback_due() to authenticated;
create or replace function public.feedback_due()
returns table (kind text, id uuid, name text, last_on date)
language sql stable security invoker set search_path = '' as $$ select * from app.feedback_due() $$;
revoke all on function public.feedback_due() from public, anon;
grant execute on function public.feedback_due() to authenticated;

-- ---------------------------------------------------------------------
-- 2) exit reason follows the status
-- ---------------------------------------------------------------------
create or replace function app.out_reason_follows_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status::text = 'خارج المتابعة' then
    if new.status is distinct from old.status and btrim(coalesce(new.out_reason, '')) = '' then
      new.out_reason := case when app.is_internal() then 'عدم المشاركة لمدة 3 شهور' else null end;
    end if;
  else
    new.out_reason := null;
  end if;
  return new;
end;
$$;
drop trigger if exists volunteers_out_reason on public.volunteers;
create trigger volunteers_out_reason before update of status, out_reason on public.volunteers
  for each row execute function app.out_reason_follows_status();
update public.volunteers set out_reason = null where status::text <> 'خارج المتابعة' and out_reason is not null;

-- the exit reason is set with the status (volunteers.edit), not by the leaders
create or replace function app.guard_volunteer_followup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.has_perm('volunteers.edit') or app.is_internal() then
    return new;
  end if;
  if new.out_reason is distinct from old.out_reason then
    raise exception 'سبب الخروج بيتكتب مع تغيير الحالة لـ«خارج المتابعة»' using errcode = '42501';
  end if;
  if new.follower_id is distinct from old.follower_id
     or new.follower_trainee_id is distinct from old.follower_trainee_id
     or new.follow_head_id is distinct from old.follow_head_id
     or new.follow_notes_1 is distinct from old.follow_notes_1
     or new.follow_notes_2 is distinct from old.follow_notes_2
     or new.follow_notes_3 is distinct from old.follow_notes_3 then
    raise exception 'المتابعة بقت فيد باك في جدول لوحده' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) interviewers
-- ---------------------------------------------------------------------
create or replace function public.interviewers()
returns table (id uuid, full_name_ar text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.full_name_ar
    from public.volunteers v
   where (app.has_perm('hr.view') or app.has_perm('recruit.manage'))
     and lower(v.email::text) in (
       select lower(e::text) from unnest(app.emails_with('hr.edit') || app.emails_with('recruit.manage')) e)
   order by v.full_name_ar
$$;
revoke all on function public.interviewers() from public, anon;
grant execute on function public.interviewers() to authenticated;

-- ---------------------------------------------------------------------
-- 4) WhatsApp groups of a volunteer; he ticks «دخل الجروب» himself
-- ---------------------------------------------------------------------
create or replace function public.my_whatsapp_groups()
returns table (kind text, name text, link text)
language sql stable security definer set search_path = '' as $$
  with me as (select v.* from public.volunteers v where v.id = app.my_volunteer_id()),
       everything as (select app.has_perm('volunteers.view_all') or app.has_perm('volunteers.edit') as yes),
       slots as (
         select s.id from public.schedule_slots s, me
          where s.status <> 'اتلغت' and (s.volunteer_id = me.id or me.id = any (s.co_teachers)))
  select 'عام', 'جروب النشاط', (select value from public.app_settings where key = 'whatsapp_group_link')
   where (select value from public.app_settings where key = 'whatsapp_group_link') is not null
  union all
  select 'فريق العمل', 'جروب فريق العمل', (select value from public.app_settings where key = 'team_group_link')
   where (select value from public.app_settings where key = 'team_group_link') is not null
     and ((select yes from everything)
          or exists (select 1 from public.staff_roles r where lower(r.email::text) = lower(app.email()::text) and r.active)
          or exists (select 1 from public.committee_leaders c where c.volunteer_id = app.my_volunteer_id()))
  union all
  select 'لجنة', l.value, l.link
    from public.lookups l, everything
   where l.list = 'اللجنة' and l.is_active and nullif(btrim(l.link), '') is not null
     and (everything.yes or l.value in (select main_committee from me union select sub_committee from me))
  union all
  select case w.target when 'grade' then 'سنة' when 'group' then 'مجموعة' when 'slot' then 'حصة' else 'طلاب' end, w.name, w.link
    from students.whatsapp_groups w, everything
   where everything.yes
      or (w.target = 'slot' and w.slot_id in (select id from slots))
      or (w.target = 'grade' and exists (select 1 from students.audiences a where a.slot_id in (select id from slots) and a.target = 'grade' and a.grade = w.grade))
      or (w.target = 'group' and exists (select 1 from students.audiences a where a.slot_id in (select id from slots) and a.target = 'group' and a.group_id = w.group_id))
$$;
revoke all on function public.my_whatsapp_groups() from public, anon;
grant execute on function public.my_whatsapp_groups() to authenticated;

create or replace function public.set_joined_group(p_joined boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if app.my_volunteer_id() is null then
    raise exception 'الحساب ده مش مربوط بمتطوع' using errcode = '42501';
  end if;
  perform app.begin_internal();
  update public.volunteers set joined_group = p_joined where id = app.my_volunteer_id();
  perform app.end_internal();
end;
$$;
revoke all on function public.set_joined_group(boolean) from public, anon;
grant execute on function public.set_joined_group(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5) pauses for a group
-- ---------------------------------------------------------------------
alter table students.schedule_pauses add column if not exists group_id uuid references students.groups (id) on delete cascade;
drop policy if exists pauses_write on students.schedule_pauses;
create policy pauses_write on students.schedule_pauses for all to authenticated
  using ((select app.has_perm('students.review')) or (select app.has_perm('schedule.edit')) or (select app.has_perm('students.edit')))
  with check ((select app.has_perm('students.review')) or (select app.has_perm('schedule.edit')) or (select app.has_perm('students.edit')));

create or replace function students.is_paused(p_slot uuid, p_grade text, d date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from students.schedule_pauses p
     where d between p.from_date and p.to_date
       and (p.slot_id = p_slot
            or (p.slot_id is null and p.group_id is null and (
                 p.grade is null
                 or students.norm_grade(p.grade) = students.norm_grade(p_grade)
                 or exists (select 1 from students.audiences a
                             where a.slot_id = p_slot and a.target = 'grade'
                               and students.norm_grade(a.grade) = students.norm_grade(p.grade))))
            or (p.group_id is not null and exists (select 1 from students.audiences a
                                                    where a.slot_id = p_slot and a.target = 'group' and a.group_id = p.group_id))))
$$;

-- A new pause cancels the coming dated classes it covers (as before: families are told), now
-- following the class audience (grade / group). Removing a pause brings back the coming ones it cancelled.
create or replace function students.pause_cancels()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update students.class_sessions cs set status = 'اتلغت',
         notes = concat_ws(' · ', nullif(cs.notes, ''), 'إيقاف' || coalesce(': ' || new.reason, ''))
    from public.schedule_slots s
   where s.id = cs.slot_id and cs.status = 'متوقعة'
     and cs.on_date between new.from_date and new.to_date
     and students.is_paused(s.id, s.grade, cs.on_date);
  return null;
end;
$$;

create or replace function students.pause_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update students.class_sessions cs set status = 'متوقعة',
         notes = nullif(btrim(regexp_replace(coalesce(cs.notes, ''), '( · )?إيقاف(: [^·]*)?', '', 'g')), '')
    from public.schedule_slots s
   where s.id = cs.slot_id and cs.status = 'اتلغت'
     and cs.on_date between greatest(old.from_date, app.today()) and old.to_date
     and cs.notes like '%إيقاف%'
     and not students.is_paused(s.id, s.grade, cs.on_date);
  perform students.ensure_sessions(greatest(old.from_date, app.today()), least(old.to_date, app.today() + 14));
  return null;
end;
$$;
drop trigger if exists schedule_pauses_changed on students.schedule_pauses;
drop function if exists students.pause_changed();
drop trigger if exists schedule_pauses_removed on students.schedule_pauses;
create trigger schedule_pauses_removed after delete on students.schedule_pauses
  for each row execute function students.pause_removed();

-- ---------------------------------------------------------------------
-- 6) The log: page first, then names (the view worked out every row before sorting: 7s+)
-- ---------------------------------------------------------------------
create index if not exists audit_log_actor_idx on public.audit_log (actor_email, at desc);

create or replace function public.audit_feed(p_tables text[] default null, p_actor text default null,
                                             p_offset int default 0, p_limit int default 100)
returns table (id bigint, at timestamptz, actor_email text, actor_name text, table_name text, action text, record_id text,
               target_name text, target_volunteer_id uuid, target_student_id uuid, old_row jsonb, new_row jsonb)
language sql stable security definer set search_path = '' as $$
  with page as (
    select a.* from public.audit_log a
     where app.has_perm('log.view')
       and (p_tables is null or a.table_name = any (p_tables))
       and (p_actor is null or a.actor_email = p_actor)
     order by a.at desc, a.id desc
     limit least(coalesce(p_limit, 100), 300) offset greatest(coalesce(p_offset, 0), 0)
  )
  select a.id, a.at, a.actor_email,
         coalesce((select v.full_name_ar from public.volunteers v where lower(v.email::text) = lower(a.actor_email) limit 1),
                  (select s.full_name from public.staff_roles s where lower(s.email::text) = lower(a.actor_email) limit 1),
                  case when a.actor_email is null or a.actor_email = 'system' then 'السيستم' end,
                  a.actor_email),
         a.table_name, a.action, a.record_id,
         coalesce(tv.full_name_ar, ts.full_name,
                  coalesce(a.new_row, a.old_row) ->> 'full_name_ar', coalesce(a.new_row, a.old_row) ->> 'full_name'),
         tv.id, ts.id,
         app.redact(a.old_row), app.redact(a.new_row)
    from page a
    left join public.volunteers tv on tv.id::text = case
         when a.table_name in ('volunteers', 'volunteer_private', 'volunteer_hr', 'certificate_requests') then a.record_id
         when a.table_name in ('participations', 'schedule_slots', 'staff_roles', 'committee_leaders', 'volunteer_feedback', 'profile_requests')
           then coalesce(a.new_row, a.old_row) ->> 'volunteer_id' end
    left join students.students ts on ts.id::text = case
         when a.table_name = 'students' then a.record_id
         when a.table_name in ('student_private', 'phones', 'enrollments', 'applications', 'attendance', 'exam_results', 'flags',
                               'leaves', 'notes', 'care_notes', 'family_finance', 'feedback', 'group_members', 'change_requests')
           then coalesce(a.new_row, a.old_row) ->> 'student_id' end
   order by a.at desc, a.id desc
$$;
revoke all on function public.audit_feed(text[], text, int, int) from public, anon;
grant execute on function public.audit_feed(text[], text, int, int) to authenticated;

create or replace function public.audit_actors()
returns table (actor_email text, actor_name text)
language sql stable security definer set search_path = '' as $$
  select x.actor_email,
         coalesce((select v.full_name_ar from public.volunteers v where lower(v.email::text) = lower(x.actor_email) limit 1),
                  (select s.full_name from public.staff_roles s where lower(s.email::text) = lower(x.actor_email) limit 1),
                  case when x.actor_email = 'system' then 'السيستم' end, x.actor_email)
    from (select distinct a.actor_email from public.audit_log a where a.actor_email is not null and app.has_perm('log.view')) x
$$;
revoke all on function public.audit_actors() from public, anon;
grant execute on function public.audit_actors() to authenticated;

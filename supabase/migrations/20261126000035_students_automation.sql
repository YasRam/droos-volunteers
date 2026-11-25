-- =====================================================================
-- 35) Students: what happens by itself.
--
--  * Each weekly class (public.schedule_slots) makes a students.class_sessions row for every
--    week it runs: from starts_on, until ends_on or until it is stopped / cancelled, skipping
--    the pauses (exams). students.ensure_sessions() fills the coming days; the screens call it
--    and a daily job calls it too.
--  * Approved class requests apply themselves: cancel once, postpone, stop for a while,
--    cancel for good. Families of the class's students are told.
--  * Absences count per class (only classes that take attendance), over the whole term;
--    «معتذر» and leaves don't count. At «warn_after» the guardian and تنظيم are told and the
--    student shows «تحذير». At «dismiss_after» a dismissal request waits in الطلبات.
--    If the absences that reached the limit include two classes on the same day, تنظيم gets a
--    note to check (they can turn them into «معتذر» any time later).
--  * Taking attendance writes one participation for the teacher (or whoever taught in their
--    place) in the daily follow-up: event from the class, number of students = those present.
--    Later edits to the attendance update that same participation.
--  * Families get a notification for: an absence, a call-in, a note for the guardian, a grade,
--    a teacher's announcement, a new group, a cancelled / postponed class.
--
--  Changes to the volunteers' side: participations get rows written by the system
--  (auto_ref = 'session:<id>'), like interviews already do. Nothing else.
-- =====================================================================

alter table students.schedule_pauses add column if not exists slot_id uuid references public.schedule_slots (id) on delete cascade;
comment on column students.schedule_pauses.slot_id is 'إيقاف حصة واحدة (من طلب «إيقاف»). فاضي = حسب السنة أو كل الحصص.';

-- ---------------------------------------------------------------------
-- 1) Family notifications
-- ---------------------------------------------------------------------
-- The accounts that should hear about these students (guardian always; the student too unless only_guardian).
create or replace function students.family_emails(p_students uuid[], p_only_guardian boolean default false)
returns extensions.citext[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct a.login_email), '{}')
    from students.accounts a
    left join students.students s on a.kind = 'guardian' and s.guardian_id = a.guardian_id
   where (a.kind = 'guardian' and s.id = any (p_students))
      or (not p_only_guardian and a.kind = 'student' and a.student_id = any (p_students))
$$;

create or replace function students.notify_family(p_students uuid[], p_title text, p_body text, p_only_guardian boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r extensions.citext[] := students.family_emails(p_students, p_only_guardian);
begin
  if cardinality(r) > 0 then
    perform app.notify(r, p_title, p_body, '/family');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Sessions from the weekly classes
-- ---------------------------------------------------------------------
create or replace function students.weekday_ar(d date)
returns public.weekday_ar language sql immutable set search_path = '' as $$
  select ((array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'])[extract(dow from d)::int + 1])::public.weekday_ar
$$;

create or replace function students.is_paused(p_slot uuid, p_grade text, d date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from students.schedule_pauses p
     where d between p.from_date and p.to_date
       and (p.slot_id = p_slot
            or (p.slot_id is null and (p.grade is null or students.norm_grade(p.grade) = students.norm_grade(p_grade)))))
$$;

-- Makes the sessions of the coming days (and closes classes whose end date passed). Safe to call often.
create or replace function students.ensure_sessions(p_from date default null, p_to date default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  d0 date := coalesce(p_from, app.today() - 7);
  d1 date := least(coalesce(p_to, app.today() + 14), app.today() + 60);
  n int;
begin
  update public.schedule_slots set status = 'متوقفة'
   where status = 'شغالة' and ends_on is not null and ends_on < app.today();

  insert into students.class_sessions (slot_id, on_date, starts_at, ends_at, subject, kind, takes_attendance, teacher_ids, created_by)
  select s.id, d::date, s.starts_at, s.ends_at, s.subject,
         case when s.kind ilike '%امتحان%' then 'امتحان' else 'حصة' end,
         coalesce(s.takes_attendance, true),
         array_remove(array[s.volunteer_id] || coalesce(s.co_teachers, '{}'), null),
         'system'
    from public.schedule_slots s
    cross join generate_series(d0, d1, interval '1 day') d
   where s.status = 'شغالة'
     and s.starts_at is not null and s.ends_at is not null and s.ends_at > s.starts_at
     and s.day = students.weekday_ar(d::date)
     and (s.starts_on is null or d::date >= s.starts_on)
     and (s.ends_on is null or d::date <= s.ends_on)
     and not students.is_paused(s.id, s.grade, d::date)
     and exists (select 1 from students.audiences a where a.slot_id = s.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function students.ensure_sessions(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Approved requests apply themselves
-- ---------------------------------------------------------------------
create or replace function students.apply_slot_request()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_slots;
  sess students.class_sessions;
  moved uuid;
  kids uuid[];
  label text;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      new.reviewed_by := coalesce(app.email()::text, new.reviewed_by);
      new.reviewed_at := now();
    end if;
    return new;
  end if;
  new.reviewed_by := coalesce(app.email()::text, new.reviewed_by);
  new.reviewed_at := now();
  select * into s from public.schedule_slots where id = new.slot_id;
  kids := array(select students.class_student_ids(s.id, null));
  label := coalesce(s.subject, 'الحصة') || coalesce(' ' || s.grade, '');

  if new.kind in ('إلغاء مرة', 'تأجيل') then
    select * into sess from students.class_sessions where slot_id = s.id and on_date = new.on_date and status <> 'اتأجلت';
    if sess.id is null then
      insert into students.class_sessions (slot_id, on_date, starts_at, ends_at, subject, takes_attendance, teacher_ids, created_by)
      values (s.id, new.on_date, s.starts_at, s.ends_at, s.subject, coalesce(s.takes_attendance, true),
              array_remove(array[s.volunteer_id] || coalesce(s.co_teachers, '{}'), null), 'system')
      returning * into sess;
    end if;
  end if;

  if new.kind = 'إلغاء مرة' then
    update students.class_sessions set status = 'اتلغت' where id = sess.id;
    perform students.notify_family(kids, 'حصة اتلغت', label || ' يوم ' || to_char(new.on_date, 'DD/MM') || ' اتلغت.');
  elsif new.kind = 'تأجيل' then
    insert into students.class_sessions (slot_id, on_date, starts_at, ends_at, subject, kind, takes_attendance, teacher_ids, created_by)
    values (s.id, new.new_date, new.new_starts_at, new.new_ends_at, sess.subject, sess.kind, sess.takes_attendance, sess.teacher_ids, 'system')
    returning id into moved;
    insert into students.audiences (session_id, target, grade, group_id, student_id)
    select moved, a.target, a.grade, a.group_id, a.student_id from students.audiences a where a.slot_id = s.id;
    update students.class_sessions set status = 'اتأجلت', moved_to = moved where id = sess.id;
    perform students.notify_family(kids, 'حصة اتأجلت',
      label || ' بتاعة ' || to_char(new.on_date, 'DD/MM') || ' اتأجلت لـ ' || to_char(new.new_date, 'DD/MM') || ' الساعة ' || to_char(new.new_starts_at, 'HH12:MI'));
  elsif new.kind = 'إيقاف' then
    insert into students.schedule_pauses (from_date, to_date, reason, slot_id, created_by)
    values (new.pause_from, new.pause_to, coalesce(new.reason, 'إيقاف'), s.id, app.email()::text);
    update students.class_sessions set status = 'اتلغت'
     where slot_id = s.id and on_date between new.pause_from and new.pause_to and status = 'متوقعة';
    perform students.notify_family(kids, 'حصة متوقفة',
      label || ' متوقفة من ' || to_char(new.pause_from, 'DD/MM') || ' لـ ' || to_char(new.pause_to, 'DD/MM') || '.');
  elsif new.kind = 'إلغاء خالص' then
    update public.schedule_slots set status = 'اتلغت', ends_on = new.from_date - 1 where id = s.id;
    update students.class_sessions set status = 'اتلغت' where slot_id = s.id and on_date >= new.from_date and status = 'متوقعة';
    perform students.notify_family(kids, 'حصة اتلغت', label || ' اتلغت من ' || to_char(new.from_date, 'DD/MM') || '.');
  end if;
  return new;
end;
$$;
create trigger slot_requests_apply before update of status on students.slot_requests
  for each row execute function students.apply_slot_request();

-- A slot pause made directly (exams) cancels the expected sessions in it.
create or replace function students.pause_cancels()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update students.class_sessions cs set status = 'اتلغت'
    from public.schedule_slots s
   where s.id = cs.slot_id and cs.status = 'متوقعة'
     and cs.on_date between new.from_date and new.to_date
     and (new.slot_id = s.id or (new.slot_id is null and (new.grade is null or students.norm_grade(new.grade) = students.norm_grade(s.grade))));
  return null;
end;
$$;
create trigger schedule_pauses_cancel after insert on students.schedule_pauses
  for each row execute function students.pause_cancels();

-- ---------------------------------------------------------------------
-- 4) The attendance sheet of a session
-- ---------------------------------------------------------------------
-- Every student of the session with the mark to suggest: what's recorded, else إجازة / فصل مؤقت.
create or replace function students.session_roster(p_session uuid)
returns table (student_id uuid, full_name text, grade text, mark text, note text, suggested text,
               call_in boolean, score numeric)
language sql stable security definer set search_path = '' as $$
  with sess as (select * from students.class_sessions where id = p_session),
  ids as (
    select x as id from sess, students.class_student_ids(sess.slot_id, null) x where sess.slot_id is not null
    union
    select x from sess, students.class_student_ids(null, sess.id) x
    union
    select a.student_id from students.attendance a where a.session_id = p_session
  )
  select s.id, s.full_name, e.grade, a.mark, a.note,
         case when exists (select 1 from students.flags f, sess where f.student_id = s.id and f.kind = 'فصل مؤقت'
                             and f.lifted_at is null and sess.on_date between f.from_date and f.to_date) then 'فصل مؤقت'
              when exists (select 1 from students.leaves l, sess where l.student_id = s.id
                             and sess.on_date between l.from_date and l.to_date) then 'إجازة'
         end,
         exists (select 1 from students.flags f where f.student_id = s.id and f.kind = 'استدعاء' and f.lifted_at is null),
         r.score
    from ids
    join students.students s on s.id = ids.id
    left join students.enrollments e on e.student_id = s.id and e.term_id = students.current_term()
    left join students.attendance a on a.student_id = s.id and a.session_id = p_session
    left join students.exam_results r on r.student_id = s.id and r.session_id = p_session
   where students.is_my_session(p_session) or app.has_perm('students.attendance') or app.has_perm('students.view_all')
   order by s.full_name
$$;
grant execute on function students.session_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) After attendance: the session's count, the teacher's participation, absences
-- ---------------------------------------------------------------------
create or replace function students.absences(p_student uuid, p_term uuid default null)
returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from students.attendance a
    join students.attendance_marks m on m.code = a.mark and m.counts_absence
    join students.class_sessions cs on cs.id = a.session_id and cs.takes_attendance and cs.status <> 'اتلغت'
    join students.terms t on t.id = coalesce(p_term, students.current_term())
   where a.student_id = p_student and cs.on_date between t.starts_on and t.ends_on
$$;
grant execute on function students.absences(uuid, uuid) to authenticated;

-- One participation per session in the daily follow-up (the teacher, or whoever taught instead).
create or replace function students.sync_participation(p_session uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  cs students.class_sessions;
  s public.schedule_slots;
  ref text := 'session:' || p_session;
  ev text;
  present int;
  who uuid[];
begin
  select * into cs from students.class_sessions where id = p_session;
  perform app.begin_internal();
  delete from public.participations where auto_ref = ref;
  if cs.id is not null and cs.attendance_at is not null and cs.status <> 'اتلغت' then
    select * into s from public.schedule_slots where id = cs.slot_id;
    select count(*) filter (where m.is_present) into present
      from students.attendance a join students.attendance_marks m on m.code = a.mark where a.session_id = cs.id;
    update students.class_sessions set present_count = present where id = cs.id and present_count is distinct from present;
    ev := case when cs.kind = 'امتحان' then 'امتحان شهري'
               when s.kind ilike '%تأسيس%' then 'تأسيس'
               when s.kind ilike '%ورشة%' then 'ورشة فنية'
               else 'تدريس' end;
    who := case when cs.substitute_id is not null then array[cs.substitute_id] else cs.teacher_ids end;
    insert into public.participations (volunteer_id, activity_date, event, subject, grade, place, beneficiaries, status, method,
                                       auto_ref, created_by, reviewed_by, reviewed_at)
    select v, cs.on_date, ev, cs.subject, s.grade, coalesce(s.place, 'الفرع'), nullif(present, 0), 'accepted', 'group',
           ref, cs.attendance_by, cs.attendance_by, now()
      from unnest(who) v
    on conflict do nothing;
  end if;
  perform app.end_internal();
end;
$$;

create or replace function students.after_attendance()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := coalesce(new.session_id, old.session_id);
  stu uuid := coalesce(new.student_id, old.student_id);
  cs students.class_sessions;
  st students.settings;
  enr students.enrollments;
  n int;
  same_day boolean;
  label text;
begin
  select * into cs from students.class_sessions where id = sid;
  -- the session is «done» once attendance is taken
  update students.class_sessions
     set attendance_at = coalesce(attendance_at, now()), attendance_by = coalesce(attendance_by, app.email()::text),
         status = case when status = 'متوقعة' then 'اتعملت' else status end
   where id = sid;
  perform students.sync_participation(sid);

  select * into st from students.settings;
  select * into enr from students.enrollments where student_id = stu and term_id = students.current_term();
  if enr.id is null then
    return null;
  end if;
  label := coalesce(cs.subject, 'الحصة') || ' يوم ' || to_char(cs.on_date, 'DD/MM');

  -- tell the guardian about a new absence
  if tg_op <> 'DELETE' and cs.takes_attendance
     and exists (select 1 from students.attendance_marks m where m.code = new.mark and m.counts_absence)
     and (tg_op = 'INSERT' or old.mark is distinct from new.mark) then
    perform students.notify_family(array[stu], 'غياب', (select full_name from students.students where id = stu) || ' غاب ' || label || '.', true);
  end if;

  n := students.absences(stu);
  if n >= st.dismiss_after then
    if not exists (select 1 from students.dismissal_requests where enrollment_id = enr.id and status in ('pending', 'approved')) then
      select exists (
        select 1 from students.attendance a
          join students.attendance_marks m on m.code = a.mark and m.counts_absence
          join students.class_sessions x on x.id = a.session_id and x.takes_attendance and x.status <> 'اتلغت'
         where a.student_id = stu group by x.on_date having count(*) > 1) into same_day;
      insert into students.dismissal_requests (enrollment_id, absences, review_note)
      values (enr.id, n, case when same_day then 'فيه أكتر من حصة غياب في نفس اليوم، راجعها' end);
      perform app.notify(app.emails_with('students.review'), 'طلب فصل طالب',
        (select full_name from students.students where id = stu) || ' وصل ' || n || ' غياب' ||
        case when same_day then ' (منهم حصص في نفس اليوم)' else '' end, '/students/requests');
    end if;
  elsif n >= st.warn_after then
    if enr.status = 'نشط' then
      update students.enrollments set status = 'تحذير', status_note = n || ' غياب', status_at = now() where id = enr.id;
      perform students.notify_family(array[stu], 'تحذير غياب',
        (select full_name from students.students where id = stu) || ' غاب ' || n || ' حصص. لو الغياب كمّل هيتفصل.', true);
      perform app.notify(app.emails_with('students.view_all'), 'تحذير غياب',
        (select full_name from students.students where id = stu) || ' وصل ' || n || ' غياب', '/students');
    end if;
  else
    -- absences turned into «معتذر» later: back to normal, and a waiting dismissal is dropped
    if enr.status = 'تحذير' then
      update students.enrollments set status = 'نشط', status_note = null, status_at = now() where id = enr.id;
    end if;
    update students.dismissal_requests set status = 'rejected', review_note = 'الغياب قل عن الحد', reviewed_at = now()
     where enrollment_id = enr.id and status = 'pending';
  end if;
  return null;
end;
$$;
create trigger attendance_after after insert or update or delete on students.attendance
  for each row execute function students.after_attendance();

-- Who taught instead / cancelled after the fact: the participation follows.
create or replace function students.after_session_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.substitute_id is distinct from old.substitute_id or new.status is distinct from old.status
     or new.teacher_ids is distinct from old.teacher_ids or new.kind is distinct from old.kind then
    perform students.sync_participation(new.id);
  end if;
  return null;
end;
$$;
create trigger class_sessions_after_change after update on students.class_sessions
  for each row execute function students.after_session_change();

-- A decided dismissal closes the enrollment.
create or replace function students.dismissal_decided()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    update students.enrollments set status = 'مفصول', status_note = new.absences || ' غياب', status_at = now(), status_by = app.email()::text
     where id = new.enrollment_id;
    perform students.notify_family(array[(select student_id from students.enrollments where id = new.enrollment_id)],
      'فصل من النشاط', 'تم فصل ' || (select s.full_name from students.students s join students.enrollments e on e.student_id = s.id
                                     where e.id = new.enrollment_id) || ' بسبب الغياب.', true);
  end if;
  if new.status <> old.status then
    new.reviewed_by := coalesce(app.email()::text, new.reviewed_by);
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;
  return new;
end;
$$;
create trigger dismissal_requests_decided before update of status on students.dismissal_requests
  for each row execute function students.dismissal_decided();

-- ---------------------------------------------------------------------
-- 6) The other family notifications
-- ---------------------------------------------------------------------
create or replace function students.notify_on_insert()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
begin
  if tg_table_name = 'flags' then
    if new.kind = 'استدعاء' then
      perform students.notify_family(array[new.student_id], 'استدعاء ولي أمر',
        'مطلوب حضور ولي أمر ' || (select full_name from students.students where id = new.student_id) || ' للنشاط. السبب: ' || new.reason, true);
    end if;
  elsif tg_table_name = 'notes' then
    if new.for_guardian then
      perform students.notify_family(array[new.student_id], 'ملاحظة من النشاط', new.body, true);
    end if;
  elsif tg_table_name = 'exam_results' then
    perform students.notify_family(array[new.student_id], 'درجة امتحان',
      (select coalesce(subject, 'الامتحان') || ' يوم ' || to_char(on_date, 'DD/MM') || ': ' || new.score ||
              coalesce(' من ' || max_score, '') from students.class_sessions where id = new.session_id));
  elsif tg_table_name = 'group_members' then
    perform students.notify_family(array[new.student_id], 'مجموعة جديدة',
      'اتضاف لمجموعة «' || (select name from students.groups where id = new.group_id) || '».');
  elsif tg_table_name = 'announcements' then
    who := coalesce((select v.full_name_ar from public.volunteers v where v.email = new.created_by), 'النشاط');
    perform students.notify_family(array(
      select distinct x from (
        select students.class_student_ids(new.slot_id, new.session_id) x where new.target in ('slot', 'session')
        union all select gm.student_id from students.group_members gm where new.target = 'group' and gm.group_id = new.group_id
        union all select e.student_id from students.enrollments e where e.term_id = students.current_term()
                    and e.status in ('نشط', 'تحذير') and (new.target = 'all' or (new.target = 'grade' and e.grade = new.grade))
      ) t), 'تنبيه من ' || who, new.body);
  end if;
  return null;
end;
$$;
create trigger flags_notify after insert on students.flags for each row execute function students.notify_on_insert();
create trigger notes_notify after insert on students.notes for each row execute function students.notify_on_insert();
create trigger exam_results_notify after insert on students.exam_results for each row execute function students.notify_on_insert();
create trigger group_members_notify after insert on students.group_members for each row execute function students.notify_on_insert();
create trigger announcements_notify after insert on students.announcements for each row execute function students.notify_on_insert();

-- ---------------------------------------------------------------------
-- 7) Daily: the coming sessions
-- ---------------------------------------------------------------------
do $$ begin
  perform cron.schedule('students-sessions', '15 4 * * *', $c$select students.ensure_sessions()$c$);
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- 8) Data entry without seeing the sensitive part
-- ---------------------------------------------------------------------
-- Whoever adds students (students.edit) writes the national ID and family data on the form,
-- even without students.view_sensitive; reading and changing it later still needs it.
drop policy if exists private_write on students.student_private;
create policy private_insert on students.student_private for insert to authenticated
  with check ((select app.has_perm('students.edit')));
create policy private_update on students.student_private for update to authenticated
  using ((select app.has_perm('students.edit')) and (select app.has_perm('students.view_sensitive')));
create policy private_delete on students.student_private for delete to authenticated
  using ((select app.has_perm('students.edit')) and (select app.has_perm('students.view_sensitive')));

-- Is this national ID already a student? (the form checks before adding)
create or replace function students.student_by_national_id(p_nid text)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name from students.student_private p join students.students s on s.id = p.student_id
   where app.has_perm('students.edit') and p.national_id = p_nid
$$;

-- An existing guardian with this national ID: brothers and sisters share one guardian (and account).
create or replace function students.guardian_by_national_id(p_nid text)
returns table (id uuid, full_name text, relation text, children text[])
language sql stable security definer set search_path = '' as $$
  select g.id, g.full_name, g.relation,
         array(select s.full_name from students.students s where s.guardian_id = g.id order by s.full_name)
    from students.guardians g
   where app.has_perm('students.edit') and g.national_id = p_nid
$$;
grant execute on function students.student_by_national_id(text), students.guardian_by_national_id(text) to authenticated;

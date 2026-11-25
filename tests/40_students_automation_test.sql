-- Students automation: weekly sessions, absences, the follow-up participation, requests.
\set ON_ERROR_STOP 1

create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- a fresh term so earlier test files don't count
update students.terms set is_current = false;
insert into students.terms (id, name, starts_on, ends_on, is_current)
  values ('f1000000-0000-0000-0000-000000000000', 'ترم الاختبار', app.today() - 60, app.today() + 60, true);

insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at) values
  ('A9001', 'مدرس الآلي', '01000000301', 'auto-teacher@test.com', 'تدريس', 'تحت المتابعة', now()),
  ('A9002', 'بديل الآلي', '01000000302', 'auto-sub@test.com', 'تدريس', 'تحت المتابعة', now());
insert into students.guardians (id, full_name, national_id, phone) values ('a9000000-0000-0000-0000-000000000000', 'ولي أمر آلي', '27001010101011', '01100000009');
insert into students.students (id, full_name, guardian_id) values ('b9000000-0000-0000-0000-000000000000', 'طالب آلي', 'a9000000-0000-0000-0000-000000000000');
insert into students.accounts (user_id, kind, guardian_id, login_email)
  values ('c9000000-0000-0000-0000-000000000000', 'guardian', 'a9000000-0000-0000-0000-000000000000', '201100000009@family.droos');
insert into students.applications (student_id, term_id, grade, status) values
  ('b9000000-0000-0000-0000-000000000000', 'f1000000-0000-0000-0000-000000000000', '6 ب', 'مقبول');

-- a weekly 6 ب class on today's weekday
insert into schedule_slots (id, day, grade, subject, starts_at, ends_at, volunteer_id, kind, place)
  select 'd9000000-0000-0000-0000-000000000000', students.weekday_ar(app.today()), '6ب', 'علوم', '16:00', '17:00', id, 'حصة', 'الفرع'
    from volunteers where code = 'A9001';
select students.ensure_sessions(app.today() - 28, app.today());
select t.ok((select count(*) from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000') = 0, 'a class for nobody makes no sessions');
insert into students.audiences (slot_id, target, grade) values ('d9000000-0000-0000-0000-000000000000', 'grade', '6 ب');
select students.ensure_sessions(app.today() - 28, app.today());
select t.ok((select count(*) from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000') = 5, 'one session a week for the last 5 weeks');
select students.ensure_sessions(app.today() - 28, app.today());
select t.ok((select count(*) from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000') = 5, 'running it again adds nothing');

insert into students.schedule_pauses (from_date, to_date, reason, grade) values (app.today() + 7, app.today() + 7, 'امتحانات', '6 ب');
select students.ensure_sessions(app.today() + 1, app.today() + 14);
select t.ok((select count(*) from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date > app.today()) = 1,
            'a paused week is skipped');

select set_config('request.jwt.claims', '{"email":"auto-teacher@test.com","role":"authenticated"}', false);
select t.ok((select count(*) from students.session_roster(
  (select id from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today()))) = 1,
  'the roster has the grade''s student');

-- attendance → participation
select set_config('request.jwt.claims', '{"email":"auto-teacher@test.com","role":"authenticated"}', false);
insert into students.attendance (session_id, student_id, mark)
  select id, 'b9000000-0000-0000-0000-000000000000', 'حاضر' from students.class_sessions
   where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today() - 28;
select t.ok((select count(*) from participations where auto_ref like 'session:%' and event = 'تدريس'
              and volunteer_id = (select id from volunteers where code = 'A9001')) = 1, 'taking attendance writes the teacher''s participation');
select t.ok((select beneficiaries from participations where auto_ref like 'session:%' and volunteer_id = (select id from volunteers where code = 'A9001')) = 1,
            'the participation counts the students present');
select t.ok((select status from students.class_sessions where on_date = app.today() - 28 and slot_id = 'd9000000-0000-0000-0000-000000000000') = 'اتعملت',
            'the session is marked done');
update students.class_sessions set substitute_id = (select id from volunteers where code = 'A9002')
 where on_date = app.today() - 28 and slot_id = 'd9000000-0000-0000-0000-000000000000';
select t.ok((select v.code from participations p join volunteers v on v.id = p.volunteer_id where p.auto_ref like 'session:%' and v.code like 'A900%') = 'A9002',
            'the participation moves to whoever taught instead');

-- absences: 3 → warning, 5 → dismissal request
insert into students.attendance (session_id, student_id, mark)
  select id, 'b9000000-0000-0000-0000-000000000000', 'غائب' from students.class_sessions
   where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date in (app.today() - 21, app.today() - 14, app.today() - 7);
select t.ok(students.absences('b9000000-0000-0000-0000-000000000000') = 3, 'three absences counted');
select t.ok((select status from students.enrollments where student_id = 'b9000000-0000-0000-0000-000000000000') = 'تحذير', 'three absences → warning');
select t.ok((select count(*) from notifications where recipient_email = '201100000009@family.droos' and title = 'تحذير غياب') = 1, 'the guardian is warned');
select t.ok((select count(*) from notifications where recipient_email = '201100000009@family.droos' and title = 'غياب') = 3, 'the guardian hears of each absence');

insert into students.class_sessions (id, on_date, starts_at, ends_at, subject)
  values ('e9000000-0000-0000-0000-000000000000', app.today() - 7, '18:00', '19:00', 'رياضيات');
insert into students.audiences (session_id, target, student_id) values ('e9000000-0000-0000-0000-000000000000', 'student', 'b9000000-0000-0000-0000-000000000000');
insert into students.attendance (session_id, student_id, mark) values ('e9000000-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-000000000000', 'غائب');
insert into students.attendance (session_id, student_id, mark)
  select id, 'b9000000-0000-0000-0000-000000000000', 'غائب' from students.class_sessions
   where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today();
select t.ok((select count(*) from students.dismissal_requests where status = 'pending') = 1, 'five absences → a dismissal request');
select t.ok((select review_note is not null from students.dismissal_requests where status = 'pending'), 'two absences on one day are flagged');
select t.ok((select status from students.enrollments where student_id = 'b9000000-0000-0000-0000-000000000000') = 'تحذير', 'not dismissed before approval');

update students.attendance set mark = 'معتذر' where session_id = 'e9000000-0000-0000-0000-000000000000';
update students.attendance set mark = 'معتذر' where session_id = (select id from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today());
update students.attendance set mark = 'معتذر' where session_id = (select id from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today() - 7);
select t.ok((select count(*) from students.dismissal_requests where status = 'pending') = 0, 'excusing absences later drops the request');
select t.ok((select status from students.enrollments where student_id = 'b9000000-0000-0000-0000-000000000000') = 'نشط', 'and the warning');

-- requests
insert into students.slot_requests (slot_id, kind, on_date, requested_by) values ('d9000000-0000-0000-0000-000000000000', 'إلغاء مرة', app.today() + 14, 'auto-teacher@test.com');
insert into students.slot_requests (slot_id, kind, on_date, new_date, new_starts_at, new_ends_at, requested_by)
  values ('d9000000-0000-0000-0000-000000000000', 'تأجيل', app.today() + 21, app.today() + 22, '17:00', '18:00', 'auto-teacher@test.com');
select set_config('request.jwt.claims', '', false);
update students.slot_requests set status = 'approved' where slot_id = 'd9000000-0000-0000-0000-000000000000';
select t.ok((select status from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today() + 14) = 'اتلغت', 'cancel once');
select t.ok((select status from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today() + 21) = 'اتأجلت', 'postponed');
select t.ok((select count(*) from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date = app.today() + 22) = 1, 'the new session exists');
select t.ok((select count(*) from notifications where recipient_email = '201100000009@family.droos' and title in ('حصة اتلغت', 'حصة اتأجلت')) = 2,
            'the family is told');

insert into students.slot_requests (slot_id, kind, from_date, requested_by) values ('d9000000-0000-0000-0000-000000000000', 'إلغاء خالص', app.today() + 28, 'x@test.com');
update students.slot_requests set status = 'approved' where kind = 'إلغاء خالص';
select t.ok((select status from schedule_slots where id = 'd9000000-0000-0000-0000-000000000000') = 'اتلغت', 'cancelled for good');
select students.ensure_sessions(app.today() + 28, app.today() + 50);
select t.ok((select count(*) from students.class_sessions where slot_id = 'd9000000-0000-0000-0000-000000000000' and on_date >= app.today() + 28 and status <> 'اتلغت') = 0, 'no sessions after cancelling');

-- other notifications
insert into students.notes (student_id, body, for_guardian) values ('b9000000-0000-0000-0000-000000000000', 'شاطر', true);
insert into students.flags (student_id, kind, reason) values ('b9000000-0000-0000-0000-000000000000', 'استدعاء', 'شغب');
select t.ok((select count(*) from notifications where recipient_email = '201100000009@family.droos' and title in ('ملاحظة من النشاط', 'استدعاء ولي أمر')) = 2,
            'notes and call-ins reach the guardian');

select 'ALL AUTOMATION TESTS PASSED';

-- Students tests: who sees which student, and the wall around family accounts.
\set ON_ERROR_STOP 1

create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create or replace function t.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL (no error): %', msg;
end $$;
create or replace function t.as(email text, uid uuid default null) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('email', email, 'role', 'authenticated', 'sub', uid)::text, true)
$$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- ids used below
--   guardian 1 / 2    a1… / a2…      student A (4 ب) / B (5 ب)   b1… / b2…
--   guardian user     c1…            student A user              c2…
-- ---------- fixtures ----------
insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at) values
  ('S9001', 'مدرس الرابع', '01000000101', 'teacher@test.com', 'تدريس', 'تحت المتابعة', now()),
  ('S9002', 'متطوع مش مدرس', '01000000102', 'other@test.com', 'ميديا', 'تحت المتابعة', now()),
  ('S9003', 'مدرس بديل', '01000000103', 'sub@test.com', 'تدريس', 'تحت المتابعة', now());
insert into staff_roles (email, full_name, role) values
  ('s-admin@test.com', 'أدمن', 'admin'),
  ('s-org@test.com', 'تنظيم', 'organizer'),
  ('s-mgmt@test.com', 'إدارة', 'management'),
  ('s-lead@test.com', 'ليدر', 'activity_leader');

insert into students.terms (name, starts_on, ends_on, is_current) values ('الترم الأول', '2026-09-01', '2027-01-31', true);

insert into students.guardians (id, full_name, relation, national_id, phone) values
  ('a1000000-0000-0000-0000-000000000000', 'ولي أمر أ', 'أب', '28001010101010', '01100000001'),
  ('a2000000-0000-0000-0000-000000000000', 'ولي أمر ب', 'أم', '28502020202020', '01100000002');
insert into students.students (id, full_name, guardian_id) values
  ('b1000000-0000-0000-0000-000000000000', 'طالب أ', 'a1000000-0000-0000-0000-000000000000'),
  ('b2000000-0000-0000-0000-000000000000', 'طالب ب', 'a2000000-0000-0000-0000-000000000000');
insert into students.student_private (student_id, national_id, address, family_income) values
  ('b1000000-0000-0000-0000-000000000000', '31609150201234', 'عنوان أ', '1200 ج'),
  ('b2000000-0000-0000-0000-000000000000', '31702200201245', 'عنوان ب', '900 ج');
insert into students.phones (student_id, number, is_whatsapp) values
  ('b1000000-0000-0000-0000-000000000000', '01200000001', true),
  ('b2000000-0000-0000-0000-000000000000', '01200000002', true);

select t.ok((select birth_date from students.students where full_name = 'طالب أ') = '2016-09-15', 'birth date from national id');
select t.ok((select gender from students.students where full_name = 'طالب أ') = 'ذكر', 'gender from national id (odd 13th digit)');
select t.ok((select gender from students.students where full_name = 'طالب ب') = 'أنثى', 'gender from national id (even 13th digit)');
select t.fails($$update students.student_private set mother_national_id = '28001010101010', father_national_id = '28001010101010'
                 where student_id = 'b1000000-0000-0000-0000-000000000000'$$, 'mother id cannot equal father id');

insert into students.applications (student_id, term_id, grade, status)
  select 'b1000000-0000-0000-0000-000000000000', id, '4 ب', 'انتظار' from students.terms;
insert into students.applications (student_id, term_id, grade, status)
  select 'b2000000-0000-0000-0000-000000000000', id, '5 ب', 'مقبول' from students.terms;
select t.ok((select count(*) from students.enrollments) = 1, 'only the accepted application is enrolled');
update students.applications set status = 'مقبول' where student_id = 'b1000000-0000-0000-0000-000000000000';
select t.ok((select count(*) from students.enrollments) = 2, 'accepting enrolls the student');

-- a weekly 4 ب class taught by S9001
insert into schedule_slots (id, day, grade, subject, starts_at, ends_at, volunteer_id)
  select 'd1000000-0000-0000-0000-000000000000', 'الأحد', '4 ب', 'لغة عربية', '16:00', '17:00', id from volunteers where code = 'S9001';
insert into students.audiences (slot_id, target, grade) values ('d1000000-0000-0000-0000-000000000000', 'grade', '4 ب');
insert into students.class_sessions (id, slot_id, on_date, starts_at, ends_at, subject, teacher_ids)
  select 'e1000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000000', '2026-11-22', '16:00', '17:00', 'لغة عربية', array[id]
    from volunteers where code = 'S9001';
-- a one-off 5 ب session S9001 doesn't teach
insert into students.class_sessions (id, on_date, starts_at, ends_at, subject)
  values ('e2000000-0000-0000-0000-000000000000', '2026-11-23', '16:00', '17:00', 'رياضيات');
insert into students.audiences (session_id, target, grade) values ('e2000000-0000-0000-0000-000000000000', 'grade', '5 ب');

-- family accounts (made by the edge function in real life)
insert into students.accounts (user_id, kind, guardian_id, login_email) values
  ('c1000000-0000-0000-0000-000000000000', 'guardian', 'a1000000-0000-0000-0000-000000000000', '201100000001@family.droos');
insert into students.accounts (user_id, kind, student_id, login_email) values
  ('c2000000-0000-0000-0000-000000000000', 'student', 'b1000000-0000-0000-0000-000000000000', 'carnet-1@family.droos');
insert into students.notes (student_id, body, for_guardian) values
  ('b1000000-0000-0000-0000-000000000000', 'ملاحظة لولي الأمر', true),
  ('b1000000-0000-0000-0000-000000000000', 'ملاحظة داخلية', false);
insert into students.flags (student_id, kind, reason) values ('b1000000-0000-0000-0000-000000000000', 'استدعاء', 'شغب');

-- ---------- teacher ----------
begin;
set local role authenticated;
select t.as('teacher@test.com');
select t.ok((select count(*) from students.students) = 1, 'teacher sees the students of their class only');
select t.ok((select full_name from students.students) = 'طالب أ', 'teacher sees student A');
select t.ok((select count(*) from students.student_private) = 0, 'teacher sees no private data');
select t.ok((select count(*) from students.phones) = 0, 'teacher sees no phones');
select t.ok((select count(*) from students.guardians) = 0, 'teacher sees no guardians');
insert into students.attendance (session_id, student_id, mark) values
  ('e1000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'حاضر');
select t.ok((select count(*) from students.attendance) = 1, 'teacher records attendance for their session');
select t.fails($$insert into students.attendance (session_id, student_id, mark) values
  ('e2000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000000', 'حاضر')$$, 'teacher cannot record another class');
update students.students set full_name = 'x' where id = 'b1000000-0000-0000-0000-000000000000';
select t.ok((select full_name from students.students where id = 'b1000000-0000-0000-0000-000000000000') = 'طالب أ', 'teacher cannot edit students');
insert into students.announcements (body, target, slot_id, created_by)
  values ('هاتوا كتاب القراءة بكرة', 'slot', 'd1000000-0000-0000-0000-000000000000', 'teacher@test.com');
select t.fails($$insert into students.announcements (body, target, grade, created_by) values ('x', 'grade', '5 ب', 'teacher@test.com')$$,
               'teacher cannot announce to a grade');
insert into students.slot_requests (slot_id, kind, on_date) values ('d1000000-0000-0000-0000-000000000000', 'إلغاء مرة', '2026-11-29');
select t.ok((select count(*) from students.slot_requests) = 1, 'teacher asks to cancel their class once');
select t.ok(not app.is_family(), 'a volunteer is not a family account');
commit;

-- ---------- substitute ----------
update students.class_sessions set substitute_id = (select id from volunteers where code = 'S9003')
 where id = 'e2000000-0000-0000-0000-000000000000';
begin;
set local role authenticated;
select t.as('sub@test.com');
select t.ok((select count(*) from students.students) = 1 and (select full_name from students.students) = 'طالب ب',
            'substitute sees the students of the session they taught');
insert into students.attendance (session_id, student_id, mark) values
  ('e2000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000000', 'غائب');
rollback;

-- ---------- volunteer with no class ----------
begin;
set local role authenticated;
select t.as('other@test.com');
select t.ok((select count(*) from students.students) = 0, 'other volunteers see no students');
select t.ok((select count(*) from students.attendance) = 0, 'other volunteers see no attendance');
select t.fails($$insert into students.slot_requests (slot_id, kind, on_date) values ('d1000000-0000-0000-0000-000000000000', 'إلغاء مرة', '2026-11-29')$$,
               'other volunteers cannot ask about a class that is not theirs');
rollback;

-- ---------- تنظيم ----------
begin;
set local role authenticated;
select t.as('s-org@test.com');
select t.ok((select count(*) from students.students) = 2, 'organizer sees every student');
select t.ok((select count(*) from students.phones) = 0, 'organizer sees no phones');
select t.ok((select count(*) from students.student_private) = 0, 'organizer sees no private data');
update students.slot_requests set status = 'approved', reviewed_by = 's-org@test.com';
select t.ok((select status from students.slot_requests) = 'approved', 'organizer approves a class request');
insert into students.attendance (session_id, student_id, mark) values
  ('e2000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000000', 'معتذر');
update students.flags set guardian_came_on = '2026-11-24', lifted_at = now();
select t.ok((select lifted_at is not null from students.flags), 'organizer clears a call-in when the guardian came');
insert into students.flags (student_id, kind, reason, to_date) values ('b2000000-0000-0000-0000-000000000000', 'فصل مؤقت', 'شغب', '2026-12-31');
select t.fails($$update students.flags set lifted_at = now() where kind = 'فصل مؤقت'$$, 'organizer cannot end a temporary dismissal');
rollback;

-- ---------- الإدارة ----------
begin;
set local role authenticated;
select t.as('s-mgmt@test.com');
select t.ok((select count(*) from students.phones) = 2, 'management sees phones');
select t.ok((select count(*) from students.guardians) = 2, 'management sees guardians');
select t.ok((select count(*) from students.student_private) = 0, 'management does not see national ids or income');
rollback;

-- ---------- الليدر ----------
begin;
set local role authenticated;
select t.as('s-lead@test.com');
select t.ok((select count(*) from students.student_private) = 2, 'leader sees private data');
update students.flags set lifted_at = now(), lifted_by = 's-lead@test.com';
select t.ok((select count(*) from students.flags where lifted_at is not null) = 1, 'leader lifts a flag');
rollback;

-- ---------- guardian ----------
begin;
set local role authenticated;
select t.as('201100000001@family.droos', 'c1000000-0000-0000-0000-000000000000');
select t.ok(app.is_family(), 'guardian is a family account');
select t.ok((select count(*) from students.students) = 1 and (select full_name from students.students) = 'طالب أ', 'guardian sees their child only');
select t.ok((select count(*) from students.student_private) = 1, 'guardian sees their child''s data');
select t.ok((select count(*) from students.phones) = 1, 'guardian sees their child''s phones');
select t.ok((select count(*) from students.guardians) = 1, 'guardian sees themself');
select t.ok((select count(*) from students.attendance) = 1, 'guardian sees their child''s attendance');
select t.ok((select count(*) from students.notes) = 1, 'guardian sees only notes meant for them');
select t.ok((select count(*) from students.flags) = 1, 'guardian sees the call-in');
select t.ok((select count(*) from students.announcements) = 1, 'guardian sees the class announcement');
select t.ok((select count(*) from students.class_sessions) = 1, 'guardian sees their child''s classes only');
select t.ok((select count(*) from students.settings) = 0, 'guardian does not see the absence limits');
select t.ok((select count(*) from students.org_info) = 1, 'guardian sees the association page');
select t.ok((select count(*) from public.volunteers) = 0, 'guardian sees no volunteers');
update students.students set full_name = 'x' where id = 'b1000000-0000-0000-0000-000000000000';
select t.ok((select full_name from students.students) = 'طالب أ', 'guardian cannot edit directly');
delete from students.notes;
select t.ok((select count(*) from students.notes) = 1, 'guardian cannot delete anything');
insert into students.change_requests (student_id, changes)
  values ('b1000000-0000-0000-0000-000000000000', '{"address": {"old": "عنوان أ", "new": "عنوان جديد"}}');
select t.fails($$insert into students.change_requests (student_id, changes) values ('b2000000-0000-0000-0000-000000000000', '{}')$$,
               'guardian cannot ask about someone else''s child');
-- the API wall
select set_config('request.headers', '{"accept-profile":"students"}', true), set_config('request.path', '/students', true);
select app.pre_request();
select t.ok(true, 'guardian reaches the students schema');
select set_config('request.headers', '{}', true), set_config('request.path', '/notifications', true);
select app.pre_request();
select t.ok(true, 'guardian reaches their notifications');
select set_config('request.path', '/volunteers', true);
select t.fails($$select app.pre_request()$$, 'guardian is refused the volunteers table');
select set_config('request.path', '/rpc/export_backup', true);
select t.fails($$select app.pre_request()$$, 'guardian is refused the volunteers'' functions');
select t.fails($$insert into storage.objects (bucket_id, name) values ('id-cards', 'x/y.jpg')$$, 'guardian cannot upload to volunteers'' buckets');
rollback;

-- ---------- student ----------
begin;
set local role authenticated;
select t.as('carnet-1@family.droos', 'c2000000-0000-0000-0000-000000000000');
select t.ok((select count(*) from students.students) = 1, 'student sees themself');
select t.ok((select count(*) from students.student_private) = 0, 'student does not see the family''s data');
select t.ok((select count(*) from students.flags) = 0, 'student does not see flags');
select t.ok((select count(*) from students.notes) = 0, 'student does not see notes');
select t.ok((select count(*) from students.attendance) = 1, 'student sees their attendance');
select t.fails($$insert into students.change_requests (student_id, changes) values ('b1000000-0000-0000-0000-000000000000', '{}')$$,
               'student cannot ask for changes');
rollback;

-- ---------- volunteers are not touched by the wall ----------
begin;
set local role authenticated;
select t.as('teacher@test.com');
select set_config('request.headers', '{}', true), set_config('request.path', '/volunteers', true);
select app.pre_request();
select t.ok(true, 'volunteers pass the wall');
rollback;

-- ---------- backup round trip ----------
select set_config('request.jwt.claims', '{"email":"s-admin@test.com","role":"authenticated"}', false);
create temp table _snap as select export_backup() as b;
select t.ok((select (b -> 'counts' ->> 'students.students')::int from _snap) = 2, 'backup has the students');
delete from students.students;
select restore_backup((select b from _snap));
select t.ok((select count(*) from students.students) = 2, 'restore brings the students back');
select t.ok((select count(*) from students.attendance) = 1, 'restore brings attendance back');
select t.ok((select count(*) from students.audiences) = 2, 'restore keeps the classes'' audiences');
select t.fails($$select restore_backup((select jsonb_set(b, '{tables}', (b -> 'tables') - 'students.students') from _snap))$$,
               'an old backup without students is refused');
select set_config('request.jwt.claims', '', false);

select 'ALL STUDENT TESTS PASSED';

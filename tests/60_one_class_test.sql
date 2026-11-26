-- One class for volunteers and students: turns, excuses, substitutes, the night before, changes.
\set ON_ERROR_STOP 1

create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at) values
  ('C9001', 'مدرس أ', '01000000301', 'c-a@test.com', 'تدريس', 'تحت المتابعة', now()),
  ('C9002', 'مدرس ب', '01000000302', 'c-b@test.com', 'تدريس', 'تحت المتابعة', now()),
  ('C9003', 'بديل', '01000000303', 'c-sub@test.com', 'تدريس', 'تحت المتابعة', now());
insert into staff_roles (email, full_name, role) values ('c-org@test.com', 'تنظيم', 'organizer');

-- tomorrow and the day after
create temp table dd as select app.today() + 1 as d1, app.today() + 2 as d2;
create temp table v as select (select id from volunteers where code = 'C9001') a, (select id from volunteers where code = 'C9002') b,
                              (select id from volunteers where code = 'C9003') sub;

-- class X: tomorrow, «بالتبادل» between A and B. class Y: the day after, A alone.
insert into schedule_slots (day, grade, subject, kind, starts_at, ends_at, volunteer_id, co_teachers, teaching_mode, status)
select app.weekday_of(d1), '4 ب', 'عربي', 'حصة', '16:00', '17:00', a, array[b], 'بالتبادل', 'شغالة' from dd, v;
insert into schedule_slots (day, grade, subject, kind, starts_at, ends_at, volunteer_id, status)
select app.weekday_of(d2), '4 ب', 'علوم', 'حصة', '15:00', '16:00', a, 'شغالة' from dd, v;
create temp table sl as select (select id from schedule_slots where subject = 'عربي' and grade = '4 ب' and teaching_mode = 'بالتبادل') x,
                               (select id from schedule_slots where subject = 'علوم' and grade = '4 ب' and volunteer_id = (select a from v) and co_teachers = '{}') y;

select students.ensure_sessions(app.today(), app.today() + 7);
select t.ok((select cardinality(teacher_ids) from students.class_sessions where slot_id = (select x from sl) and on_date = (select d1 from dd)) = 1,
            'alternating class: only that week''s teacher');
select t.ok((select teacher_ids from students.class_sessions where slot_id = (select x from sl) and on_date = (select d1 from dd))
             = app.slot_teacher_on((select s from schedule_slots s where id = (select x from sl)), (select d1 from dd)),
            'the right turn');
select t.ok(exists (select 1 from students.class_sessions where slot_id = (select y from sl) and on_date = (select d2 from dd)),
            'a class with no students yet still gets its dated class');

-- ---------- an excuse for Y (A alone) ----------
grant select on sl, dd, v to authenticated;
insert into class_absences (slot_id, on_date, volunteer_id, reason) select y, d2, a, 'سفر' from sl, dd, v;
select set_config('request.jwt.claims', '{"email":"c-org@test.com","role":"authenticated"}', false);
set role authenticated;
select review_absence((select id from class_absences where slot_id = (select y from sl)), true);
reset role;
select t.ok((select needs_substitute and teacher_ids = '{}' from students.class_sessions where slot_id = (select y from sl) and on_date = (select d2 from dd)),
            'approved excuse with no other teacher: needs a substitute');
select t.ok(exists (select 1 from notifications where recipient_email = 'c-org@test.com' and title = 'حصة محتاجة بديل'), 'organizers told it needs a substitute');

-- a substitute comes
update students.class_sessions set substitute_id = (select sub from v) where slot_id = (select y from sl) and on_date = (select d2 from dd);
select t.ok(not (select needs_substitute from students.class_sessions where slot_id = (select y from sl) and on_date = (select d2 from dd)),
            'substitute set: no longer needs one');
select t.ok(exists (select 1 from notifications where recipient_email = 'c-sub@test.com' and title = 'هتدّي حصة بدل'), 'the substitute is told');

-- and leaves again: back to needing one, then the night before cancels it
update students.class_sessions set substitute_id = null where slot_id = (select y from sl) and on_date = (select d2 from dd);
select t.ok((select needs_substitute from students.class_sessions where slot_id = (select y from sl) and on_date = (select d2 from dd)),
            'substitute removed: needs one again');
select t.ok(students.cancel_unstaffed((select d2 from dd)) = 1, 'the night before: cancelled');
select t.ok((select status from students.class_sessions where slot_id = (select y from sl) and on_date = (select d2 from dd)) = 'اتلغت', 'status cancelled');
select students.ensure_sessions(app.today(), app.today() + 7);
select t.ok((select count(*) from students.class_sessions where slot_id = (select y from sl) and on_date = (select d2 from dd)) = 1,
            'a cancelled class is not made again');

-- ---------- reminders come from the dated classes ----------
delete from notifications;
select app.remind_classes_tomorrow();
select t.ok((select count(*) from notifications where title = 'بكرة عندك حصة') = 1, 'one reminder: only that week''s teacher of X');
select t.ok(not exists (select 1 from notifications n join volunteers vv on vv.email = n.recipient_email
                         where n.title = 'بكرة عندك حصة'
                           and not exists (select 1 from students.class_sessions c where c.slot_id = (select x from sl)
                                              and c.on_date = (select d1 from dd) and vv.id = any (c.teacher_ids))),
            'nobody else is reminded');

-- ---------- changing the weekly class changes the coming classes ----------
update schedule_slots set starts_at = '17:00', ends_at = '18:30', teaching_mode = 'مع بعض' where id = (select x from sl);
select t.ok((select starts_at = '17:00' and cardinality(teacher_ids) = 2 from students.class_sessions
              where slot_id = (select x from sl) and on_date = (select d1 from dd)), 'new time and both teachers');
update schedule_slots set day = app.weekday_of((select d2 from dd)) where id = (select x from sl);
select t.ok(not exists (select 1 from students.class_sessions where slot_id = (select x from sl) and on_date = (select d1 from dd)),
            'moved to another day: the old date is gone');
select t.ok(exists (select 1 from students.class_sessions where slot_id = (select x from sl) and on_date = (select d2 from dd)),
            '... and the new day has it');

-- ---------- an approved cancel tells the teachers ----------
delete from notifications;
insert into students.slot_requests (slot_id, kind, on_date, reason, requested_by)
select x, 'إلغاء مرة', d2, 'امتحانات', 'c-org@test.com' from sl, dd;
update students.slot_requests set status = 'approved' where slot_id = (select x from sl);
select t.ok((select count(*) from notifications where title = 'تغيير في حصة' and recipient_email in ('c-a@test.com', 'c-b@test.com')) = 2,
            'both teachers told of the cancel');

-- ---------- the organizer picks a substitute through the function ----------
select set_config('request.jwt.claims', '{"email":"c-org@test.com","role":"authenticated"}', false);
set role authenticated;
select students.set_substitute((select id from students.class_sessions where status = 'متوقعة' order by on_date limit 1), (select sub from v));
reset role;
select t.ok(exists (select 1 from students.class_sessions where substitute_id = (select sub from v)), 'organizer set a substitute');

\echo ALL ONE CLASS TESTS PASSED

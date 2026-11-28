\set ON_ERROR_STOP 1
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at, follow_notes_1) values
  ('F1', 'متطوع أ', '01000000801', 'f-a@test.com', 'تدريس', 'تحت المتابعة', now(), 'ملتزم'),
  ('F2', 'اتش ار', '01000000802', 'f-hr@test.com', 'HR', 'مسئول', now(), null);
insert into staff_roles (email, full_name, role, volunteer_id) select 'f-hr@test.com', 'اتش ار', 'hr', id from volunteers where code = 'F2';

-- the migration already ran before these rows; run its copy step again for the test
insert into public.volunteer_feedback (volunteer_id, kind, body, created_by)
select id, 'متابعة', follow_notes_1, 'نقل تلقائي' from volunteers where code = 'F1';

select set_config('request.jwt.claims', '{"email":"f-hr@test.com","role":"authenticated"}', false);
set role authenticated;
insert into volunteer_feedback (volunteer_id, author_id, body) select (select id from volunteers where code = 'F1'), app.my_volunteer_id(), 'محتاج يحضر أكتر';
select t.ok((select count(*) from volunteer_feedback where volunteer_id = (select id from volunteers where code = 'F1')) = 2, 'HR reads and writes feedback');
select t.ok(exists (select 1 from interviewers() where full_name_ar = 'اتش ار'), 'HR volunteer is an interviewer');
select t.ok(not exists (select 1 from interviewers() where full_name_ar = 'متطوع أ'), 'others are not');
reset role;

select set_config('request.jwt.claims', '{"email":"f-a@test.com","role":"authenticated"}', false);
set role authenticated;
select t.ok((select count(*) from volunteer_feedback) = 0, 'the volunteer never sees his own feedback');
select set_joined_group(true);
reset role;
select t.ok((select joined_group from volunteers where code = 'F1'), 'volunteer ticks joined group himself');

-- exit reason
select set_config('request.jwt.claims', '', false);
update volunteers set out_reason = 'سفر' where code = 'F1';
select t.ok((select out_reason from volunteers where code = 'F1') is null, 'no exit reason while still under follow-up');
select app.begin_internal();
update volunteers set status = 'خارج المتابعة' where code = 'F1';
select app.end_internal();
select t.ok((select out_reason from volunteers where code = 'F1') = 'عدم المشاركة لمدة 3 شهور', 'automatic exit reason');
update volunteers set status = 'تحت المتابعة' where code = 'F1';
select t.ok((select out_reason from volunteers where code = 'F1') is null, 'back in: reason cleared');
-- pauses
insert into schedule_slots (day, grade, subject, kind, starts_at, ends_at, status) values (app.weekday_of(app.today() + 2), '3 ب', 'علوم', 'حصة', '10:00', '11:00', 'شغالة');
insert into students.audiences (slot_id, target, grade) select id, 'grade', '3 ب' from schedule_slots where subject = 'علوم';
select students.ensure_sessions(app.today(), app.today() + 7);
select t.ok(exists (select 1 from students.class_sessions where subject = 'علوم'), 'class made');
insert into students.schedule_pauses (from_date, to_date, grade, reason) values (app.today(), app.today() + 7, '3 ب', 'امتحانات');
select t.ok((select status from students.class_sessions where subject = 'علوم') = 'اتلغت', 'pause cancelled the coming class');
delete from students.schedule_pauses where reason = 'امتحانات';
select t.ok((select status from students.class_sessions where subject = 'علوم') = 'متوقعة', 'removing the pause brings it back');
\echo ALL FEEDBACK TESTS PASSED

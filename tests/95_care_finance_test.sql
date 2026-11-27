\set ON_ERROR_STOP 1
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into staff_roles (email, full_name, role) values ('c-admin@test.com', 'أدمن', 'admin'), ('c-hr@test.com', 'اتش ار', 'hr');
insert into students.terms (name, starts_on, ends_on, is_current) values ('ترم ج', app.today() - 30, app.today() + 60, true) on conflict do nothing;
update students.terms set is_current = (name = 'ترم ج');
insert into students.guardians (full_name, relation, phone) values ('أبو علي', 'أب', '01022223333');
insert into students.students (full_name, guardian_id) select 'علي', id from students.guardians where phone = '01022223333';
insert into students.enrollments (student_id, term_id, grade) select s.id, t.id, '2 ب' from students.students s, students.terms t where s.full_name = 'علي' and t.is_current;
insert into students.accounts (user_id, kind, guardian_id, login_email)
select '00000000-0000-0000-0000-0000000000c1', 'guardian', id, '01022223333@family.droos' from students.guardians where phone = '01022223333';
create temp table cs as select id from students.students where full_name = 'علي';
grant select on cs to authenticated;

-- phones
insert into students.phones (student_id, number, label) select id, '035551234', 'أرضي' from cs;
do $$ begin
  insert into students.phones (student_id, number, is_whatsapp) select id, '035551235', true from cs;
  raise exception 'FAIL: landline whatsapp';
exception when check_violation then raise notice 'ok: landline has no WhatsApp';
end $$;
insert into students.phones (student_id, number, is_whatsapp, is_main_whatsapp) select id, '01099990000', true, true from cs;
do $$ begin
  insert into students.phones (student_id, number, is_whatsapp, is_main_whatsapp) select id, '01099990001', true, true from cs;
  raise exception 'FAIL: two main';
exception when unique_violation then raise notice 'ok: one main WhatsApp';
end $$;

-- care notes / finance
insert into students.care_notes (student_id, body) select id, 'محدش يستلمه غير أبوه' from cs;
insert into students.family_finance (student_id, family_income) select id, 'قليل' from cs;
select set_config('request.jwt.claims', '{"email":"c-hr@test.com","role":"authenticated"}', false);
set role authenticated;
select t.ok((select count(*) from students.care_notes) = 1, 'HR (organizers) see care notes');
select t.ok((select count(*) from students.family_finance) = 0, 'HR without students.finance sees no income');
reset role;
select set_config('request.jwt.claims', '{"email":"c-admin@test.com","role":"authenticated"}', false);
set role authenticated;
select t.ok((select count(*) from students.family_finance) = 1, 'admin sees income');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","email":"01022223333@family.droos","role":"authenticated"}', false);
set role authenticated;
select t.ok((select count(*) from students.care_notes) = 0, 'guardian never sees care notes');
select t.ok((select count(*) from students.care_notes_for((select array_agg(id) from cs))) = 0, 'not through the function either');
reset role;

-- whatsapp
select set_config('request.jwt.claims', '', false);
insert into students.groups (term_id, name, grade) select id, '2 ب - مجموعة أ', '2 ب' from students.terms where is_current;
insert into students.group_members (group_id, student_id) select g.id, c.id from students.groups g, cs c where g.name = '2 ب - مجموعة أ';
insert into students.whatsapp_groups (name, link, target, grade) values ('تانية', 'https://chat.whatsapp.com/a', 'grade', '2 ب');
insert into students.whatsapp_groups (name, link, target, group_id) select 'مجموعة أ', 'https://chat.whatsapp.com/b', 'group', id from students.groups where name = '2 ب - مجموعة أ';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","email":"01022223333@family.droos","role":"authenticated"}', false);
set role authenticated;
select t.ok((select count(*) from students.whatsapp_for((select array_agg(id) from cs))) = 2, 'guardian sees grade and group WhatsApp');
reset role;
select set_config('request.jwt.claims', '', false);
insert into students.students (full_name, notes) values ('سارة', 'مينفعش تروح لوحدها');
select t.ok((select notes from students.students where full_name = 'سارة') is null, 'student row keeps no notes');
select t.ok((select body from students.care_notes c join students.students s on s.id = c.student_id where s.full_name = 'سارة') = 'مينفعش تروح لوحدها', 'notes moved to care notes');
\echo ALL CARE/FINANCE TESTS PASSED

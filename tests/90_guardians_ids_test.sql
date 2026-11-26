\set ON_ERROR_STOP 1
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

insert into staff_roles (email, full_name, role) values ('g-admin@test.com', 'أدمن', 'admin');
insert into students.terms (name, starts_on, ends_on, is_current) values ('ترم ب', app.today() - 30, app.today() + 60, true) on conflict do nothing;
update students.terms set is_current = (name = 'ترم ب');
insert into students.guardians (full_name, relation, phone, national_id, id_valid_until) values ('أم محمد', 'أم', '01077778888', '28501010101012', app.today() + 7);
insert into students.students (full_name, guardian_id) select 'محمد', id from students.guardians where phone = '01077778888';
insert into students.student_private (student_id, father_name, father_national_id, father_id_valid_until, mother_national_id, mother_id_valid_until, father_phone)
select id, 'الأب', '27001010101011', app.today() + 30, '28501010101012', app.today() + 7, '01012121212' from students.students where full_name = 'محمد';
insert into students.enrollments (student_id, term_id, grade) select s.id, t.id, '3 ب' from students.students s, students.terms t where s.full_name = 'محمد' and t.is_current;

select t.ok((select count(*) from students.expiring_ids(30)) = 2, 'guardian (mother) and father listed, mother not twice');
select t.ok(students.alert_expiring_ids() = 2, 'two alerts (7 and 30 days)');
select t.ok(exists (select 1 from notifications where recipient_email = 'g-admin@test.com' and title = 'بطاقة هتنتهي بعد 7 يوم'), 'staff told');
\echo ALL GUARDIAN/ID TESTS PASSED

-- Family portal sign-up checks, rules for guardians, the family page.
\set ON_ERROR_STOP 1

create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into staff_roles (email, full_name, role) values ('f-admin@test.com', 'أدمن', 'admin');
insert into students.terms (name, starts_on, ends_on, is_current) values ('ترم اختبار', app.today() - 30, app.today() + 60, true)
  on conflict do nothing;
update students.terms set is_current = (name = 'ترم اختبار');
insert into students.guardians (full_name, phone, national_id) values ('أبو أحمد', '01011112222', '27001010101010');
insert into students.students (full_name, guardian_id) select 'أحمد', id from students.guardians where phone = '01011112222';
insert into students.student_private (student_id, national_id, mother_national_id)
select id, '31501010101011', '28001010101012' from students.students where full_name = 'أحمد';
insert into students.phones (student_id, number, label) select id, '01233334444', 'الأم' from students.students where full_name = 'أحمد';
insert into students.enrollments (student_id, term_id, grade)
select s.id, t.id, '4 ب' from students.students s, students.terms t where s.full_name = 'أحمد' and t.is_current;

create temp table ids as select (select id from students.students where full_name = 'أحمد') sid,
                                (select id from students.guardians where phone = '01011112222') gid;
grant select on ids to authenticated;

-- ---------- sign-up checks ----------
select t.ok((students.family_check('guardian', '01011112222', '27001010101010'))->>'ok' = 'true', 'guardian: own phone + own ID');
select t.ok((students.family_check('guardian', '+20 1233334444', '28001010101012'))->>'ok' = 'true', 'guardian: phone on the child''s file + mother''s ID, +20 form');
select t.ok((students.family_check('guardian', '٠١٠١١١١٢٢٢٢', '31501010101011'))->>'login_email' = '01011112222@family.droos', 'Arabic digits and the child''s ID');
select t.ok((students.family_check('guardian', '01011112222', '29999999999999'))->>'ok' = 'false', 'wrong ID refused');
select t.ok((students.family_check('student', '31501010101011', '', '01233334444'))->>'ok' = 'true', 'student: ID + a family phone');
select t.ok((students.family_check('student', '31501010101011', '', '01099999999'))->>'ok' = 'false', 'student: wrong phone refused');
do $$ begin
  for i in 1..5 loop perform students.family_check('guardian', '01055555555', '27001010101010'); end loop;
end $$;
select t.ok((students.family_check('guardian', '01055555555', '27001010101010'))->>'error' like 'محاولات كتير%', 'too many tries');

-- link accounts (what the edge function does)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', '01011112222@family.droos'),
                                          ('00000000-0000-0000-0000-0000000000a2', '31501010101011@family.droos');
select students.family_link('00000000-0000-0000-0000-0000000000a1', 'guardian', (select gid from ids), '01011112222@family.droos');
select students.family_link('00000000-0000-0000-0000-0000000000a2', 'student', (select sid from ids), '31501010101011@family.droos');
select t.ok((select count(*) from students.accounts) = 2, 'two family accounts');
select t.ok((students.family_target('f-admin@test.com', 'guardian', (select sid from ids)))->>'login' = '01011112222', 'staff target: guardian login');
select t.ok((students.family_target('f-admin@test.com', 'student', (select sid from ids)))->>'allowed' = 'true', 'staff allowed');

-- ---------- rules ----------
select t.ok((select count(*) from students.rules where is_active) = 12, 'default rules seeded');
select set_config('request.jwt.claims', '{"email":"f-admin@test.com","role":"authenticated"}', false);
set role authenticated;
select t.ok(students.save_rules((select jsonb_agg(jsonb_build_object('id', id, 'body', body) order by sort_order) from students.rules)) = 0, 'saving unchanged: nothing new');
reset role;

-- the guardian
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"01011112222@family.droos","role":"authenticated"}', false);
set role authenticated;
select t.ok((students.family_home())->>'kind' = 'guardian', 'family page: guardian');
select t.ok(jsonb_array_length((students.family_home())->'children') = 1, 'sees his child');
select t.ok(not students.answer_rules((select jsonb_agg(jsonb_build_object('rule_id', id, 'agreed', sort_order <> 3, 'comment', case when sort_order = 3 then 'ممكن نبلغ بالواتساب؟' end)) from students.rules)),
            'one rule with a comment: not done');
select t.ok(students.answer_rules((select jsonb_agg(jsonb_build_object('rule_id', id, 'agreed', true)) from students.rules)), 'all agreed: done');
select t.ok((students.family_home())->>'rules_done' = 'true', 'family page says done');
reset role;

-- the student can't agree
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"31501010101011@family.droos","role":"authenticated"}', false);
set role authenticated;
select t.ok((students.family_home())->>'kind' = 'student', 'family page: student');
do $$ begin
  perform students.answer_rules('[]');
  raise exception 'FAIL: student answered';
exception when insufficient_privilege then raise notice 'ok: student can''t agree';
end $$;
reset role;

-- reword a rule: guardian told, needs agreeing again; staff mark on paper
select set_config('request.jwt.claims', '{"email":"f-admin@test.com","role":"authenticated"}', false);
set role authenticated;
select t.ok(students.save_rules((select jsonb_agg(jsonb_build_object('id', id, 'body', case when sort_order = 4 then body || ' (من غير الكارنيه مش هيدخل)' else body end) order by sort_order) from students.rules where is_active)) = 1,
            'one reworded rule');
select t.ok(not (select done from students.rules_status(array[(select sid from ids)])), 'needs agreeing again');
select t.ok((select pending from students.rules_report() r join students.rules x on x.id = r.rule_id where x.sort_order = 4) = 1, 'report: one pending');
select t.ok(students.mark_rules_paper((select sid from ids)), 'marked on paper');
select t.ok((select on_paper from students.rules_status(array[(select sid from ids)])), 'shows on paper');
reset role;
select t.ok(exists (select 1 from notifications where recipient_email = '01011112222@family.droos' and title = 'قواعد النشاط اتحدّثت'), 'guardian notified');

\echo ALL FAMILY/RULES TESTS PASSED

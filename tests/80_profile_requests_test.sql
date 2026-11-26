-- «بياناتي»: changes by request, HR reviews, and the guards on self-edits.
\set ON_ERROR_STOP 1

create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at, attended_minicamp, minicamp_date) values
  ('P9001', 'متطوع تجربة', '01000000901', 'p-self@test.com', 'تدريس', 'تحت المتابعة', now(), true, current_date - 10);
insert into staff_roles (email, full_name, role) values ('p-hr@test.com', 'اتش ار', 'hr');
create temp table pv as select id from volunteers where code = 'P9001';
grant select on pv to authenticated;

-- the volunteer
select set_config('request.jwt.claims', '{"email":"p-self@test.com","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  update volunteers set phone = '01000000999' where id = (select id from pv);
  raise exception 'FAIL: direct edit went through';
exception when insufficient_privilege then raise notice 'ok: no direct edit of personal data';
end $$;
do $$ begin
  update volunteers set attended_camp = true, camp_date = current_date where id = (select id from pv);
  raise exception 'FAIL: marked himself at the camp';
exception when insufficient_privilege then raise notice 'ok: can''t mark himself at the camp';
end $$;
do $$ begin
  update volunteers set recruit_status = 'مقفول' where id = (select id from pv);
  raise exception 'FAIL: recruit status';
exception when insufficient_privilege then raise notice 'ok: can''t change recruitment status';
end $$;
do $$ begin
  perform set_photo((select id from pv), (select id from pv)::text || '/x.jpg');
  raise exception 'FAIL: photo';
exception when insufficient_privilege then raise notice 'ok: photo only by request';
end $$;
do $$ begin
  perform submit_profile_request('{"phone":"123"}');
  raise exception 'FAIL: bad phone';
exception when invalid_parameter_value then raise notice 'ok: bad phone refused';
end $$;
do $$ begin
  perform submit_profile_request('{"phone":"01000000901"}');
  raise exception 'FAIL: nothing changed';
exception when invalid_parameter_value then raise notice 'ok: nothing changed refused';
end $$;
select submit_profile_request('{"phone":"01000000902","area":"سموحة","code":"X1"}');
select submit_profile_request('{"phone":"01000000903","area":"سموحة"}', (select id from pv)::text || '/req-1.jpg');
select t.ok((select count(*) from profile_requests where volunteer_id = (select id from pv)) = 1, 'sending again replaces the open request');
select t.ok((select changes from profile_requests) = '{"phone":"01000000903","area":"سموحة"}'::jsonb, 'only allowed and changed fields');
do $$ begin
  perform review_profile_request((select id from profile_requests limit 1), true);
  raise exception 'FAIL: self review';
exception when insufficient_privilege then raise notice 'ok: can''t accept his own request';
end $$;
reset role;
select t.ok(exists (select 1 from notifications where recipient_email = 'p-hr@test.com' and title = 'طلب تعديل بيانات'), 'HR told');

-- HR accepts
select set_config('request.jwt.claims', '{"email":"p-hr@test.com","role":"authenticated"}', false);
set role authenticated;
select review_profile_request((select id from profile_requests limit 1), true, null);
reset role;
select t.ok((select phone = '01000000903' and area = 'سموحة' from volunteers where id = (select id from pv)), 'changes applied');
select t.ok((select photo_path from volunteer_private where volunteer_id = (select id from pv)) = (select id from pv)::text || '/req-1.jpg', 'photo applied');
select t.ok((select status from profile_requests limit 1) = 'accepted', 'request accepted');
select t.ok(exists (select 1 from notifications where recipient_email = 'p-self@test.com' and title = 'طلب تعديل بياناتك اتقبل'), 'volunteer told');

-- a refused one changes nothing
select set_config('request.jwt.claims', '{"email":"p-self@test.com","role":"authenticated"}', false);
set role authenticated;
select submit_profile_request('{"area":"ميامي"}');
reset role;
select set_config('request.jwt.claims', '{"email":"p-hr@test.com","role":"authenticated"}', false);
set role authenticated;
select review_profile_request((select id from profile_requests where status = 'pending'), false, 'اكتب المنطقة بالتفصيل');
reset role;
select t.ok((select area from volunteers where id = (select id from pv)) = 'سموحة', 'refused: nothing changed');

-- a teacher can't move or cancel his class, but can set a substitute
insert into schedule_slots (day, grade, subject, kind, starts_at, ends_at, volunteer_id, status)
select app.weekday_of(app.today() + 1), '5 ب', 'رياضة', 'حصة', '10:00', '11:00', (select id from pv), 'شغالة';
select students.ensure_sessions(app.today() + 1, app.today() + 1);
create temp table ps as select id from students.class_sessions where subject = 'رياضة' and on_date = app.today() + 1;
grant select on ps to authenticated;
select set_config('request.jwt.claims', '{"email":"p-self@test.com","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  update students.class_sessions set status = 'اتلغت' where id = (select id from ps);
  raise exception 'FAIL: teacher cancelled';
exception when insufficient_privilege then raise notice 'ok: teacher can''t cancel his class';
end $$;
update students.class_sessions set notes = 'هاجيب أوراق' where id = (select id from ps);
reset role;
select t.ok((select notes from students.class_sessions where id = (select id from ps)) = 'هاجيب أوراق', 'teacher writes notes');

\echo ALL PROFILE REQUEST TESTS PASSED

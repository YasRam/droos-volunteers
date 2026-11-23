-- Role tests: each block signs in as one person and checks what they
-- can see and change. Any failed check aborts with its message.
\set ON_ERROR_STOP 1

-- ---------- helpers ----------
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
create or replace function t.login(email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', email, 'role', 'authenticated')::text, true)
$$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- ---------- fixtures (as postgres) ----------
insert into staff_roles (email, full_name, role) values
  ('admin@test.com', 'أدمن', 'admin'),
  ('hr@test.com', 'إتش آر', 'hr'),
  ('org@test.com', 'تنظيم', 'organizer'),
  ('vol2@test.com', 'متطوع تاني', 'hr'),
  ('vol2@test.com', 'متطوع تاني', 'organizer');
insert into committee_leaders (email, committee, full_name) values ('leader@test.com', 'تدريس', 'ليدر التدريس');

insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at) values
  ('V9001', 'متطوع أول', '01000000001', 'vol1@test.com', 'تدريس', 'تحت المتابعة', now() - interval '400 days'),
  ('V9002', 'متطوع تاني', '01000000002', 'vol2@test.com', 'ميديا', 'تحت المتابعة', now() - interval '400 days'),
  ('V9003', 'متطوع تالت', '01000000003', null, 'تدريس', 'خارج المتابعة', now() - interval '400 days'),
  ('V9004', 'متطوع قديم', '01000000004', null, 'ميديا', 'تحت المتابعة', now() - interval '200 days');
update volunteer_private set national_id = '29511010202616' where volunteer_id = (select id from volunteers where code = 'V9001');
update volunteer_hr set acceptance = 'اختبار', status_changed_at = now() - interval '100 days'
 where volunteer_id = (select id from volunteers where code = 'V9002');

select t.ok((select birth_date from volunteers where code = 'V9001') = '1995-11-01', 'birth date from national id');
select t.ok((select gender from volunteers where code = 'V9001') = 'ذكر', 'gender from national id');
select t.ok((select whatsapp from volunteers where code = 'V9001') = '01000000001', 'whatsapp defaults to phone');
select t.ok((select count(*) from volunteer_hr) = 4, 'hr companion rows created');

-- ---------- volunteer ----------
begin;
set local role authenticated;
select t.login('vol1@test.com');
select t.ok((select count(*) from volunteers) = 1, 'volunteer sees only own row');
select t.ok((select count(*) from volunteer_hr) = 0, 'volunteer cannot read HR data');
select t.ok((select count(*) from volunteer_private) = 1, 'volunteer reads own national id');
select t.ok((select count(*) from volunteer_directory) = 0, 'volunteer has no directory');
update volunteers set job = 'مهندس' where code = 'V9001';
select t.ok((select job from volunteers where code = 'V9001') = 'مهندس', 'volunteer edits own personal data');
select t.fails($$update volunteers set status = 'مسئول' where code = 'V9001'$$, 'volunteer cannot change status');
select t.fails($$update volunteers set bought_tshirt = true where code = 'V9001'$$, 'volunteer cannot change committee data');
update volunteers set job = 'x' where code = 'V9002';
select t.ok((select count(*) from volunteers where job = 'x') = 0, 'volunteer cannot touch another row');
update volunteer_private set national_id = '29911010202611';
select t.ok((select national_id from volunteer_private) = '29511010202616', 'volunteer cannot change own national id');
select t.fails($$update volunteers set position = 'HR' where code = 'V9001'$$, 'volunteer cannot change own position');
insert into participations (volunteer_id, activity_date, event, subject, grade)
  values (app.my_volunteer_id(), app.today(), 'تدريس', 'لغة عربية', '2 ع');
select t.ok((select status from participations where volunteer_id = app.my_volunteer_id()) = 'pending', 'self check-in is pending');
select t.fails($$insert into participations (volunteer_id, activity_date, event, subject, grade)
  values (app.my_volunteer_id(), app.today(), 'تدريس', 'لغة عربية', '2 ع')$$, 'duplicate check-in rejected');
insert into participations (volunteer_id, activity_date, event, subject, grade)
  values (app.my_volunteer_id(), app.today(), 'تدريس', 'لغة عربية', '3 ع');
select t.ok((select count(*) from participations) = 2, 'same subject, different grade is allowed');
select t.fails($$insert into participations (volunteer_id, activity_date, event)
  values (app.my_volunteer_id(), app.today() - 1, 'تنظيم')$$, 'volunteer cannot back-date');
select t.fails($$insert into participations (volunteer_id, activity_date, event)
  values ((select id from volunteer_directory limit 1), app.today(), 'تنظيم')$$, 'volunteer cannot check in someone else');
select t.ok((select count(*) from audit_log) = 0, 'volunteer cannot read the log');
select t.fails($$select public.register_activity('{"event":"تنظيم"}', array[app.my_volunteer_id()])$$, 'volunteer cannot use group registration');
commit;

-- ---------- committee leader ----------
begin;
set local role authenticated;
select t.login('leader@test.com');
select t.ok((select count(*) from volunteers) = 2, 'leader sees only his committee');
select t.ok((select count(*) from volunteer_private) = 0, 'leader cannot read national ids');
update volunteers set bought_tshirt = true where code = 'V9001';
select t.ok((select bought_tshirt from volunteers where code = 'V9001'), 'leader edits committee data');
select t.fails($$update volunteers set job = 'y' where code = 'V9001'$$, 'leader cannot edit personal data');
select t.fails($$update volunteers set status = 'مسئول' where code = 'V9001'$$, 'leader cannot edit interview data');
commit;

-- ---------- organizer ----------
begin;
set local role authenticated;
select t.login('org@test.com');
select t.ok((select count(*) from volunteers) = 0, 'organizer cannot read the full volunteer table');
select t.ok((select count(*) from volunteer_directory) = 4, 'organizer reads the directory');
select t.ok((select count(*) from participations where status = 'pending') = 2, 'organizer sees recent requests');
insert into participations (volunteer_id, activity_date, event)
  values ((select id from volunteer_directory where code = 'V9003'), app.today(), 'تنظيم');
select t.ok((select p.status from participations p join volunteer_directory d on d.id = p.volunteer_id where d.code = 'V9003') = 'accepted', 'organizer entry is accepted');
select t.ok((select status from volunteer_directory where code = 'V9003') = 'تحت المتابعة', 'participation brings volunteer back to follow-up');
select t.fails($$insert into participations (volunteer_id, activity_date, event)
  values ((select id from volunteer_directory where code = 'V9002'), app.today() - 10, 'تنظيم')$$, 'organizer limited to 7 days');
select t.ok(
  (select (public.register_activity(
      jsonb_build_object('event', 'تنظيم', 'activity_date', app.today()),
      array(select id from volunteer_directory where code in ('V9001', 'V9002', 'V9003'))) ->> 'inserted')::int = 2),
  'group registration skips the duplicate');
update participations set status = 'accepted' where status = 'pending' and subject = 'لغة عربية' and grade = '2 ع';
select t.ok((select count(*) from participations where status = 'pending') = 1, 'organizer approves a request');
commit;

-- ---------- HR ----------
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.ok((select count(*) from volunteers) = 4, 'HR sees everyone');
select t.ok((select count(*) from volunteer_hr) = 4, 'HR reads interview data');
update volunteer_private set national_id = '29511010202624' where volunteer_id = (select id from volunteers where code = 'V9001');
select t.ok((select national_id from volunteer_private p join volunteers v on v.id = p.volunteer_id where v.code = 'V9001') = '29511010202624', 'HR changes a national id');
update volunteers set position = 'تنظيم' where code = 'V9001';
select t.ok((select position from volunteers where code = 'V9001') = 'تنظيم', 'HR sets the position');
update volunteers set status = 'مسئول' where code = 'V9002';
select t.ok((select status_changed_at > now() - interval '1 minute' from volunteer_hr h join volunteers v on v.id = h.volunteer_id where v.code = 'V9002'), 'status change is timestamped');
update volunteers set status = 'تحت المتابعة' where code = 'V9002';
select t.ok((select count(*) from audit_log) > 0, 'HR reads the log');
select t.ok((select count(*) from group_activities) = 1, 'group activity recorded');
commit;

-- ---------- volunteer with two permissions (HR + تنظيم) ----------
begin;
set local role authenticated;
select t.login('vol2@test.com');
select t.ok((public.my_context() -> 'roles') = '["hr", "organizer"]'::jsonb, 'two permissions listed');
select t.ok(app.is_full() and not app.is_organizer(), 'HR + تنظيم gets the HR rights without the 7-day limit');
select t.ok((select count(*) from volunteers) = 4, 'HR volunteer sees everyone');
select t.fails($$update volunteer_private set national_id = '29911010202611' where volunteer_id = app.my_volunteer_id()$$, 'nobody changes their own national id');
insert into participations (volunteer_id, activity_date, event)
  values ((select id from volunteers where code = 'V9003'), app.today() - 20, 'كامب');
select t.ok((select attended_minicamp from volunteers where code = 'V9003'), 'camp counts like mini camp');
insert into participations (volunteer_id, activity_date, event, subject, grade)
  values ((select id from volunteers where code = 'V9003'), app.today() - 20, 'تأسيس', 'رياضيات، علوم', '1 ب، 2 ب');
select t.ok((select count(*) from lookups where list = 'نوع الحدث' and value in ('رياضيات', 'علوم')) = 2, 'each subject joins the list');
select t.ok((select participations from participation_days where volunteer_id = (select id from volunteers where code = 'V9003') and activity_date = app.today() - 20) = 2, 'participation days view');
insert into lookups (list, value) values ('اللجنة', 'ميديا');
select public.rename_lookup((select id from lookups where list = 'اللجنة' and value = 'ميديا'), 'الميديا');
select t.ok((select main_committee from volunteers where code = 'V9002') = 'الميديا', 'renaming a committee moves its volunteers');
commit;

-- ---------- notifications ----------
begin;
set local role authenticated;
select t.login('vol1@test.com');
select t.ok((select count(*) from notifications where title = 'طلب الحضور اتقبل') = 1, 'volunteer notified of approval');
select t.fails($$update notifications set title = 'x'$$, 'notification text is read-only');
update notifications set read_at = now();
commit;
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.ok((select count(*) from notifications where title = 'رجوع تحت المتابعة') = 1, 'HR notified of return to follow-up');
commit;

-- ---------- daily jobs (as the scheduler) ----------
update volunteer_hr set status_changed_at = now() - interval '100 days'
 where volunteer_id = (select id from volunteers where code = 'V9002');
select app.run_daily_jobs();
select t.ok((select status from volunteers where code = 'V9004') = 'خارج المتابعة', 'no participation for 90 days → خارج المتابعة');
select t.ok((select status from volunteers where code = 'V9001') = 'تحت المتابعة', 'active volunteer stays under follow-up');
select t.ok((select acceptance from volunteer_hr h join volunteers v on v.id = h.volunteer_id where v.code = 'V9002') = 'مقبول', 'اختبار for 90 days → مقبول');
select t.ok(app.run_monthly_summary() >= 1, 'monthly summary sent');

-- ---------- outsider ----------
begin;
set local role authenticated;
select t.login('stranger@test.com');
select t.ok((select count(*) from volunteers) = 0, 'unknown account sees no volunteers');
select t.ok((select count(*) from participations) = 0, 'unknown account sees no participations');
select t.ok((select count(*) from schedule_slots) = 0, 'schedule readable (empty here)');
commit;

\echo ALL ROLE TESTS PASSED

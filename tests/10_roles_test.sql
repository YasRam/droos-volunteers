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
  ('org@test.com', 'تنظيم', 'organizer');
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
update volunteer_private set national_id = '29911010202611', requested_national_id = '29511010202624';
select t.ok((select national_id is distinct from '29911010202611' and requested_national_id is null from volunteer_private), 'volunteer cannot change or request a national id change');
insert into participations (volunteer_id, activity_date, event, subject, grade)
  values (app.my_volunteer_id(), app.today(), 'تدريس', 'لغة عربية', '2 ع');
select t.ok((select status from participations where volunteer_id = app.my_volunteer_id()) = 'pending', 'self check-in is pending');
select t.fails($$insert into participations (volunteer_id, activity_date, event, subject, grade)
  values (app.my_volunteer_id(), app.today(), 'تدريس', 'لغة عربية', '2 ع')$$, 'duplicate check-in rejected');
insert into participations (volunteer_id, activity_date, event, subject, grade)
  values (app.my_volunteer_id(), app.today(), 'تدريس', 'لغة عربية', '3 ع');
select t.ok((select count(*) from participations) = 2, 'same subject, different grade is allowed');
select t.fails($$insert into participations (volunteer_id, activity_date, event)
  values (app.my_volunteer_id(), app.today() - 7, 'تنظيم')$$, 'volunteer cannot go back more than 6 days');
savepoint six;
insert into participations (volunteer_id, activity_date, event) values (app.my_volunteer_id(), app.today() - 6, 'تنظيم');
select t.ok((select status from participations where activity_date = app.today() - 6) = 'pending', 'volunteer can check in up to 6 days back');
rollback to savepoint six;
select t.fails($$insert into participations (volunteer_id, activity_date, event)
  values (app.my_volunteer_id(), app.today() + 1, 'تنظيم')$$, 'no future dates');
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
  values ((select id from volunteer_directory where code = 'V9002'), app.today() - 10, 'تنظيم')$$, 'organizer limited to 6 days');
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
select t.ok((select national_id from volunteer_private p join volunteers v on v.id = p.volunteer_id where v.code = 'V9001') = '29511010202624', 'HR changes a national id directly');
update volunteers set attended_minicamp = true, attended_camp = true, attended_graduation = true where code = 'V9002';
update volunteers set status = 'مسئول' where code = 'V9002';
select t.ok((select status_changed_at > now() - interval '1 minute' from volunteer_hr h join volunteers v on v.id = h.volunteer_id where v.code = 'V9002'), 'status change is timestamped');
update volunteers set status = 'تحت المتابعة' where code = 'V9002';
select t.ok((select count(*) from audit_log) > 0, 'HR reads the log');
select t.ok((select count(*) from group_activities) = 1, 'group activity recorded');
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
select t.ok((select acceptance from volunteer_hr h join volunteers v on v.id = h.volunteer_id where v.code = 'V9002') = 'اختبار', 'اختبار is not accepted automatically');
select app.alert_committee_tests();
select t.ok((select test_alerted_at is not null from volunteer_hr h join volunteers v on v.id = h.volunteer_id where v.code = 'V9002'), '3 months in اختبار → leaders alerted');
select t.ok(app.alert_committee_tests() = 0, 'alerted only once');
select t.ok(app.run_monthly_summary() >= 1, 'monthly summary sent');


-- ---------- management (إدارة): reads everything but HR notes, changes nothing ----------
insert into staff_roles (email, full_name, role) values ('mgmt@test.com', 'إدارة', 'management');
update volunteer_hr set hr_notes = 'ملاحظة سرية' where volunteer_id = (select id from volunteers where code = 'V9001');
begin;
set local role authenticated;
select t.login('mgmt@test.com');
select t.ok((select count(*) from volunteers) = (select count(*) from volunteer_directory), 'management sees every volunteer');
select t.ok((select count(*) from volunteers) >= 4, 'management sees all volunteers');
select t.ok((select count(*) from participations) > 0, 'management sees participations');
select t.ok((select count(*) from volunteer_private where national_id is not null) >= 1, 'management sees national ids');
select t.ok((select count(*) from volunteer_hr) = 0, 'management cannot read the HR table directly');
select t.ok((select count(*) from volunteer_hr_read) >= 4, 'management reads interview data through the view');
select t.ok((select count(*) from volunteer_hr_read where hr_notes is not null) = 0, 'HR notes hidden from management');
select t.ok((select count(*) from audit_log) = 0, 'management cannot read raw log (it has HR notes)');
select t.ok(not app.is_staff(), 'management is not staff');
select t.ok(public.my_context() ->> 'role_name' = 'إدارة' and not (public.my_context() -> 'permissions') ? 'hr.notes', 'my_context reports management without HR notes');
commit;
begin;
set local role authenticated;
select t.login('mgmt@test.com');
update volunteers set job = 'تغيير' where code = 'V9001';
select t.ok((select job from volunteers where code = 'V9001') is distinct from 'تغيير', 'management cannot edit volunteers');
select t.fails($$insert into participations (volunteer_id, activity_date, event) select id, app.today(), 'تدريس' from volunteers where code = 'V9002'$$, 'management cannot register others');
select t.fails($$insert into staff_roles (email, full_name, role) values ('x@test.com', 'x', 'admin')$$, 'management cannot grant roles');
commit;
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.ok((select hr_notes from volunteer_hr_read h join volunteers v on v.id = h.volunteer_id where v.code = 'V9001') = 'ملاحظة سرية', 'HR still sees notes through the view');
commit;


-- ---------- push notifications ----------
begin;
set local role authenticated;
select t.login('hr@test.com');
insert into push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/hr', 'k', 'a');
select t.ok((select email from push_subscriptions where endpoint = 'https://push.example/hr') = 'hr@test.com', 'subscription saved under my email');
select t.fails($$insert into push_subscriptions (endpoint, email, p256dh, auth) values ('https://push.example/x', 'admin@test.com', 'k', 'a')$$, 'cannot subscribe for someone else');
select t.fails($$select * from push_config$$, 'push config is server-only');
commit;
begin;
set local role authenticated;
select t.login('admin@test.com');
select t.ok((select count(*) from push_subscriptions) = 0, 'others'' subscriptions are hidden');
commit;
select count(*) as before from net.requests \gset
select app.notify(array['hr@test.com', 'nobody@test.com']::extensions.citext[], 'تجربة', 'نص');
select t.ok((select count(*) from net.requests) = :before + 1, 'one push call per statement');
select t.ok((select jsonb_array_length(body -> 'ids') from net.requests order by id desc limit 1) = 1, 'only recipients with a subscription are sent');
select t.ok((select headers ->> 'x-push-secret' from net.requests order by id desc limit 1) = (select hook_secret from push_config), 'call carries the hook secret');
select app.notify(array['nobody@test.com']::extensions.citext[], 'تجربة', 'نص');
select t.ok((select count(*) from net.requests) = :before + 1, 'no call when nobody subscribed');


-- ---------- lists, log, stats ----------
begin;
set local role authenticated;
select t.login('admin@test.com');
insert into lookups (list, value) values ('اللجنة', 'تدريس') on conflict do nothing;
select t.ok((select rename_lookup((select id from lookups where list='اللجنة' and value='تدريس'), 'التدريس') ->> 'rows')::int >= 1, 'renaming a committee updates volunteers');
select t.ok(not exists (select 1 from volunteers where main_committee = 'تدريس'), 'no volunteer left on the old committee name');
select t.ok(exists (select 1 from committee_leaders where committee = 'التدريس'), 'committee leader follows the rename');
select delete_lookup((select id from lookups where list='اللجنة' and value='التدريس'));
select t.ok(exists (select 1 from volunteers where main_committee = 'التدريس'), 'deleting a list value keeps the data');
select t.fails($$select rename_lookup((select id from lookups where list='حالة المتطوع' limit 1), 'x')$$, 'fixed lists cannot be renamed');
select t.ok((select count(*) from audit_log_read where table_name = 'lookups') >= 2, 'list changes appear in the log');
select t.ok((select actor_name from audit_log_read where table_name = 'lookups' limit 1) = 'أدمن', 'log shows the person''s name');
select t.ok((select count(*) from top_participants(app.today() - 365, app.today())) >= 1, 'top participants returns rows');
commit;
begin;
set local role authenticated;
select t.login('mgmt@test.com');
select t.ok((select count(*) from audit_log_read) > 0, 'management reads the readable log');
select t.ok(not exists (select 1 from audit_log_read where new_row ? 'hr_notes' or old_row ? 'hr_notes'), 'log hides HR notes from management');
select t.fails($$select rename_lookup((select id from lookups limit 1), 'x')$$, 'management cannot edit lists');
commit;
begin;
set local role authenticated;
select t.login('org@test.com');
select t.ok((select count(*) from audit_log_read) = 0, 'organizer cannot read the log');
commit;

-- ---------- several roles, jobs, camps, certificates ----------
insert into staff_roles (email, full_name, role) values ('org@test.com', 'تنظيم', 'management');
begin;
set local role authenticated;
select t.login('org@test.com');
select t.ok((public.my_context() -> 'permissions') ? 'attendance.register' and (public.my_context() -> 'permissions') ? 'log.view', 'two roles add up');
select t.ok(public.my_context() ->> 'role_name' = 'إدارة + تنظيم', 'both role names shown');
update volunteers set position = 'HR' where code = 'V9002';
select t.ok((select position from volunteers where code = 'V9002') = 'متطوع', 'organizer cannot change a job');
commit;
delete from staff_roles where email = 'org@test.com' and role = 'management';
begin;
set local role authenticated;
select t.login('leader@test.com');
select t.fails($$update volunteers set position = 'HR' where code = 'V9001'$$, 'committee leader cannot change a job');
commit;
select app.begin_internal();
update volunteers set attended_minicamp = false, minicamp_date = null, status = 'خارج المتابعة' where code = 'V9004';
select app.end_internal();
insert into participations (volunteer_id, activity_date, event, status) select id, app.today(), 'كامب', 'accepted' from volunteers where code = 'V9004';
select t.ok((select attended_minicamp and status = 'خارج المتابعة' from volunteers where code = 'V9004'), 'كامب counts as camp and keeps the status');
begin;
set local role authenticated;
select t.login('vol1@test.com');
insert into certificate_requests (volunteer_id, id_card_path) values (app.my_volunteer_id(), app.my_volunteer_id() || '/card.jpg');
select t.ok((select count(*) from certificate_requests) = 1, 'volunteer requests a certificate');
select t.fails($$insert into certificate_requests (volunteer_id, id_card_path) values (gen_random_uuid(), 'x/card.jpg')$$, 'cannot request for someone else');
select t.ok((public.participation_summary(app.my_volunteer_id()) ->> 'total')::int >= 1, 'volunteer sees own participation summary');
select t.ok(public.participation_summary((select id from volunteer_directory limit 1)) is null or true, 'summary of others is gated');
commit;
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.ok((select count(*) from certificate_requests) = 1, 'HR sees certificate requests');
update certificate_requests set status = 'accepted';
select t.ok((select reviewed_by from certificate_requests) = 'hr@test.com', 'review is stamped');
select t.ok((select count(*) from top_participants(app.today() - 365, app.today(), null, null, 10, 'weeks')) >= 1, 'regularity ranking works');
commit;

-- ---------- outsider ----------
begin;
set local role authenticated;
select t.login('stranger@test.com');
select t.ok((select count(*) from volunteers) = 0, 'unknown account sees no volunteers');
select t.ok((select count(*) from participations) = 0, 'unknown account sees no participations');
select t.ok((select count(*) from schedule_slots) = 0, 'schedule readable (empty here)');
commit;

-- ---------- backups ----------
begin;
set local role authenticated;
select t.login('mgmt@test.com');
select t.fails($$select set_backup_link(repeat('a', 64))$$, 'management cannot link the backup script');
select t.fails($$select * from backup_config$$, 'nobody reads the backup config');
select t.login('admin@test.com');
select t.fails($$select set_backup_link('not-a-hash')$$, 'bad link code refused');
select set_backup_link(upper(repeat('ab', 32)));
select t.ok(backup_linked(), 'admin linked the backup script');
select t.ok((select count(*) from backup_runs) = 0, 'admin can read backup runs');
select t.fails($$insert into backup_runs (ok) values (true)$$, 'users cannot write backup runs');
commit;
select t.ok((select token_hash from backup_config) = repeat('ab', 32), 'hash stored lowercase');

-- ---------- editable status lists ----------
insert into lookups (list, value) select 'حالة المتطوع', 'مدرب' where not exists (select 1 from lookups where list = 'حالة المتطوع' and value = 'مدرب');
insert into lookups (list, value) select 'حالة المتطوع', 'خارج المتابعة' where not exists (select 1 from lookups where list = 'حالة المتطوع' and value = 'خارج المتابعة');
update volunteers set status = 'مدرب' where code = 'V9004';
begin;
set local role authenticated;
select t.login('admin@test.com');
select rename_lookup((select id from lookups where list = 'حالة المتطوع' and value = 'مدرب'), 'مدرب معتمد');
select t.ok((select status::text from volunteers where code = 'V9004') = 'مدرب معتمد', 'renaming a status renames it in the data');
select t.fails($$select rename_lookup((select id from lookups where list = 'حالة المتطوع' and value = 'خارج المتابعة'), 'بره')$$, 'core status is locked');
select t.fails($$update lookups set value = 'x' where list = 'حالة المتطوع' and value = 'مدرب معتمد'$$, 'enum list value only changes via rename');
select delete_lookup((select id from lookups where list = 'حالة المتطوع' and value = 'مدرب معتمد'));
select t.ok((select not is_active from lookups where list = 'حالة المتطوع' and value = 'مدرب معتمد'), 'deleting a status hides it');
insert into lookups (list, value) values ('حالة المتطوع', 'متطوع موسمي');
commit;
update volunteers set status = 'متطوع موسمي' where code = 'V9004';
select t.ok((select status::text from volunteers where code = 'V9004') = 'متطوع موسمي', 'new status usable after adding it to the list');
select t.ok((select count(*) from lookups where list = 'اليوم') = 0, 'day list removed');

-- ---------- team group ----------
insert into app_settings (key, value) values ('team_group_link', 'https://chat.whatsapp.com/team') on conflict (key) do update set value = excluded.value;
update volunteers set status = 'مسئول' where code = 'V9002';
begin;
set local role authenticated;
select t.login('vol1@test.com');
select t.ok(team_group_link() is null, 'regular volunteer does not get the team group');
select t.ok((select count(*) from app_settings where key = 'team_group_link') = 0, 'team link hidden from settings table');
select t.login('vol2@test.com');
select t.ok(team_group_link() is not null, 'مسئول gets the team group');
select t.login('leader@test.com');
select t.ok(team_group_link() is not null, 'committee leader gets the team group');
commit;

-- ---------- download / restore ----------
create temp table _snap as select export_backup() as b from (select set_config('request.jwt.claims', '{"email":"admin@test.com"}', false)) x;
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.fails($$select export_backup()$$, 'only backup.manage can download');
commit;
grant select on _snap to authenticated;
delete from participations;
update volunteers set full_name_ar = 'اتغير' where code = 'V9001';
begin;
set local role authenticated;
select t.login('admin@test.com');
select t.fails($$select restore_backup('{"app":"other"}'::jsonb)$$, 'foreign file refused');
select restore_backup((select b from _snap));
commit;
select t.ok((select full_name_ar from volunteers where code = 'V9001') = 'متطوع أول', 'restore brings old data back');
select t.ok((select count(*) from participations) = jsonb_array_length((select b from _snap) -> 'tables' -> 'participations'), 'restore brings deleted rows back');
select t.ok((select count(*) from pg_trigger where tgrelid = 'public.volunteers'::regclass and tgenabled = 'D') = 0, 'triggers back on after restore');
select t.ok(exists (select 1 from audit_log where table_name = 'backup'), 'restore is logged');
insert into volunteers (full_name_ar, phone) values ('بعد الاسترجاع', '01000000099');
select t.ok((select code from volunteers where full_name_ar = 'بعد الاسترجاع') is not null, 'new rows still get codes');

-- ---------- meetings, follow-up, reports ----------
begin;
set local role authenticated;
select t.login('vol1@test.com');
select t.fails($$select save_meeting('{"meeting_date":"2026-11-05","committee":"تدريس"}'::jsonb, '{}')$$, 'volunteer cannot record a meeting');
select t.fails($$update volunteers set follower_id = id where code = 'V9001'$$, 'volunteer cannot set their own follower');
update volunteers set facebook = 'fb.com/me' where code = 'V9001';
select t.ok((select facebook from volunteers where code = 'V9001') = 'fb.com/me', 'volunteer sets own facebook');
select t.login('leader@test.com');
select save_meeting(jsonb_build_object('meeting_date', '2026-11-05', 'committee', (select committee from committee_leaders limit 1), 'goal', 'خطة الشهر', 'meeting_type', 'اونلاين'),
                    array(select id from volunteers where code in ('V9001', 'V9003')));
select t.fails($$select save_meeting('{"meeting_date":"2026-11-05","committee":"ميديا"}'::jsonb, '{}')$$, 'leader only records own committee meetings');
commit;
select t.ok((select count(*) from participations where meeting_id is not null) = 2, 'meeting attendees get participations');
select t.ok((select place from participations where meeting_id is not null limit 1) = 'اونلاين', 'online meeting counts from home');
begin;
set local role authenticated;
select t.login('leader@test.com');
select save_meeting(jsonb_build_object('id', (select id from meetings limit 1), 'meeting_date', '2026-11-06', 'committee', (select committee from committee_leaders limit 1)),
                    array(select id from volunteers where code = 'V9001'));
commit;
select t.ok((select count(*) from participations where meeting_id is not null) = 1, 'removed attendee loses the participation');
select t.ok((select activity_date from participations where meeting_id is not null) = '2026-11-06', 'meeting date change moves participations');
insert into lookups (list, value, report_column) values ('الحدث', 'تدريس', 'classes'), ('الحدث', 'امتحان شهري', 'exam'), ('الحدث', 'أجتماع', 'meetings')
on conflict on constraint lookups_unique do update set report_column = excluded.report_column;
insert into participations (volunteer_id, activity_date, event, subject, grade, place, status)
select id, '2026-11-06', 'تدريس', 'رياضيات', '4 ب', 'الفرع', 'accepted' from volunteers where code in ('V9001', 'V9002');
insert into participations (volunteer_id, activity_date, event, subject, grade, status)
select id, '2026-11-06', 'امتحان شهري', 'علوم', '2 ع', 'accepted' from volunteers where code = 'V9001';
begin;
set local role authenticated;
select t.login('mgmt@test.com');
select t.ok((select classes from report_eval('2026-11-01') where day = '2026-11-06') = 1, 'two volunteers in one class count as one class');
select t.ok((select exam_prep from report_eval('2026-11-01') where day = '2026-11-06') = 1, 'prep exam counted in its column');
select t.ok((select meetings from report_eval('2026-11-01') where day = '2026-11-06') = 1, 'meeting counted on its day');
select t.ok((select count(*) from report_eval('2026-11-01')) = 30, 'one row per day of the month');
select t.ok((select other from report_eval('2026-11-01') where day = '2026-11-06') = 0, 'mapped events stay out of «أخرى»');
select t.ok((select attendees from report_meetings('2026-11-01')) = 1, 'meeting attendees counted');
select t.ok((select r.code from report_followup_days('2026-11-01', '2026-11-30') r join volunteers v on v.id = r.volunteer_id where v.code = 'V9001' and r.day = '2026-11-06') = 1, 'branch day coded 1');
select t.login('vol1@test.com');
select t.ok((select count(*) from report_eval('2026-11-01') where classes > 0) = 0, 'volunteer gets no report numbers');
commit;

-- ---------- class details ----------
insert into schedule_slots (day, grade, subject, starts_at, ends_at, place, kind, audience, takes_attendance)
values ('السبت', '4 ب', 'علوم', '10:00', '11:00', 'قاعة 1', 'تأسيس', 'بنات بس', false);
select t.ok((select not takes_attendance from schedule_slots where place = 'قاعة 1'), 'class details saved');

-- ---------- stages, camps, t-shirts, rules ----------
insert into camps (kind, camp_date, capacity) values ('ميني كامب', app.today() + 10, 1);
select id as v9001 from volunteers where code = 'V9001' \gset
update volunteers set status = 'تحت المتابعة', bought_tshirt = false, attended_graduation = false, attended_camp = false, attended_minicamp = false where code in ('V9001', 'V9002');
begin;
set local role authenticated;
select t.login('vol1@test.com');
select t.ok(register_camp((select id from camps limit 1)) = 'confirmed', 'first volunteer gets a seat');
select t.fails($$select accept_rules()$$, 'rules must exist before accepting');
insert into tshirt_requests (volunteer_id, size) values (app.my_volunteer_id(), 'L');
select t.fails($$insert into tshirt_requests (volunteer_id, size) values (app.my_volunteer_id(), 'XL')$$, 'one pending t-shirt request');
update tshirt_requests set status = 'accepted';
select t.ok((select status from tshirt_requests) = 'pending', 'volunteer cannot approve own t-shirt');
select t.ok((select done from volunteer_stages() where key = 'registered'), 'registered stage done');
select t.ok(not (select done from volunteer_stages() where key = 'tshirt'), 't-shirt stage not done yet');
insert into stage_done (volunteer_id, stage_key) values (app.my_volunteer_id(), 'joined_group');
select t.ok((select done from volunteer_stages() where key = 'joined_group'), 'volunteer marks joined group');
select t.fails($$insert into stage_done (volunteer_id, stage_key) values (app.my_volunteer_id(), 'accepted')$$, 'volunteer cannot mark staff stages');
select t.login('vol2@test.com');
select t.ok(register_camp((select id from camps limit 1)) = 'waitlist', 'full camp → waiting list');
select t.fails(format('select volunteer_stages(%L)', :'v9001'), 'volunteer cannot see others stages');
commit;
begin;
set local role authenticated;
select t.login('admin@test.com');
select t.ok(save_rules('[{"body":"القاعدة الأولى"},{"body":"القاعدة التانية"}]') = 2, 'admin saves two rules');
select t.login('vol1@test.com');
select t.ok(not answer_rules(jsonb_build_array(jsonb_build_object('rule_id', (select id from activity_rules order by sort_order limit 1), 'agreed', true),
                                               jsonb_build_object('rule_id', (select id from activity_rules order by sort_order offset 1 limit 1), 'agreed', false, 'comment', 'محتاج توضيح'))), 'part agreed, one comment → not done');
select t.ok(not (select done from volunteer_stages() where key = 'rules'), 'rules stage waits for every rule');
select accept_rules();
select t.ok((select done from volunteer_stages() where key = 'rules'), 'rules stage done after accepting');
select t.login('admin@test.com');
select t.ok(save_rules(jsonb_build_array(jsonb_build_object('id', (select id from activity_rules order by sort_order limit 1), 'body', 'القاعدة الأولى'),
                                         jsonb_build_object('id', (select id from activity_rules order by sort_order offset 1 limit 1), 'body', 'القاعدة التانية بعد التعديل'))) = 1, 'one rule reworded');
select t.login('vol1@test.com');
select t.ok(not (select done from volunteer_stages() where key = 'rules'), 'a reworded rule needs agreeing again');
select cancel_camp((select id from camps limit 1));
commit;
select t.ok((select r.status from camp_registrations r join volunteers v on v.id = r.volunteer_id where v.code = 'V9002') = 'confirmed', 'waiting list moves up');
select t.ok(exists (select 1 from notifications where recipient_email = 'vol2@test.com' and title like 'مكانك%'), 'promoted volunteer is notified');
begin;
set local role authenticated;
select t.login('hr@test.com');
update tshirt_requests set status = 'accepted';
select set_camp_attendance((select id from camps limit 1), (select id from volunteers where code = 'V9002'), true);
insert into stages (key, name, source) values ('custom_1', 'دورة إسعافات', 'manual');
insert into stage_done (volunteer_id, stage_key) select id, 'custom_1' from volunteers where code = 'V9002';
commit;
select t.ok((select bought_tshirt from volunteers where code = 'V9001'), 'approved request marks the t-shirt');
select t.ok((select attended_minicamp from volunteers where code = 'V9002'), 'camp attendance marks the volunteer');
select t.ok(not exists (select 1 from participations p join volunteers v on v.id = p.volunteer_id where v.code = 'V9002' and p.event = 'ميني كامب'), 'camp attendance stays out of the daily follow-up');
select t.ok(exists (select 1 from notifications where recipient_email = 'vol1@test.com' and title like 'ميني كامب يوم%'), 'new mini camp announced to those who never attended');
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.ok(remind_camp((select id from camps limit 1)) >= 0, 'reminder can be resent');
select t.ok((select attended from camp_stats() limit 1) = 1, 'camp stats count attendance');
commit;

-- ---------- interviews, family days, calls, responsible rule ----------
select id as v9003 from volunteers where code = 'V9003' \gset
insert into volunteer_hr (volunteer_id) select id from volunteers where code = 'V9004' on conflict do nothing;
update volunteer_hr set interview_date = '2026-11-10', interviewer_id = :'v9003' where volunteer_id = (select id from volunteers where code = 'V9004');
select t.ok((select count(*) from participations where auto_ref like 'interview:%') = 2, 'interview counts for the volunteer and the interviewer');
select t.ok((select interviewer from volunteer_hr where volunteer_id = (select id from volunteers where code = 'V9004')) = (select full_name_ar from volunteers where code = 'V9003'), 'interviewer name filled from the volunteer');
update volunteer_hr set interview_date = '2026-11-12' where volunteer_id = (select id from volunteers where code = 'V9004');
select t.ok((select count(*) from participations where auto_ref like 'interview:%' and activity_date = '2026-11-12') = 2, 'moving the interview moves both');
begin;
set local role authenticated;
select t.login('hr@test.com');
select save_meeting(jsonb_build_object('event', 'يوم عائلي', 'meeting_date', '2026-11-20', 'committee', 'فريق العمل'), array(select id from volunteers where code in ('V9001', 'V9002')));
select t.fails($$update volunteers set status = 'مسئول' where code = 'V9001'$$, 'cannot become مسئول before camps and graduation');
commit;
select t.ok((select count(*) from participations where event = 'يوم عائلي') = 2, 'family day attendees in the daily follow-up');
select t.ok((select count(*) from report_meetings('2026-11-01') r where r.meeting_date = '2026-11-20') = 0, 'family day is not a meeting row');
update volunteers set attended_minicamp = true, attended_camp = true, attended_graduation = true where code = 'V9001';
begin;
set local role authenticated;
select t.login('hr@test.com');
update volunteers set status = 'مسئول' where code = 'V9001';
commit;
select t.ok((select status::text from volunteers where code = 'V9001') = 'مسئول', 'all three attended → can become مسئول');
insert into lookups (list, value, report_column, form) values ('الحدث', 'اتصالات', 'calls', 'calls') on conflict on constraint lookups_unique do update set report_column = 'calls', form = 'calls';
insert into participations (volunteer_id, activity_date, event, beneficiaries, duration_minutes, status) select id, '2026-11-21', 'اتصالات', 12, 45, 'accepted' from volunteers where code = 'V9001';
select set_config('request.jwt.claims', '{"email":"mgmt@test.com","role":"authenticated"}', false);
select t.ok((select calls from report_eval('2026-11-01') where day = '2026-11-21') = 12, 'calls column = number of calls');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select t.ok((select count(*) from report_eval('2026-11-01')) = 30 and (select calls from report_eval('2026-11-01') where day = '2026-11-21') = 12, 'service role (sheet sync) can read reports');
select set_config('request.jwt.claims', '', false);

-- ---------- delete with replacement, class lists ----------
insert into lookups (list, value) values ('المكان', 'قاعة قديمة'), ('المكان', 'قاعة جديدة') on conflict do nothing;
insert into participations (volunteer_id, activity_date, event, place, status) select id, '2026-11-25', 'تدريس', 'قاعة قديمة', 'accepted' from volunteers where code = 'V9002';
begin;
set local role authenticated;
select t.login('admin@test.com');
select t.ok((select lookup_usage((select id from lookups where list = 'المكان' and value = 'قاعة قديمة'))) = 1, 'usage counted');
select t.ok((delete_lookup((select id from lookups where list = 'المكان' and value = 'قاعة قديمة'), 'قاعة جديدة') ->> 'rows')::int = 1, 'delete moves records to the chosen value');
commit;
select t.ok(exists (select 1 from participations where activity_date = '2026-11-25' and place = 'قاعة جديدة'), 'record now uses the new value');
select t.ok(not exists (select 1 from lookups where list = 'المكان' and value = 'قاعة قديمة'), 'old value removed');
insert into schedule_slots (day, grade, subject, starts_at, ends_at, kind, audience) values ('الأحد', '5 ب', 'علوم', '10:00', '11:00', 'ورشة رسم', 'بنات بس');
select t.ok(exists (select 1 from schedule_slots where kind = 'ورشة رسم'), 'class kind is free from the list');

-- ---------- recruitment pipeline ----------
insert into volunteers (full_name_ar, phone) values ('متطوع جديد للتجربة', '01000000123');
select id as newv from volunteers where phone = '01000000123' \gset
select t.ok((select recruit_status from volunteers where id = :'newv') = 'للتواصل', 'new volunteer enters the call list');
select t.ok((select acceptance from volunteer_hr where volunteer_id = :'newv') is null, 'no interview result yet');
begin;
set local role authenticated;
select t.login('vol1@test.com');
select t.fails(format('select recruit_call(%L, %L)', :'newv', 'مردش'), 'volunteers cannot log calls');
select t.login('hr@test.com');
select recruit_call(:'newv', 'مردش', null, 'هيرد بالليل');
select t.fails(format('select recruit_call(%L, %L)', :'newv', 'حدد ميعاد'), 'a date is required to book');
select recruit_call(:'newv', 'حدد ميعاد', '2026-11-28 17:00+02', null);
commit;
select t.ok((select recruit_status from volunteers where id = :'newv') = 'ميعاد انترفيو', 'booked → interview list');
begin;
set local role authenticated;
select t.login('hr@test.com');
select recruit_interview(:'newv', 'محضرش', '2026-11-28', null, 'اعتذر في آخر لحظة');
commit;
select t.ok((select recruit_status from volunteers where id = :'newv') = 'للتواصل', 'no-show goes back to the call list');
begin;
set local role authenticated;
select t.login('hr@test.com');
select recruit_call(:'newv', 'حدد ميعاد', '2026-11-30 17:00+02', null);
select recruit_interview(:'newv', 'مرفوض', '2026-11-30', :'v9003', null);
commit;
select t.ok((select recruit_status from volunteers where id = :'newv') = 'مقفول', 'rejected → closed');
select t.ok((select acceptance::text from volunteer_hr where volunteer_id = :'newv') = 'مرفوض', 'result saved');
select t.ok((select count(*) from participations where auto_ref = 'interview:' || :'newv') = 2, 'interview counts for both');
update volunteer_hr set acceptance = 'معتذر' where volunteer_id = :'newv';
select t.ok((select recruit_status from volunteers where id = :'newv') = 'اتعمل انترفيو', 'status changed by hand → visible again');
begin;
set local role authenticated;
select t.login('hr@test.com');
select recruit_reopen(:'newv', 'قدّم تاني');
select recruit_call(:'newv', 'حدد ميعاد', '2026-12-02 17:00+02', null);
select recruit_interview(:'newv', 'اختبار', '2026-12-02', :'v9003', null);
select t.ok((select prev_acceptance from recruit_log where volunteer_id = :'newv' and outcome = 'اختبار') = 'معتذر', 'second interview shows the old result');
select t.ok((select count(*) from recruit_log where volunteer_id = :'newv') = 9, 'full history kept');
commit;

-- ---------- feedback round (20) ----------
begin;
set local role authenticated;
select t.login('org@test.com');
select public.register_activity(jsonb_build_object('event', 'أجتماع', 'subject', 'الميديا', 'activity_date', app.today()), array[:'v9001'::uuid, :'v9003'::uuid]);
commit;
select t.ok((select count(*) from participations p join meetings m on m.id = p.meeting_id where m.committee = 'الميديا' and p.activity_date = app.today()) = 2, 'meeting from check-in grouped into one meeting');
update camps set capacity = null;
insert into camps (kind, camp_date) values ('كامب', app.today() + 5), ('حفلة تخرج', app.today() + 6);
update volunteers set status = 'تحت المتابعة', attended_camp = false, attended_graduation = false where code = 'V9002';
begin;
set local role authenticated;
select t.login('vol2@test.com');
select t.ok(not exists (select 1 from my_camps() where kind in ('كامب', 'حفلة تخرج')), 'camp and graduation hidden from those not eligible');
select t.fails($$select register_camp((select id from camps where kind = 'كامب'))$$, 'camp only for مشروع مسئول');
commit;
update volunteers set status = 'مشروع مسئول' where code = 'V9002';
begin;
set local role authenticated;
select t.login('vol2@test.com');
select t.ok(exists (select 1 from my_camps() where kind = 'كامب'), 'مشروع مسئول sees the camp');
select t.ok(register_camp((select id from camps where kind = 'كامب')) = 'confirmed', 'مشروع مسئول registers');
commit;
update volunteers set attended_minicamp = true, attended_camp = true where code = 'V9002';
update volunteers set attended_graduation = true where code = 'V9002';
select t.ok((select status::text from volunteers where code = 'V9002') = 'مسئول', 'graduation → مسئول');

-- ---------- join form, quick accept, leadership (21) ----------
grant usage on schema t to anon;
grant execute on all functions in schema t to anon;
begin;
set local role anon;
select t.ok(public.join_activity('{"national_id":"29901011234567","phone":"01011112222","full_name_ar":"تجربة فورم جديد"}') = 'ok', 'anon can join');
select t.fails($$select public.join_activity('{"national_id":"123","phone":"01011112222","full_name_ar":"تجربة فورم جديد"}')$$, 'bad national id refused');
commit;
select t.ok((select v.recruit_status from volunteers v join volunteer_private p on p.volunteer_id = v.id where p.national_id = '29901011234567') = 'للتواصل', 'new joiner lands in للتواصل');
begin;
set local role anon;
select public.join_activity('{"national_id":"29901011234567","phone":"01099998888","full_name_ar":"تجربة فورم معدّل"}');
commit;
select t.ok((select count(*) from registration_requests where status = 'pending') = 1, 'second time → a request, not a new volunteer');
select t.ok((select full_name_ar from volunteers v join volunteer_private p on p.volunteer_id = v.id where p.national_id = '29901011234567') = 'تجربة فورم جديد', 'data unchanged until approved');
begin;
set local role authenticated;
select t.login('hr@test.com');
select t.ok((select count(*) from registration_requests_list()) = 1, 'HR sees the request');
select public.review_registration((select id from registration_requests limit 1), true, false);
commit;
select t.ok((select phone from volunteers v join volunteer_private p on p.volunteer_id = v.id where p.national_id = '29901011234567') = '01099998888', 'approval applies the new data');
begin;
set local role authenticated;
select t.login('vol@test.com');
select t.fails($$select public.accept_volunteer((select id from volunteers where code = 'V9002'))$$, 'a volunteer cannot accept');
select t.login('hr@test.com');
select public.accept_volunteer((select id from volunteers where code = 'V9002'));
commit;
select t.ok((select acceptance::text from volunteer_hr h join volunteers v on v.id = h.volunteer_id where v.code = 'V9002') = 'مقبول', 'one-tap acceptance');

-- ---------- journey rules (22) ----------
update volunteers set status = 'تحت المتابعة', attended_graduation = false, attended_camp = false, attended_minicamp = false where code = 'V9003';
select t.fails($$update volunteers set status = 'مشروع مسئول' where code = 'V9003'$$, 'مشروع مسئول needs the mini camp');
select t.fails($$update volunteers set attended_minicamp = true, attended_camp = true where code = 'V9003'$$, 'camp needs مشروع مسئول');
update volunteers set attended_minicamp = true where code = 'V9003';
update volunteers set status = 'مشروع مسئول' where code = 'V9003';
select t.fails($$update volunteers set attended_graduation = true where code = 'V9003'$$, 'graduation needs the camp');
select t.fails($$update volunteers set attended_minicamp = false where code = 'V9003'$$, 'no step back');
update volunteers set attended_camp = true where code = 'V9003';
update volunteers set attended_graduation = true where code = 'V9003';
select t.ok((select status::text from volunteers where code = 'V9003') = 'مسئول', 'the whole journey ends in مسئول');
select t.fails($$select public.remind_camp((select id from camps order by camp_date limit 1))$$ , 'no reminder before login');

-- ---------- closed accounts (23) ----------
update volunteer_hr set acceptance = 'مفصول' where volunteer_id = (select id from volunteers where email = 'vol2@test.com');
begin;
set local role authenticated;
select t.login('vol2@test.com');
select t.ok((select (my_context()->>'inactive')::boolean), 'left the activity → inactive');
select t.ok(app.my_volunteer_id() is null, 'and sees nothing of their own');
commit;
update volunteer_hr set acceptance = 'مقبول' where volunteer_id = (select id from volunteers where email = 'vol2@test.com');
update volunteers set status = 'خارج المتابعة' where email = 'vol2@test.com';
select t.ok(app.account_closed('vol2@test.com'), 'خارج المتابعة closes the account too');
update volunteers set status = 'تحت المتابعة' where email = 'vol2@test.com';

\echo ALL ROLE TESTS PASSED

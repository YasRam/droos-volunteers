-- Management emails: what the daily email picks up, edits, and who may send.
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
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into volunteers (code, full_name_ar, phone, email, main_committee, status, registered_at) values
  ('M9001', 'متطوع المتابعة', '01000000201', 'm1@test.com', 'تدريس', 'تحت المتابعة', now());
insert into staff_roles (email, full_name, role) values ('m-admin@test.com', 'أدمن', 'admin'), ('m-org@test.com', 'تنظيم', 'organizer');

-- what the earlier test files made counts as already sent
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select mail_mark_sent('followup', array(select (r ->> 'id')::uuid from jsonb_array_elements(mail_followup_batch() -> 'rows') r), 'قديم', true);
select mail_mark_sent('meetings', array(select (r ->> 'id')::uuid from jsonb_array_elements(mail_followup_batch() -> 'meetings') r), 'قديم', true);
delete from mail_log;
select set_config('request.jwt.claims', '', false);

insert into participations (volunteer_id, activity_date, event, subject, grade, place, beneficiaries, status)
  select id, app.today() - 1, 'تدريس', 'انجليزي', '2 ع', 'الفرع', 4, 'accepted' from volunteers where code = 'M9001';
insert into participations (volunteer_id, activity_date, event, subject, status)
  select id, app.today() - 1, 'تحضير محتوى', 'علوم', 'pending' from volunteers where code = 'M9001';

-- the script (service role)
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select t.ok(jsonb_array_length(mail_followup_batch() -> 'rows') = 1, 'only accepted participations are sent');
select t.ok((mail_followup_batch() -> 'rows' -> 0 ->> 'phone') = '01000000201', 'the row carries the phone');
select t.ok((mail_followup_batch() -> 'rows' -> 0 ->> 'day') = app.day_name_ar(app.today() - 1), 'the row carries the day name');
select mail_mark_sent('followup', array(select (r ->> 'id')::uuid from jsonb_array_elements(mail_followup_batch() -> 'rows') r),
                      'الميل الشهرى', true);
select t.ok(jsonb_array_length(mail_followup_batch() -> 'rows') = 0, 'nothing is sent twice');
select t.ok(jsonb_array_length(mail_followup_edits() -> 'edits') = 0, 'no edits yet');

update participations set beneficiaries = 6 where event = 'تدريس' and volunteer_id = (select id from volunteers where code = 'M9001');
select t.ok(jsonb_array_length(mail_followup_edits() -> 'edits') = 1, 'an edit to a sent row shows up');
select t.ok((mail_followup_edits() -> 'edits' -> 0 -> 'old' ->> 'students') = '4'
        and (mail_followup_edits() -> 'edits' -> 0 -> 'new' ->> 'students') = '6', 'the edit has old and new');
select mail_mark_sent('edits', array(select (e -> 'old' ->> 'id')::uuid from jsonb_array_elements(mail_followup_edits() -> 'edits') e),
                      'الميل الشهرى', true);
select t.ok(jsonb_array_length(mail_followup_edits() -> 'edits') = 0, 'a sent edit is not sent again');

update participations set status = 'rejected' where event = 'تدريس' and volunteer_id = (select id from volunteers where code = 'M9001');
select t.ok((mail_followup_edits() -> 'edits' -> 0 -> 'new') = 'null'::jsonb, 'a removed row shows as removed');

-- a failed send is logged and the rows stay waiting
update participations set status = 'accepted' where event = 'تحضير محتوى' and volunteer_id = (select id from volunteers where code = 'M9001');
select mail_mark_sent('followup', array(select (r ->> 'id')::uuid from jsonb_array_elements(mail_followup_batch() -> 'rows') r),
                      'الميل الشهرى', false, 'مفيش إيميل بالعنوان ده');
select t.ok(jsonb_array_length(mail_followup_batch() -> 'rows') = 1, 'a failed send is retried next time');
select t.ok((select count(*) from mail_log where not ok) = 1, 'the failure is logged');
select set_config('request.jwt.claims', '', false);

-- people
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"m-org@test.com","role":"authenticated"}', true);
select t.fails($$select mail_followup_batch()$$, 'organizer cannot read the management email');
select t.ok((select count(*) from mail_settings) = 0, 'organizer does not see the mail settings');
select t.ok((select count(*) from mail_access_rows(array(select id from volunteers))) = 0, 'organizer cannot list access rows');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"m-admin@test.com","role":"authenticated"}', true);
select t.ok((select count(*) from mail_access_rows(array(select id from volunteers where code = 'M9001'))) = 1, 'admin lists the chosen volunteers');
select mail_mark_sent('access', array(select id from volunteers where code = 'M9001'), 'الأكسس', true, null, 'جدول');
select t.ok((select sent_by from mail_log where kind = 'access') = 'm-admin@test.com', 'a manual send records who sent it');
update mail_settings set enabled = true, access_subject = 'أكسس الفرع';
select t.ok((select access_subject from mail_settings) = 'أكسس الفرع', 'admin edits the mail settings');
rollback;

select 'ALL MAIL TESTS PASSED';

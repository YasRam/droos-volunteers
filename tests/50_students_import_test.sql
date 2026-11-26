-- Uploading the students' sheet: preview, apply, upload again, and leave site edits alone.
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
  ('I9001', 'مدرس العربي', '01000000201', 'i-teacher@test.com', 'تدريس', 'تحت المتابعة', now());
insert into staff_roles (email, full_name, role) values ('i-admin@test.com', 'أدمن', 'admin'), ('i-org@test.com', 'تنظيم', 'organizer');
insert into schedule_slots (day, grade, subject, kind, starts_at, ends_at, volunteer_id, status)
select 'الجمعة', '1 ب', 'لغة عربية', 'حصة', '11:30', '13:00', id, 'شغالة' from volunteers where code = 'I9001';

create temp table payload (p jsonb);
grant select on payload to authenticated;
insert into payload values ($j${
  "term": {"name": "ترم الاستيراد", "starts_on": "2026-09-01", "ends_on": "2027-01-31"},
  "students": [
    {"key": "a", "name": "أحمد محمد علي", "grade": "1 ب", "status": "مقبول", "is_new": false, "papers": "تم",
     "national_id": "31909150201234", "school": "مدرسة النور", "shift": "صباحي",
     "private": {"address": "شارع 1", "father_name": "محمد علي", "important_notes": "دخل ضعيف"},
     "guardian": {"name": "محمد علي", "national_id": "28001010101011", "phone": "01100000011"},
     "phones": [{"number": "01100000011", "label": "البيت/ولي الأمر"}, {"number": "01200000011", "label": "محمول", "is_whatsapp": true}]},
    {"key": "b", "name": "منى محمد علي", "grade": "1 ب", "status": "مقبول",
     "guardian": {"name": "محمد علي", "national_id": "28001010101011", "phone": "01100000011"}},
    {"key": "c", "name": "سارة حسن", "grade": "2 ب", "status": "انتظار", "notes": "من استمارة 2025"}
  ],
  "sessions": [
    {"key": "1ب|2026-10-02|لغة عربية|1", "grade": "1 ب", "date": "2026-10-02", "subject": "لغة عربية", "subjects": ["لغة عربية"],
     "marks": [{"student": "a", "mark": "حاضر"}, {"student": "b", "mark": "غائب"}]},
    {"key": "1ب|2026-10-03|رياضيات|1", "grade": "1 ب", "date": "2026-10-03", "subject": "رياضيات", "subjects": ["رياضيات"],
     "note": "التاريخ تقريبي", "marks": [{"student": "a", "mark": "غائب"}, {"student": "b", "mark": "غائب"}]},
    {"key": "1ب|2026-10-09|لغة عربية|1", "grade": "1 ب", "date": "2026-10-09", "subject": "لغة عربية", "subjects": ["لغة عربية"],
     "marks": [{"student": "a", "mark": "حاضر"}, {"student": "b", "mark": "غائب"}]}
  ]
}$j$);

-- ---------- who may ----------
select set_config('request.jwt.claims', '{"email":"i-org@test.com","role":"authenticated"}', false);
set role authenticated;
select t.fails($$select students.import_sheet((select p from payload), false)$$, 'organizer cannot upload the sheet');
reset role;

select set_config('request.jwt.claims', '{"email":"i-admin@test.com","role":"authenticated"}', false);
set role authenticated;

-- ---------- preview changes nothing ----------
select t.ok((students.import_sheet((select p from payload), false))->>'students_new' = '3', 'preview counts 3 new students');
reset role;
select t.ok(not exists (select 1 from students.students where full_name = 'أحمد محمد علي'), 'preview wrote nothing');
select t.ok(not exists (select 1 from students.terms where name = 'ترم الاستيراد'), 'preview made no term');
set role authenticated;

-- ---------- apply ----------
create temp table r1 as select students.import_sheet((select p from payload), true) r;
reset role;
select t.ok((select r->>'students_new' from r1) = '3', 'three students added');
select t.ok((select r->>'guardians_new' from r1) = '1', 'brother and sister share one guardian');
select t.ok((select count(*) from students.enrollments e join students.terms tm on tm.id = e.term_id where tm.name = 'ترم الاستيراد') = 2,
            'the two accepted students are enrolled');
select t.ok((select status from students.applications a join students.students s on s.id = a.student_id where s.full_name = 'سارة حسن') = 'انتظار',
            'the waiting one is only an application');
select t.ok((select count(*) from students.class_sessions where import_key like '1ب|%') = 3, 'three classes');
select t.ok((select slot_id is not null and starts_at = '11:30' and array_length(teacher_ids, 1) = 1
               from students.class_sessions where import_key = '1ب|2026-10-02|لغة عربية|1'), 'a class linked to its weekly slot and teacher');
select t.ok((select slot_id is null from students.class_sessions where import_key = '1ب|2026-10-03|رياضيات|1'), 'no slot: a one-off class');
select t.ok((select present_count from students.class_sessions where import_key = '1ب|2026-10-02|لغة عربية|1') = 1, 'present count');
select t.ok(not exists (select 1 from notifications where title in ('غياب', 'تحذير غياب', 'طلب فصل طالب')), 'old absences notified nobody');
select t.ok(not exists (select 1 from students.dismissal_requests), 'no dismissal request from old absences');
select t.ok((select e.status from students.enrollments e join students.students s on s.id = e.student_id where s.full_name = 'منى محمد علي') = 'تحذير',
            'three absences: quiet warning');
select t.ok(not exists (select 1 from participations where auto_ref like 'session:%'), 'no volunteer participations from the import');
select t.ok((select national_id from students.student_private sp join students.students s on s.id = sp.student_id where s.full_name = 'أحمد محمد علي') = '31909150201234',
            'national id saved privately');
select t.ok((select count(*) from students.phones p join students.students s on s.id = p.student_id where s.full_name = 'أحمد محمد علي') = 2, 'phones');
select t.ok(exists (select 1 from students.audiences a join schedule_slots sl on sl.id = a.slot_id where sl.subject = 'لغة عربية' and a.grade = '1 ب'),
            'the weekly slot now knows its grade');

-- someone fixes a mark in the site, and writes an address
update students.attendance set mark = 'معتذر', recorded_by = 'i-org@test.com'
 where student_id = (select id from students.students where full_name = 'منى محمد علي')
   and session_id = (select id from students.class_sessions where import_key = '1ب|2026-10-02|لغة عربية|1');

-- ---------- upload again (a newer copy: spelling differs, one mark changed, one class added) ----------
update payload set p = jsonb_set(p, '{students,0,name}', '"احمد محمد على"');
update payload set p = jsonb_set(p, '{sessions,2,marks,1,mark}', '"حاضر"');
update payload set p = jsonb_set(p, '{sessions}', (p->'sessions') || $j$[{"key": "1ب|2026-10-16|لغة عربية|1", "grade": "1 ب", "date": "2026-10-16",
   "subject": "لغة عربية", "subjects": ["لغة عربية"], "marks": [{"student": "a", "mark": "حاضر"}, {"student": "b", "mark": "حاضر"}]}]$j$::jsonb);
set role authenticated;
create temp table r2 as select students.import_sheet((select p from payload), true) r;
reset role;
select t.ok((select r->>'students_new' from r2) = '0' and (select r->>'students_updated' from r2) = '3', 'second upload adds no student twice');
select t.ok((select count(*) from students.students where students.norm_name(full_name) = students.norm_name('أحمد محمد علي')) = 1,
            'same student whatever the spelling');
select t.ok((select r->>'sessions_new' from r2) = '1', 'only the new class is added');
select t.ok((select r->>'marks_changed' from r2) = '1', 'a mark changed in the sheet is updated');
select t.ok((select mark from students.attendance a join students.students s on s.id = a.student_id
              join students.class_sessions c on c.id = a.session_id
             where s.full_name = 'منى محمد علي' and c.import_key = '1ب|2026-10-02|لغة عربية|1') = 'معتذر',
            'a mark fixed in the site is kept');
select t.ok((select count(*) from students.guardians where national_id = '28001010101011') = 1, 'guardian not duplicated');
select t.ok((select count(*) from students.phones p join students.students s on s.id = p.student_id where s.full_name = 'أحمد محمد علي') = 2, 'phones not duplicated');
select t.ok(students.norm_name('عبد الله  أحمد') = students.norm_name('عبدالله احمد'), 'name spelling');

\echo ALL IMPORT TESTS PASSED

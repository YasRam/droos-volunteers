-- =====================================================================
-- 31) Students: the tables, who sees what, and the wall between families and volunteers.
--
--  * Everything about students lives in its own schema, «students». The only links to the
--    volunteers' side are the classes: public.schedule_slots (the weekly class) and
--    students.class_sessions (each time it happened) name the volunteer who teaches.
--  * Guardians and students sign in as their own Supabase users. students.accounts says which
--    user is a guardian or a student. Such a «family» account can reach the «students» schema and
--    its own notifications / push subscription, and nothing else (app.pre_request + storage).
--  * Who sees a student:
--      family            the guardian sees their children (and asks to change data), the student
--                        sees themself, read only
--      teacher           the volunteer teaching a class (or teaching in someone's place) sees the
--                        names, attendance and grades of that class's students — no phones
--      students.view_all           تنظيم: every student, attendance, groups, flags
--      students.view_contacts      الإدارة: phones, address, guardian contacts
--      students.view_sensitive     الليدر: national IDs, income, support, health notes
--
--  Changes to the volunteers' side (all additive):
--    - public.schedule_slots: starts_on, ends_on, status  (a class runs weekly until it ends,
--      is stopped or is cancelled)
--    - public.roles: the new students.* permissions given to the built-in roles
--    - app.pre_request(): PostgREST calls it before every API request; it only refuses
--      family accounts outside their area. Volunteers are not affected.
--    - storage.objects policies: family accounts can't upload to the volunteers' buckets
-- =====================================================================

create schema if not exists students;
grant usage on schema students to authenticated, service_role;
comment on schema students is 'بيانات الطلاب وأولياء الأمور. منفصلة عن المتطوعين، والربط من خلال الحصص بس.';

-- ---------------------------------------------------------------------
-- 1) Settings and lists
-- ---------------------------------------------------------------------
create table students.settings (
  id             boolean primary key default true check (id),
  warn_after     int not null default 3 check (warn_after > 0),   -- تحذير لولي الأمر والتنظيم
  dismiss_after  int not null default 5 check (dismiss_after > 0), -- طلب فصل (داخلي، مش بيظهر للأسرة)
  check (dismiss_after >= warn_after)
);
insert into students.settings default values;
comment on table students.settings is 'حدود الغياب. ولي الأمر بيتبلغ إن 3 = فصل، والسماح لحد 5 داخلي.';

-- What families see on «صفحة الجمعية»
create table students.org_info (
  id        boolean primary key default true check (id),
  name      text not null default 'نشاط دروس تقوية — جمعية رسالة، فرع إسكندرية',
  phone     text,
  address   text,
  about     text,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into students.org_info default values;

create table students.terms (
  id          uuid primary key default extensions.gen_random_uuid(),
  name        text not null unique,          -- الترم الأول 2026-2027
  starts_on   date not null,
  ends_on     date not null,
  is_current  boolean not null default false,
  check (ends_on > starts_on)
);
create unique index terms_one_current on students.terms (is_current) where is_current;

create table students.grades (
  code        text primary key,              -- 1 ب … 3 ع
  sort_order  int not null default 0,
  is_active   boolean not null default true
);
insert into students.grades (code, sort_order) values
  ('1 ب', 1), ('2 ب', 2), ('3 ب', 3), ('4 ب', 4), ('5 ب', 5), ('6 ب', 6), ('1 ع', 7), ('2 ع', 8), ('3 ع', 9);

-- Same grade whatever the spacing («4ب» in the schedule, «4 ب» in the form).
create or replace function students.norm_grade(g text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(g, ''), '\s+', '', 'g'), '')
$$;

-- Attendance marks. counts_absence: towards the warning / dismissal count.
create table students.attendance_marks (
  code            text primary key,
  description     text,
  is_present      boolean not null default false,  -- حضر (بيتحسب في عدد الطلاب)
  counts_absence  boolean not null default false,
  is_violation    boolean not null default false,
  sort_order      int not null default 0,
  is_active       boolean not null default true
);
insert into students.attendance_marks (code, description, is_present, counts_absence, is_violation, sort_order) values
  ('حاضر',  'حضر الحصة', true, false, false, 1),
  ('غائب',  'لم يحضر بدون عذر', false, true, true, 2),
  ('معتذر', 'لم يحضر بعذر', false, false, false, 3),
  ('تأخير', 'حضر ولكن تأخر', true, false, true, 4),
  ('كارنيه', 'لم يحضر الكارنيه وتم السماح له بالحضور', true, false, true, 5),
  ('واجب',  'لم يحل الواجب وتم السماح له بالحضور', true, false, true, 6),
  ('شغب',   'حضر الحصة وتم طرده بسبب شغب', true, false, true, 7),
  ('طرد',   'تم طرده قبل حضور الحصة', false, false, true, 8),
  ('إجازة', 'في إجازة (بتتسجل لوحدها)', false, false, false, 9),
  ('فصل مؤقت', 'مفصول فصل مؤقت (بتتسجل لوحدها)', false, false, false, 10);

-- ---------------------------------------------------------------------
-- 2) Guardians and students
-- ---------------------------------------------------------------------
create table students.guardians (
  id               uuid primary key default extensions.gen_random_uuid(),
  full_name        text not null,
  relation         text not null default 'أب',   -- أب، أم، عم، جدة، …
  national_id      text unique check (national_id ~ '^[23][0-9]{13}$'),
  id_valid_until   date,
  job              text,
  phone            text check (phone ~ '^01[0125][0-9]{8}$'),
  email            extensions.citext,
  custody_document text,           -- صورة الورقة لو ولي الأمر مش الأب
  verified_by      text,
  verified_at      timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text
);
create index guardians_phone_idx on students.guardians (phone);

create table students.students (
  id            uuid primary key default extensions.gen_random_uuid(),
  legacy_code   text unique,
  full_name     text not null,
  gender        text check (gender in ('ذكر', 'أنثى')),   -- من الرقم القومي
  birth_date    date,                                    -- من الرقم القومي
  school        text,
  school_shift  text check (school_shift in ('صباحي', 'مسائي')),
  carnet_no     text unique,
  guardian_id   uuid references students.guardians (id) on delete set null,
  notes         text,                                   -- ملاحظات عامة (التنظيم)
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create index students_guardian_idx on students.students (guardian_id);
create index students_name_idx on students.students (full_name);

-- Sensitive: management / leader only (and the student's own guardian).
create table students.student_private (
  student_id          uuid primary key references students.students (id) on delete cascade,
  national_id         text unique check (national_id ~ '^[23][0-9]{13}$'),
  address             text,
  father_name         text,
  father_national_id  text check (father_national_id ~ '^[23][0-9]{13}$'),
  father_id_valid_until date,
  father_job          text,
  mother_name         text,
  mother_national_id  text check (mother_national_id ~ '^[23][0-9]{13}$'),
  mother_id_valid_until date,
  mother_job          text,
  kids_under_5        int check (kids_under_5 between 0 and 20),
  kids_5_to_10        int check (kids_5_to_10 between 0 and 20),
  boys_over_10        int check (boys_over_10 between 0 and 20),
  girls_over_10       int check (girls_over_10 between 0 and 20),
  family_income       text,     -- الدخل
  family_support      text,     -- الدعم اللي بياخدوه (تكافل وكرامة، …)
  health_notes        text,
  important_notes     text,
  updated_at          timestamptz not null default now(),
  updated_by          text,
  check (mother_national_id is null or father_national_id is null or mother_national_id <> father_national_id)
);

create table students.phones (
  id           uuid primary key default extensions.gen_random_uuid(),
  student_id   uuid not null references students.students (id) on delete cascade,
  number       text not null check (number ~ '^01[0125][0-9]{8}$'),
  label        text,                -- الأب، الأم، قريب، البيت
  is_whatsapp  boolean not null default false,
  sort_order   int not null default 0,
  unique (student_id, number)
);

-- Fill gender and birth date from the national ID (century digit 2 = 19xx, 3 = 20xx; 13th digit odd = male).
create or replace function students.from_national_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.national_id is not null and (tg_op = 'INSERT' or new.national_id is distinct from old.national_id) then
    update students.students s
       set birth_date = make_date(
             (case when substr(new.national_id, 1, 1) = '3' then 2000 else 1900 end) + substr(new.national_id, 2, 2)::int,
             substr(new.national_id, 4, 2)::int, substr(new.national_id, 6, 2)::int),
           gender = case when substr(new.national_id, 13, 1)::int % 2 = 1 then 'ذكر' else 'أنثى' end
     where s.id = new.student_id;
  end if;
  return null;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'الرقم القومي فيه تاريخ ميلاد غلط' using errcode = '22008';
end;
$$;
create trigger student_private_from_nid after insert or update of national_id on students.student_private
  for each row execute function students.from_national_id();

-- ---------------------------------------------------------------------
-- 3) Family accounts
-- ---------------------------------------------------------------------
create table students.accounts (
  user_id      uuid primary key,          -- auth.users.id
  kind         text not null check (kind in ('guardian', 'student')),
  guardian_id  uuid references students.guardians (id) on delete cascade,
  student_id   uuid references students.students (id) on delete cascade,
  login_email  extensions.citext not null unique,   -- real email, or <phone>@family.droos
  created_at   timestamptz not null default now(),
  created_by   text,
  check ((kind = 'guardian' and guardian_id is not null and student_id is null)
      or (kind = 'student' and student_id is not null and guardian_id is null))
);
create unique index accounts_one_per_guardian on students.accounts (guardian_id) where guardian_id is not null;
create unique index accounts_one_per_student on students.accounts (student_id) where student_id is not null;

-- ---------------------------------------------------------------------
-- 4) Admission, terms, groups
-- ---------------------------------------------------------------------
create table students.applications (
  id           uuid primary key default extensions.gen_random_uuid(),
  student_id   uuid not null references students.students (id) on delete cascade,
  term_id      uuid not null references students.terms (id),
  grade        text not null references students.grades (code) on update cascade,
  is_new       boolean not null default true,             -- مستجد / مقيد
  status       text not null default 'انتظار' check (status in
                 ('انتظار', 'لم يمتحن', 'انتظار التصحيح', 'إعادة امتحان', 'مقبول', 'مرفوض', 'بلاك ليست')),
  papers       text not null default 'ناقص' check (papers in ('ناقص', 'التحقق من الورق', 'تم')),
  carnet_given boolean not null default false,
  notes        text,
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  unique (student_id, term_id)
);

create table students.enrollments (
  id          uuid primary key default extensions.gen_random_uuid(),
  student_id  uuid not null references students.students (id) on delete cascade,
  term_id     uuid not null references students.terms (id),
  grade       text not null references students.grades (code) on update cascade,
  status      text not null default 'نشط' check (status in ('نشط', 'تحذير', 'مفصول', 'منقطع', 'اتنقل')),
  status_note text,
  status_at   timestamptz not null default now(),
  status_by   text,
  unique (student_id, term_id)
);
create index enrollments_term_grade_idx on students.enrollments (term_id, grade);

create table students.groups (
  id         uuid primary key default extensions.gen_random_uuid(),
  term_id    uuid not null references students.terms (id),
  name       text not null,
  kind       text not null default 'أخرى',      -- تأسيس، ولاد، بنات، ورشة، أخرى
  notes      text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (term_id, name)
);

create table students.group_members (
  group_id   uuid not null references students.groups (id) on delete cascade,
  student_id uuid not null references students.students (id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   text,
  primary key (group_id, student_id)
);
create index group_members_student_idx on students.group_members (student_id);

create table students.whatsapp_groups (
  id        uuid primary key default extensions.gen_random_uuid(),
  name      text not null,
  link      text not null check (link ~ '^https://'),
  target    text not null check (target in ('all', 'grade', 'group', 'slot')),
  grade     text references students.grades (code) on update cascade,
  group_id  uuid references students.groups (id) on delete cascade,
  slot_id   uuid references public.schedule_slots (id) on delete cascade,
  check ((target = 'all') or (target = 'grade' and grade is not null)
      or (target = 'group' and group_id is not null) or (target = 'slot' and slot_id is not null))
);

-- ---------------------------------------------------------------------
-- 5) Classes: the weekly class (public.schedule_slots) + who it is for + each time it happens
-- ---------------------------------------------------------------------
alter table public.schedule_slots
  add column if not exists starts_on date,
  add column if not exists ends_on   date,
  add column if not exists status    text not null default 'شغالة' check (status in ('شغالة', 'متوقفة', 'اتلغت'));
comment on column public.schedule_slots.ends_on is 'فاضي = الحصة بتتكرر كل أسبوع لحد ما تتوقف أو تتلغي.';

create table students.class_sessions (
  id                uuid primary key default extensions.gen_random_uuid(),
  slot_id           uuid references public.schedule_slots (id) on delete set null,  -- null = حصة مرة واحدة
  on_date           date not null,
  starts_at         time not null,
  ends_at           time not null,
  subject           text not null,
  kind              text not null default 'حصة' check (kind in ('حصة', 'امتحان')),
  takes_attendance  boolean not null default true,
  status            text not null default 'متوقعة' check (status in ('متوقعة', 'اتعملت', 'اتلغت', 'اتأجلت')),
  moved_to          uuid references students.class_sessions (id) on delete set null,  -- التأجيل
  teacher_ids       uuid[] not null default '{}',   -- المتطوعين اللي بيدّوها (من الحصة)
  substitute_id     uuid references public.volunteers (id) on delete set null,       -- درّس مكانه
  max_score         numeric check (max_score > 0),
  attendance_at     timestamptz,
  attendance_by     text,
  present_count     int,
  participation_ids uuid[] not null default '{}',   -- المشاركات اللي اتعملت في المتابعة اليومية
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        text,
  check (ends_at > starts_at),
  check (kind <> 'امتحان' or max_score is not null or status <> 'اتعملت')
);
create unique index class_sessions_slot_date on students.class_sessions (slot_id, on_date) where slot_id is not null and status <> 'اتأجلت';
create index class_sessions_date_idx on students.class_sessions (on_date);
create index class_sessions_teachers_idx on students.class_sessions using gin (teacher_ids);

-- Who a class is for. One row per choice; a class with no row is for nobody yet.
create table students.audiences (
  id          uuid primary key default extensions.gen_random_uuid(),
  slot_id     uuid references public.schedule_slots (id) on delete cascade,
  session_id  uuid references students.class_sessions (id) on delete cascade,
  target      text not null check (target in ('all', 'grade', 'group', 'student')),
  grade       text references students.grades (code) on update cascade,
  group_id    uuid references students.groups (id) on delete cascade,
  student_id  uuid references students.students (id) on delete cascade,
  check ((slot_id is null) <> (session_id is null)),
  check ((target = 'all') or (target = 'grade' and grade is not null)
      or (target = 'group' and group_id is not null) or (target = 'student' and student_id is not null))
);
create index audiences_slot_idx on students.audiences (slot_id);
create index audiences_session_idx on students.audiences (session_id);
create index audiences_group_idx on students.audiences (group_id);
create index audiences_student_idx on students.audiences (student_id);

-- Stops for a period (exams): all classes, or one grade.
create table students.schedule_pauses (
  id         uuid primary key default extensions.gen_random_uuid(),
  from_date  date not null,
  to_date    date not null,
  reason     text not null,
  grade      text references students.grades (code) on update cascade,   -- null = كل الحصص
  created_at timestamptz not null default now(),
  created_by text,
  check (to_date >= from_date)
);

-- Teacher / committee leader asks, تنظيم approves. Nothing applies before approval.
create table students.slot_requests (
  id            uuid primary key default extensions.gen_random_uuid(),
  slot_id       uuid not null references public.schedule_slots (id) on delete cascade,
  session_id    uuid references students.class_sessions (id) on delete cascade,
  kind          text not null check (kind in ('إلغاء مرة', 'تأجيل', 'إيقاف', 'إلغاء خالص')),
  on_date       date,              -- إلغاء مرة / تأجيل: الحصة اللي اتطلبت
  new_date      date,              -- تأجيل
  new_starts_at time,
  new_ends_at   time,
  pause_from    date,              -- إيقاف
  pause_to      date,
  from_date     date,              -- إلغاء خالص: من إمتى
  reason        text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by  text not null default app.email()::text,
  requested_at  timestamptz not null default now(),
  reviewed_by   text,
  reviewed_at   timestamptz,
  review_note   text,
  check (kind <> 'تأجيل' or (on_date is not null and new_date is not null and new_starts_at is not null and new_ends_at is not null)),
  check (kind <> 'إلغاء مرة' or on_date is not null),
  check (kind <> 'إيقاف' or (pause_from is not null and pause_to is not null and pause_to >= pause_from)),
  check (kind <> 'إلغاء خالص' or from_date is not null)
);
create index slot_requests_pending_idx on students.slot_requests (requested_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- 6) Attendance, grades, flags, leaves, notes
-- ---------------------------------------------------------------------
create table students.attendance (
  session_id  uuid not null references students.class_sessions (id) on delete cascade,
  student_id  uuid not null references students.students (id) on delete cascade,
  mark        text not null references students.attendance_marks (code) on update cascade,
  note        text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index attendance_student_idx on students.attendance (student_id);

create table students.exam_results (
  session_id  uuid not null references students.class_sessions (id) on delete cascade,
  student_id  uuid not null references students.students (id) on delete cascade,
  score       numeric not null check (score >= 0),
  note        text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  sent_at     timestamptz,
  primary key (session_id, student_id)
);
create index exam_results_student_idx on students.exam_results (student_id);

-- استدعاء ولي أمر / فصل مؤقت
create table students.flags (
  id               uuid primary key default extensions.gen_random_uuid(),
  student_id       uuid not null references students.students (id) on delete cascade,
  kind             text not null check (kind in ('استدعاء', 'فصل مؤقت')),
  reason           text not null,
  from_date        date not null default app.today(),
  to_date          date,                       -- فصل مؤقت
  guardian_came_on date,                       -- استدعاء: ولي الأمر حضر
  created_by       text,
  created_at       timestamptz not null default now(),
  lifted_by        text,
  lifted_at        timestamptz,
  check (kind <> 'فصل مؤقت' or to_date is not null),
  check (to_date is null or to_date >= from_date)
);
create index flags_open_idx on students.flags (student_id) where lifted_at is null;

create table students.leaves (
  id          uuid primary key default extensions.gen_random_uuid(),
  student_id  uuid not null references students.students (id) on delete cascade,
  from_date   date not null,
  to_date     date not null,
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now(),
  check (to_date >= from_date)
);
create index leaves_student_idx on students.leaves (student_id, from_date);

create table students.notes (
  id            uuid primary key default extensions.gen_random_uuid(),
  student_id    uuid not null references students.students (id) on delete cascade,
  body          text not null,
  for_guardian  boolean not null default false,   -- بتتبعت لولي الأمر
  created_by    text,
  created_at    timestamptz not null default now()
);
create index notes_student_idx on students.notes (student_id, created_at desc);

create table students.announcements (
  id          uuid primary key default extensions.gen_random_uuid(),
  body        text not null,
  target      text not null check (target in ('session', 'slot', 'group', 'grade', 'all')),
  session_id  uuid references students.class_sessions (id) on delete cascade,
  slot_id     uuid references public.schedule_slots (id) on delete cascade,
  group_id    uuid references students.groups (id) on delete cascade,
  grade       text references students.grades (code) on update cascade,
  created_by  text,
  created_at  timestamptz not null default now(),
  check ((target = 'all') or (target = 'session' and session_id is not null) or (target = 'slot' and slot_id is not null)
      or (target = 'group' and group_id is not null) or (target = 'grade' and grade is not null))
);

-- Guardian asks to change a child's data; management approves.
create table students.change_requests (
  id           uuid primary key default extensions.gen_random_uuid(),
  student_id   uuid not null references students.students (id) on delete cascade,
  changes      jsonb not null check (jsonb_typeof(changes) = 'object'),   -- {"field": {"old": …, "new": …}}
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by text not null default app.email()::text,
  requested_at timestamptz not null default now(),
  reviewed_by  text,
  reviewed_at  timestamptz,
  review_note  text
);

-- Reached the dismissal count: waits for a decision.
create table students.dismissal_requests (
  id            uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references students.enrollments (id) on delete cascade,
  absences      int not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now(),
  reviewed_by   text,
  reviewed_at   timestamptz,
  review_note   text
);
create unique index dismissal_one_pending on students.dismissal_requests (enrollment_id) where status = 'pending';

-- ---------------------------------------------------------------------
-- 7) Who is asking
-- ---------------------------------------------------------------------
create or replace function app.family_account()
returns students.accounts
language sql stable security definer set search_path = '' as $$
  select a from students.accounts a where a.user_id = auth.uid()
$$;

create or replace function app.is_family()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from students.accounts a where a.user_id = auth.uid())
$$;

create or replace function students.current_term()
returns uuid
language sql stable security definer set search_path = '' as $$
  select id from students.terms where is_current
$$;

-- Students the signed-in family account may see.
-- (Policies call these as «(select …)» so they run once per query, not once per row.)
create or replace function students.family_student_ids()
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}')
  from students.accounts a
  join students.students s on (a.kind = 'student' and s.id = a.student_id)
                           or (a.kind = 'guardian' and s.guardian_id = a.guardian_id)
  where a.user_id = auth.uid()
$$;

-- Students a class (weekly or one-off) is for, in the current term.
create or replace function students.class_student_ids(p_slot uuid, p_session uuid default null)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  with aud as (
    select * from students.audiences
     where (p_slot is not null and slot_id = p_slot) or (p_session is not null and session_id = p_session)
  ), term as (select students.current_term() as id)
  select e.student_id from students.enrollments e, term
   where e.term_id = term.id and e.status in ('نشط', 'تحذير')
     and exists (select 1 from aud where aud.target = 'all')
  union
  select e.student_id from students.enrollments e, term, aud
   where e.term_id = term.id and e.status in ('نشط', 'تحذير')
     and aud.target = 'grade' and e.grade = aud.grade
  union
  select gm.student_id from students.group_members gm join aud on aud.target = 'group' and aud.group_id = gm.group_id
  union
  select aud.student_id from aud where aud.target = 'student'
$$;

-- Teacher side: classes I teach (main teacher, co-teacher, or in someone's place).
create or replace function students.my_slot_ids()
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}') from public.schedule_slots s
   where app.my_volunteer_id() is not null
     and (s.volunteer_id = app.my_volunteer_id() or app.my_volunteer_id() = any (s.co_teachers))
$$;

create or replace function students.is_my_session(p_session uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from students.class_sessions cs
     where cs.id = p_session and app.my_volunteer_id() is not null
       and (app.my_volunteer_id() = any (cs.teacher_ids)
            or cs.substitute_id = app.my_volunteer_id()
            or cs.slot_id = any ((select students.my_slot_ids())::uuid[])))
$$;

-- Students I teach (any of my classes, or a session I taught in someone's place).
create or replace function students.taught_student_ids()
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select students.class_student_ids(slot, null) as x from unnest(students.my_slot_ids()) slot
    union all
    select students.class_student_ids(cs.slot_id, cs.id)
      from students.class_sessions cs
     where app.my_volunteer_id() is not null and cs.substitute_id = app.my_volunteer_id()
  ) t
$$;

create or replace function students.can_see(p_student uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_perm('students.view_all')
      or p_student = any (students.family_student_ids())
      or p_student = any (students.taught_student_ids())
$$;

grant execute on all functions in schema students to authenticated, service_role;
grant execute on function app.family_account(), app.is_family() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8) The wall: family accounts reach «students» and their own notifications only
-- ---------------------------------------------------------------------
create or replace function app.pre_request()
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}');
  profile text := coalesce(headers ->> 'content-profile', headers ->> 'accept-profile', 'public');
  path    text := coalesce(current_setting('request.path', true), '');
begin
  if auth.uid() is null or not app.is_family() then
    return;
  end if;
  if profile = 'students' then
    return;
  end if;
  if profile = 'public' and (path like '/notifications%' or path like '/push_subscriptions%') then
    return;
  end if;
  raise exception 'الحساب ده مالوش صلاحية هنا' using errcode = '42501';
end;
$$;
grant execute on function app.pre_request() to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request to ''app.pre_request''';
    notify pgrst, 'reload config';
  end if;
end $$;

-- Storage is not behind PostgREST: close the volunteers' buckets to family accounts.
do $$
declare p record;
begin
  for p in select policyname, cmd, qual, with_check from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and 'authenticated' = any (roles)
  loop
    if p.qual is not null then
      execute format('alter policy %I on storage.objects using ((%s) and not (select app.is_family()))', p.policyname, p.qual);
    end if;
    if p.with_check is not null then
      execute format('alter policy %I on storage.objects with check ((%s) and not (select app.is_family()))', p.policyname, p.with_check);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9) Permissions
-- ---------------------------------------------------------------------
--  students.view_all        تنظيم: كل الطلاب والحضور والمجموعات
--  students.view_contacts   الإدارة: التليفونات والعنوان وبيانات ولي الأمر
--  students.view_sensitive  الليدر: الرقم القومي والدخل والدعم والصحة
--  students.edit            إضافة وتعديل الطلاب والقبول والمجموعات والجدول
--  students.attendance      تسجيل الحضور لأي حصة
--  students.flags           الاستدعاء والفصل المؤقت والإجازات
--  students.flags_lift      إلغاء الفصل المؤقت
--  students.review          الموافقة على طلبات الحصص والفصل وتعديل البيانات
--  students.accounts        حسابات أولياء الأمور والطلاب (ريسيت الكود)
update public.roles set permissions = (
  select array_agg(distinct p) from unnest(permissions || array[
    'students.view_all', 'students.view_contacts', 'students.view_sensitive', 'students.edit', 'students.attendance',
    'students.flags', 'students.flags_lift', 'students.review', 'students.accounts']) p)
 where key in ('admin', 'activity_leader');
update public.roles set permissions = (
  select array_agg(distinct p) from unnest(permissions || array[
    'students.view_all', 'students.view_contacts', 'students.edit', 'students.attendance', 'students.flags', 'students.review']) p)
 where key = 'hr';
update public.roles set permissions = (
  select array_agg(distinct p) from unnest(permissions || array['students.view_all', 'students.view_contacts']) p)
 where key = 'management';
update public.roles set permissions = (
  select array_agg(distinct p) from unnest(permissions || array['students.view_all', 'students.attendance', 'students.flags', 'students.review']) p)
 where key = 'organizer';

-- ---------------------------------------------------------------------
-- 10) Row level security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings', 'org_info', 'terms', 'grades', 'attendance_marks', 'guardians', 'students',
    'student_private', 'phones', 'accounts', 'applications', 'enrollments', 'groups', 'group_members', 'whatsapp_groups',
    'class_sessions', 'audiences', 'schedule_pauses', 'slot_requests', 'attendance', 'exam_results', 'flags', 'leaves',
    'notes', 'announcements', 'change_requests', 'dismissal_requests']
  loop
    execute format('alter table students.%I enable row level security', t);
    execute format('grant select, insert, update, delete on students.%I to authenticated', t);
    execute format('grant all on students.%I to service_role', t);
  end loop;
end $$;

-- Reference data: everyone in the system reads; settings people edit.
create policy org_info_read on students.org_info for select to authenticated using (true);
create policy org_info_write on students.org_info for update to authenticated using ((select app.has_perm('settings.manage')));
create policy terms_read on students.terms for select to authenticated using (true);
create policy terms_write on students.terms for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));
create policy grades_read on students.grades for select to authenticated using (true);
create policy grades_write on students.grades for all to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));
create policy marks_read on students.attendance_marks for select to authenticated using (true);
create policy marks_write on students.attendance_marks for all to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));
-- The dismissal count stays internal.
create policy settings_read on students.settings for select to authenticated
  using (not (select app.is_family()));
create policy settings_write on students.settings for update to authenticated using ((select app.has_perm('settings.manage')));

-- Students: names for everyone allowed to see them; edits by students.edit.
create policy students_read on students.students for select to authenticated using ((select app.has_perm('students.view_all')) or id = any ((select students.family_student_ids())::uuid[]) or id = any ((select students.taught_student_ids())::uuid[]));
create policy students_write on students.students for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

create policy private_read on students.student_private for select to authenticated
  using ((select app.has_perm('students.view_sensitive'))
      or ((select app.family_account()).kind = 'guardian' and student_id = any ((select students.family_student_ids())::uuid[])));
create policy private_write on students.student_private for all to authenticated
  using ((select app.has_perm('students.edit')) and (select app.has_perm('students.view_sensitive')))
  with check ((select app.has_perm('students.edit')) and (select app.has_perm('students.view_sensitive')));

create policy phones_read on students.phones for select to authenticated
  using ((select app.has_perm('students.view_contacts'))
      or ((select app.family_account()).kind = 'guardian' and student_id = any ((select students.family_student_ids())::uuid[])));
create policy phones_write on students.phones for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

create policy guardians_read on students.guardians for select to authenticated
  using ((select app.has_perm('students.view_contacts')) or id = (select app.family_account()).guardian_id);
create policy guardians_write on students.guardians for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

-- Accounts: made and reset through the «family-account» edge function (service role) only.
create policy accounts_read on students.accounts for select to authenticated
  using ((select app.has_perm('students.accounts')) or user_id = auth.uid());
revoke insert, update, delete on students.accounts from authenticated;

create policy applications_read on students.applications for select to authenticated
  using ((select app.has_perm('students.view_all')) or student_id = any ((select students.family_student_ids())::uuid[]));
create policy applications_write on students.applications for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

create policy enrollments_read on students.enrollments for select to authenticated using ((select app.has_perm('students.view_all')) or student_id = any ((select students.family_student_ids())::uuid[]) or student_id = any ((select students.taught_student_ids())::uuid[]));
create policy enrollments_write on students.enrollments for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

create policy groups_read on students.groups for select to authenticated
  using ((select app.has_perm('students.view_all'))
      or (not (select app.is_family()) and app.my_volunteer_id() is not null)
      or exists (select 1 from students.group_members gm where gm.group_id = id and gm.student_id = any ((select students.family_student_ids())::uuid[])));
create policy groups_write on students.groups for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));
create policy group_members_read on students.group_members for select to authenticated using ((select app.has_perm('students.view_all')) or student_id = any ((select students.family_student_ids())::uuid[]) or student_id = any ((select students.taught_student_ids())::uuid[]));
create policy group_members_write on students.group_members for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

create policy whatsapp_read on students.whatsapp_groups for select to authenticated
  using ((select app.has_perm('students.view_all'))
      or (target = 'slot' and slot_id = any ((select students.my_slot_ids())::uuid[]))
      or ((select app.is_family()) and target = 'all')
      or (target = 'grade' and exists (select 1 from students.enrollments e where e.term_id = students.current_term()
            and e.grade = whatsapp_groups.grade and e.student_id = any ((select students.family_student_ids())::uuid[])))
      or (target = 'group' and exists (select 1 from students.group_members gm where gm.group_id = whatsapp_groups.group_id
            and gm.student_id = any ((select students.family_student_ids())::uuid[])))
      or (target = 'slot' and exists (select 1 from unnest(students.family_student_ids()) f
            where f in (select students.class_student_ids(whatsapp_groups.slot_id, null)))));
create policy whatsapp_write on students.whatsapp_groups for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

-- Classes: volunteers see the timetable; families see the classes their children are in.
create policy sessions_read on students.class_sessions for select to authenticated
  using (not (select app.is_family())
      or exists (select 1 from unnest(students.family_student_ids()) f
                  where f in (select students.class_student_ids(class_sessions.slot_id, class_sessions.id))));
create policy sessions_insert on students.class_sessions for insert to authenticated
  with check ((select app.has_perm('students.edit')) or (select app.has_perm('students.attendance')));
-- Teachers update their own session (substitute, exam max score, notes); the attendance triggers fill the rest.
create policy sessions_update on students.class_sessions for update to authenticated
  using ((select app.has_perm('students.edit')) or (select app.has_perm('students.attendance')) or students.is_my_session(id));
create policy sessions_delete on students.class_sessions for delete to authenticated
  using ((select app.has_perm('students.edit')));

create policy audiences_read on students.audiences for select to authenticated using (not (select app.is_family()));
create policy audiences_write on students.audiences for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

create policy pauses_read on students.schedule_pauses for select to authenticated using (true);
create policy pauses_write on students.schedule_pauses for all to authenticated
  using ((select app.has_perm('students.review'))) with check ((select app.has_perm('students.review')));

-- Requests: the class's teacher or a committee leader asks; students.review decides.
create policy slot_requests_read on students.slot_requests for select to authenticated
  using ((select app.has_perm('students.review')) or requested_by = (select app.email())::text);
create policy slot_requests_insert on students.slot_requests for insert to authenticated
  with check (status = 'pending' and requested_by = (select app.email())::text
              and (slot_id = any ((select students.my_slot_ids())::uuid[])
                   or (select app.has_perm('students.review'))
                   or cardinality(app.my_committees()) > 0));
create policy slot_requests_review on students.slot_requests for update to authenticated
  using ((select app.has_perm('students.review')));

-- Attendance and grades: the class's teacher, or تنظيم.
create policy attendance_read on students.attendance for select to authenticated using ((select app.has_perm('students.view_all')) or student_id = any ((select students.family_student_ids())::uuid[]) or student_id = any ((select students.taught_student_ids())::uuid[]));
create policy attendance_write on students.attendance for all to authenticated
  using ((select app.has_perm('students.attendance')) or students.is_my_session(session_id))
  with check ((select app.has_perm('students.attendance')) or students.is_my_session(session_id));

create policy exam_results_read on students.exam_results for select to authenticated using ((select app.has_perm('students.view_all')) or student_id = any ((select students.family_student_ids())::uuid[]) or student_id = any ((select students.taught_student_ids())::uuid[]));
create policy exam_results_write on students.exam_results for all to authenticated
  using ((select app.has_perm('students.attendance')) or students.is_my_session(session_id))
  with check ((select app.has_perm('students.attendance')) or students.is_my_session(session_id));

-- Flags: guardians see a call-in; a student doesn't see the flags. Only flags_lift ends a temporary dismissal early.
create policy flags_read on students.flags for select to authenticated
  using ((select app.has_perm('students.view_all'))
      or (student_id = any ((select students.taught_student_ids())::uuid[]))
      or ((select app.family_account()).kind = 'guardian' and student_id = any ((select students.family_student_ids())::uuid[])));
create policy flags_insert on students.flags for insert to authenticated with check ((select app.has_perm('students.flags')));
create policy flags_update on students.flags for update to authenticated
  using ((select app.has_perm('students.flags')) or (select app.has_perm('students.flags_lift')));
-- Ending a temporary dismissal before its date: students.flags_lift only.
create or replace function students.guard_flag_lift()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'فصل مؤقت' and new.lifted_at is not null and old.lifted_at is null
     and not app.is_internal() and not app.has_perm('students.flags_lift') then
    raise exception 'إلغاء الفصل المؤقت محتاج صلاحية' using errcode = '42501';
  end if;
  if new.lifted_at is not null and old.lifted_at is null then
    new.lifted_by := coalesce(app.email()::text, new.lifted_by);
  end if;
  return new;
end;
$$;
create trigger flags_guard_lift before update on students.flags for each row execute function students.guard_flag_lift();
create policy flags_delete on students.flags for delete to authenticated using ((select app.has_perm('students.flags_lift')));

create policy leaves_read on students.leaves for select to authenticated using ((select app.has_perm('students.view_all')) or student_id = any ((select students.family_student_ids())::uuid[]) or student_id = any ((select students.taught_student_ids())::uuid[]));
create policy leaves_write on students.leaves for all to authenticated
  using ((select app.has_perm('students.flags'))) with check ((select app.has_perm('students.flags')));

create policy notes_read on students.notes for select to authenticated
  using ((select app.has_perm('students.view_all')) or (student_id = any ((select students.taught_student_ids())::uuid[]))
      or (for_guardian and (select app.family_account()).kind = 'guardian' and student_id = any ((select students.family_student_ids())::uuid[])));
create policy notes_insert on students.notes for insert to authenticated
  with check ((select app.has_perm('students.view_all')) or student_id = any ((select students.taught_student_ids())::uuid[]));
create policy notes_modify on students.notes for update to authenticated using ((select app.has_perm('students.edit')));
create policy notes_delete on students.notes for delete to authenticated using ((select app.has_perm('students.edit')));

-- Announcements: a teacher to their class or session, تنظيم to anyone.
create policy announcements_read on students.announcements for select to authenticated
  using (not (select app.is_family())
      or target = 'all'
      or (target = 'grade' and exists (select 1 from students.enrollments e where e.term_id = students.current_term()
            and e.grade = announcements.grade and e.student_id = any ((select students.family_student_ids())::uuid[])))
      or (target = 'group' and exists (select 1 from students.group_members gm where gm.group_id = announcements.group_id
            and gm.student_id = any ((select students.family_student_ids())::uuid[])))
      or (target in ('slot', 'session') and exists (select 1 from unnest(students.family_student_ids()) f
            where f in (select students.class_student_ids(announcements.slot_id, announcements.session_id)))));
create policy announcements_insert on students.announcements for insert to authenticated
  with check (created_by = (select app.email())::text and (
       (select app.has_perm('students.view_all'))
    or (target = 'slot' and slot_id = any ((select students.my_slot_ids())::uuid[]))
    or (target = 'session' and students.is_my_session(session_id))));
create policy announcements_delete on students.announcements for delete to authenticated
  using ((select app.has_perm('students.edit')) or created_by = (select app.email())::text);

create policy change_requests_read on students.change_requests for select to authenticated
  using ((select app.has_perm('students.review')) or requested_by = (select app.email())::text);
create policy change_requests_insert on students.change_requests for insert to authenticated
  with check (status = 'pending' and requested_by = (select app.email())::text
              and (select app.family_account()).kind = 'guardian' and student_id = any ((select students.family_student_ids())::uuid[]));
create policy change_requests_review on students.change_requests for update to authenticated
  using ((select app.has_perm('students.review')));

create policy dismissal_read on students.dismissal_requests for select to authenticated
  using ((select app.has_perm('students.review')) or (select app.has_perm('students.view_all')));
create policy dismissal_review on students.dismissal_requests for update to authenticated
  using ((select app.has_perm('students.review')));
revoke insert, delete on students.dismissal_requests from authenticated;

-- A family account only reads (a guardian may also file change requests).
create or replace function students.family_read_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_family() and not (tg_table_name = 'change_requests' and tg_op = 'INSERT') then
    raise exception 'الحساب ده للمشاهدة بس' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['students', 'student_private', 'phones', 'guardians', 'applications', 'enrollments', 'groups',
    'group_members', 'whatsapp_groups', 'class_sessions', 'audiences', 'schedule_pauses', 'slot_requests', 'attendance',
    'exam_results', 'flags', 'leaves', 'notes', 'announcements', 'change_requests', 'dismissal_requests']
  loop
    execute format('create trigger %I before insert or update or delete on students.%I for each row execute function students.family_read_only()',
                   t || '_family_read_only', t);
  end loop;
end $$;

-- Who did it, and the log (same app.touch / app.audit as the volunteers' side).
do $$
declare t text;
begin
  foreach t in array array['students', 'student_private', 'guardians', 'org_info'] loop
    execute format('create trigger %I before update on students.%I for each row execute function app.touch()', t || '_stamp', t);
  end loop;
  foreach t in array array['students', 'student_private', 'phones', 'guardians', 'applications', 'enrollments', 'groups',
    'class_sessions', 'audiences', 'schedule_pauses', 'slot_requests', 'attendance', 'exam_results', 'flags', 'leaves',
    'change_requests', 'dismissal_requests', 'accounts'] loop
    execute format('create trigger %I after insert or update or delete on students.%I for each row execute function app.audit(%L)',
                   'audit_' || t, t, case when t in ('attendance', 'exam_results') then 'session_id'
                                          when t = 'student_private' then 'student_id'
                                          when t = 'accounts' then 'user_id' else 'id' end);
  end loop;
end $$;

-- An accepted application puts the student in the term.
create or replace function students.application_accepted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'مقبول' and (tg_op = 'INSERT' or old.status is distinct from 'مقبول') then
    insert into students.enrollments (student_id, term_id, grade, status_by)
    values (new.student_id, new.term_id, new.grade, app.email()::text)
    on conflict (student_id, term_id) do update set grade = excluded.grade;
    new.decided_by := coalesce(app.email()::text, new.decided_by);
    new.decided_at := now();
  end if;
  return new;
end;
$$;
create trigger applications_accepted before insert or update of status on students.applications
  for each row execute function students.application_accepted();

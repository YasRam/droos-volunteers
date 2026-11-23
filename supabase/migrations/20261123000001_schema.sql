-- =====================================================================
-- نشاط دروس التقوية — schema
-- Tables, enums, constraints and indexes. No security or automation here.
-- =====================================================================

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
comment on schema app is 'Internal helpers: role checks, triggers, jobs. Not exposed through the API.';

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'activity_leader', 'hr', 'organizer');

create type public.volunteer_status as enum (
  'تحت المتابعة', 'مشروع مسئول', 'مسئول', 'مدرب', 'خارج المتابعة'
);

create type public.acceptance_grade as enum (
  'اختبار', 'مقبول', 'رفض الانترفيو', 'مرفوض', 'معتذر', 'معتذر نهائى', 'مفصول'
);

create type public.request_status as enum ('pending', 'accepted', 'rejected');

create type public.entry_method as enum ('individual', 'group');

-- Saturday first: enum order is the sort order.
create type public.weekday_ar as enum (
  'السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'
);

-- ---------------------------------------------------------------------
-- Access: staff and committee leaders
-- ---------------------------------------------------------------------
create table public.staff_roles (
  email       extensions.citext primary key,
  full_name   text not null,
  role        public.app_role not null,
  created_at  timestamptz not null default now()
);
comment on table public.staff_roles is 'أدمن، ليدر نشاط، HR، تنظيم. الإيميل = إيميل جوجل.';

create table public.committee_leaders (
  email       extensions.citext not null,
  committee   text not null,
  full_name   text not null,
  created_at  timestamptz not null default now(),
  primary key (email, committee)
);
comment on table public.committee_leaders is 'ليدر اللجنة. الشخص ممكن يقود أكتر من لجنة.';

-- ---------------------------------------------------------------------
-- Lists and settings
-- ---------------------------------------------------------------------
create table public.lookups (
  id          bigint generated always as identity primary key,
  list        text not null,          -- اللجنة، الحدث، نوع الحدث، المكان، السنة الدراسية، القائم على المقابلة ...
  value       text not null,
  parent      text,                   -- for نوع الحدث: the الحدث it belongs to
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  constraint lookups_unique unique nulls not distinct (list, value, parent)
);

create table public.app_settings (
  key    text primary key,
  value  text
);

-- ---------------------------------------------------------------------
-- Volunteers (split by who may read what)
-- ---------------------------------------------------------------------
create sequence public.volunteer_code_seq;

create table public.volunteers (
  id                     uuid primary key default extensions.gen_random_uuid(),
  code                   text not null unique
                           default 'V' || lpad(nextval('public.volunteer_code_seq')::text, 4, '0'),
  -- personal (the volunteer edits these)
  full_name_ar           text not null,
  full_name_en           text,
  phone                  text,
  whatsapp               text,
  email                  extensions.citext unique,
  qualification          text,
  job                    text,
  area                   text,
  availability_notes     text,
  referral_source        text,
  -- derived from the national id (trigger)
  birth_date             date,
  gender                 text check (gender in ('ذكر', 'أنثى')),
  registered_at          timestamptz not null default now(),
  -- interview data visible to the volunteer (HR edits)
  status                 public.volunteer_status not null default 'تحت المتابعة',
  main_committee         text,
  sub_committee          text,
  -- committee data (committee leader + HR edit)
  contacted              boolean not null default false,
  passed_committee_test  boolean not null default false,
  joined_group           boolean not null default false,
  is_active              boolean not null default false,
  bought_tshirt          boolean not null default false,
  attended_minicamp      boolean not null default false,
  minicamp_date          date,
  -- meta
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text
);

-- Enforced for new and edited rows; old sheet rows are not re-checked.
alter table public.volunteers
  add constraint volunteers_phone_format check (phone ~ '^01[0-9]{9}$') not valid,
  add constraint volunteers_whatsapp_format check (whatsapp ~ '^01[0-9]{9}$') not valid;

create index volunteers_status_idx on public.volunteers (status);
create index volunteers_main_committee_idx on public.volunteers (main_committee);
create index volunteers_sub_committee_idx on public.volunteers (sub_committee);

create table public.volunteer_private (
  volunteer_id           uuid primary key references public.volunteers (id) on delete cascade,
  national_id            text,
  requested_national_id  text,
  requested_at           timestamptz
);
alter table public.volunteer_private
  add constraint national_id_format check (national_id ~ '^[23][0-9]{13}$') not valid,
  add constraint requested_national_id_format check (requested_national_id ~ '^[23][0-9]{13}$');
comment on table public.volunteer_private is 'الرقم القومي: يشوفه الـ HR والمتطوع نفسه بس.';

create table public.volunteer_hr (
  volunteer_id       uuid primary key references public.volunteers (id) on delete cascade,
  acceptance         public.acceptance_grade default 'اختبار',   -- null = لسه مفيش تقييم (بيانات قديمة)
  interview_date     date,
  interviewer        text,
  hr_notes           text,
  status_changed_at  timestamptz
);
comment on table public.volunteer_hr is 'بيانات المقابلة الخاصة بالـ HR. مش ظاهرة للمتطوع.';

-- ---------------------------------------------------------------------
-- Participations (المتابعة اليومية) and group activities
-- ---------------------------------------------------------------------
create table public.group_activities (
  id             uuid primary key default extensions.gen_random_uuid(),
  activity_date  date not null,
  event          text not null,
  subject        text,
  place          text,
  grade          text,
  beneficiaries  int check (beneficiaries > 0),
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now()
);

create table public.participations (
  id                 uuid primary key default extensions.gen_random_uuid(),
  legacy_code        text unique,                 -- F00001 from the sheet
  volunteer_id       uuid not null references public.volunteers (id) on delete cascade,
  activity_date      date not null,
  event              text not null,
  subject            text,                        -- نوع الحدث / المادة
  place              text,
  grade              text,                        -- السنة الدراسية
  beneficiaries      int check (beneficiaries > 0),
  notes              text,
  status             public.request_status not null default 'pending',
  method             public.entry_method not null default 'individual',
  group_activity_id  uuid references public.group_activities (id) on delete set null,
  created_by         text,
  created_at         timestamptz not null default now(),
  reviewed_by        text,
  reviewed_at        timestamptz,
  updated_at         timestamptz not null default now(),
  updated_by         text
);

-- One volunteer, one day, one event, one subject, one grade — unless rejected.
create unique index participations_no_duplicate
  on public.participations (volunteer_id, activity_date, event, coalesce(subject, ''), coalesce(grade, ''))
  where status <> 'rejected';

create index participations_volunteer_date_idx on public.participations (volunteer_id, activity_date desc);
create index participations_date_idx on public.participations (activity_date desc);
create index participations_pending_idx on public.participations (created_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------
create table public.schedule_slots (
  id            uuid primary key default extensions.gen_random_uuid(),
  legacy_code   text unique,                      -- S001 from the sheet
  day           public.weekday_ar not null,
  grade         text not null,
  subject       text not null,
  teacher_name  text,
  volunteer_id  uuid references public.volunteers (id) on delete set null,
  starts_at     time not null,
  ends_at       time not null check (ends_at > starts_at),
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create index schedule_slots_day_idx on public.schedule_slots (day, starts_at);

-- ---------------------------------------------------------------------
-- Notifications and audit log
-- ---------------------------------------------------------------------
create table public.notifications (
  id               bigint generated always as identity primary key,
  recipient_email  extensions.citext not null,
  title            text not null,
  body             text,
  link             text,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_email, created_at desc);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_email  text,
  table_name   text not null,
  action       text not null,
  record_id    text,
  old_row      jsonb,
  new_row      jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_table_idx on public.audit_log (table_name, at desc);

-- =====================================================================
-- 19) New volunteers: call → interview date → interview result, with full history
--
--   للتواصل        → HR calls: reached / no answer / wrong number / date set / refused / withdrew
--   ميعاد انترفيو  → interview result: اختبار / مقبول / مرفوض / محضرش (no-show → back to للتواصل)
--   اتعمل انترفيو  → done (result kept in volunteer_hr; the history keeps every attempt)
--   مقفول          → refused, rejected, dismissed or withdrew for good; hidden until the
--                    acceptance changes to something else
-- =====================================================================

alter table public.volunteers add column if not exists recruit_status text
  check (recruit_status is null or recruit_status in ('للتواصل', 'ميعاد انترفيو', 'اتعمل انترفيو', 'مقفول'));
alter table public.volunteers add column if not exists interview_at timestamptz;   -- the booked interview time

-- A new volunteer starts with no interview result (it is set by the interview)
alter table public.volunteer_hr alter column acceptance drop default;

create table if not exists public.recruit_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  volunteer_id    uuid not null references public.volunteers (id) on delete cascade,
  kind            text not null check (kind in ('call', 'interview', 'reopen')),
  outcome         text not null,
  scheduled_at    timestamptz,
  interviewer_id  uuid references public.volunteers (id) on delete set null,
  prev_acceptance text,           -- the result they had before this step (shown when re-interviewed)
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index if not exists recruit_log_volunteer on public.recruit_log (volunteer_id, created_at desc);
alter table public.recruit_log enable row level security;
create policy recruit_log_read on public.recruit_log for select to authenticated using ((select app.has_perm('hr.view')));

-- Who is in the pipeline now: everyone without an interview result yet
update public.volunteers v set recruit_status = 'للتواصل'
  from public.volunteer_hr h
 where h.volunteer_id = v.id and h.acceptance is null and v.recruit_status is null and v.status::text <> 'خارج المتابعة';
update public.volunteers v set recruit_status = 'مقفول'
  from public.volunteer_hr h
 where h.volunteer_id = v.id and v.recruit_status is null and h.acceptance::text in ('مرفوض', 'مفصول', 'معتذر نهائى', 'رفض الانترفيو');

-- New volunteers enter the call list
create or replace function app.recruit_new()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.recruit_status is null then
    new.recruit_status := 'للتواصل';
  end if;
  return new;
end;
$$;
drop trigger if exists volunteers_recruit_new on public.volunteers;
create trigger volunteers_recruit_new before insert on public.volunteers for each row execute function app.recruit_new();

create or replace function app.is_closed_acceptance(a text)
returns boolean language sql immutable as $$ select a in ('مرفوض', 'مفصول', 'معتذر نهائى', 'رفض الانترفيو') $$;

-- Acceptance changed by hand: closed ↔ open keeps the pipeline in step
create or replace function app.recruit_follow_acceptance()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.acceptance is distinct from old.acceptance and current_setting('app.recruit', true) is distinct from 'on' then
    if app.is_closed_acceptance(new.acceptance::text) then
      update public.volunteers set recruit_status = 'مقفول' where id = new.volunteer_id;
    elsif app.is_closed_acceptance(old.acceptance::text) then
      -- «مبيظهرش إلا لما حالته تتغير»: back in the pipeline
      update public.volunteers set recruit_status = case when new.acceptance is null then 'للتواصل' else 'اتعمل انترفيو' end
       where id = new.volunteer_id;
      insert into public.recruit_log (volunteer_id, kind, outcome, prev_acceptance, notes, created_by)
      values (new.volunteer_id, 'reopen', coalesce(new.acceptance::text, 'رجع للتواصل'), old.acceptance::text, 'الحالة اتغيرت من ملف المتطوع', app.email());
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_recruit_follow on public.volunteer_hr;
create trigger hr_recruit_follow after update on public.volunteer_hr for each row execute function app.recruit_follow_acceptance();

-- A call
create or replace function public.recruit_call(p_volunteer uuid, p_outcome text, p_scheduled_at timestamptz default null, p_notes text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  prev text := (select acceptance::text from public.volunteer_hr where volunteer_id = p_volunteer);
begin
  if not app.has_perm('hr.edit') then
    raise exception 'محتاج صلاحية تعديل بيانات المقابلة' using errcode = '42501';
  end if;
  if p_outcome not in ('تم التواصل', 'مردش', 'رقم غلط', 'حدد ميعاد', 'رفض الانترفيو', 'معتذر نهائى') then
    raise exception 'نتيجة المكالمة مش معروفة' using errcode = '22023';
  end if;
  if p_outcome = 'حدد ميعاد' and p_scheduled_at is null then
    raise exception 'اختار ميعاد الانترفيو' using errcode = '22023';
  end if;
  insert into public.recruit_log (volunteer_id, kind, outcome, scheduled_at, prev_acceptance, notes, created_by)
  values (p_volunteer, 'call', p_outcome, p_scheduled_at, prev, nullif(btrim(p_notes), ''), app.email());

  perform app.begin_internal();
  perform set_config('app.recruit', 'on', true);
  update public.volunteers set
    contacted = contacted or p_outcome in ('تم التواصل', 'حدد ميعاد', 'رفض الانترفيو', 'معتذر نهائى'),
    recruit_status = case p_outcome when 'حدد ميعاد' then 'ميعاد انترفيو'
                                    when 'رفض الانترفيو' then 'مقفول'
                                    when 'معتذر نهائى' then 'مقفول'
                                    else 'للتواصل' end,
    interview_at = case when p_outcome = 'حدد ميعاد' then p_scheduled_at else interview_at end
  where id = p_volunteer;
  if p_outcome in ('رفض الانترفيو', 'معتذر نهائى') then
    update public.volunteer_hr set acceptance = p_outcome::public.acceptance_grade where volunteer_id = p_volunteer;
  end if;
  perform set_config('app.recruit', 'off', true);
  perform app.end_internal();
end;
$$;
grant execute on function public.recruit_call(uuid, text, timestamptz, text) to authenticated;

-- An interview result
create or replace function public.recruit_interview(p_volunteer uuid, p_result text, p_date date, p_interviewer uuid default null, p_notes text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  prev text := (select acceptance::text from public.volunteer_hr where volunteer_id = p_volunteer);
begin
  if not app.has_perm('hr.edit') then
    raise exception 'محتاج صلاحية تعديل بيانات المقابلة' using errcode = '42501';
  end if;
  if p_result not in ('اختبار', 'مقبول', 'مرفوض', 'محضرش') then
    raise exception 'نتيجة الانترفيو مش معروفة' using errcode = '22023';
  end if;
  insert into public.recruit_log (volunteer_id, kind, outcome, scheduled_at, interviewer_id, prev_acceptance, notes, created_by)
  values (p_volunteer, 'interview', p_result, p_date::timestamptz, p_interviewer, prev, nullif(btrim(p_notes), ''), app.email());

  perform app.begin_internal();
  perform set_config('app.recruit', 'on', true);
  if p_result = 'محضرش' then
    -- back to the call list, with the notes in the history
    update public.volunteers set recruit_status = 'للتواصل', interview_at = null where id = p_volunteer;
  else
    insert into public.volunteer_hr (volunteer_id) values (p_volunteer) on conflict do nothing;
    update public.volunteer_hr set acceptance = p_result::public.acceptance_grade, interview_date = p_date, interviewer_id = p_interviewer
     where volunteer_id = p_volunteer;
    update public.volunteers set recruit_status = case when p_result = 'مرفوض' then 'مقفول' else 'اتعمل انترفيو' end, interview_at = null
     where id = p_volunteer;
  end if;
  perform set_config('app.recruit', 'off', true);
  perform app.end_internal();
end;
$$;
grant execute on function public.recruit_interview(uuid, text, date, uuid, text) to authenticated;

-- Put anyone back in the call list (e.g. an old volunteer re-applying)
create or replace function public.recruit_reopen(p_volunteer uuid, p_notes text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app.has_perm('hr.edit') then
    raise exception 'محتاج صلاحية تعديل بيانات المقابلة' using errcode = '42501';
  end if;
  insert into public.recruit_log (volunteer_id, kind, outcome, prev_acceptance, notes, created_by)
  values (p_volunteer, 'reopen', 'رجع للتواصل', (select acceptance::text from public.volunteer_hr where volunteer_id = p_volunteer), nullif(btrim(p_notes), ''), app.email());
  perform app.begin_internal();
  update public.volunteers set recruit_status = 'للتواصل', interview_at = null where id = p_volunteer;
  perform app.end_internal();
end;
$$;
grant execute on function public.recruit_reopen(uuid, text) to authenticated;

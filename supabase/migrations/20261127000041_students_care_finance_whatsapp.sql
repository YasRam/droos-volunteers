-- 1) Phones are the guardian's (the one the student lives with): mobiles or landlines.
--    A landline (0 + 8 digits, e.g. 03xxxxxxx) has no WhatsApp. One mobile is the main WhatsApp.
-- 2) Care notes (لازم حد يستلمه، ميروحش لوحده، حالة خاصة...): for the organizers only, never the family.
-- 3) The family's income and support: only with the new «students.finance» permission.
-- 4) Groups can belong to a grade (the grade split in groups) or be general; WhatsApp links for a
--    grade or a group show to the student, the guardian and the teacher.
-- 5) ID cards: alert at 90, 30, 7 days and on the day; the guardian is asked for the new card.
-- 6) The volunteer's national ID joins the profile request (HR / national_id.edit still edit directly).

-- 1) phones
alter table students.phones drop constraint if exists phones_number_check;
alter table students.phones
  add constraint phones_number_check check (number ~ '^01[0125][0-9]{8}$' or number ~ '^0[2-9][0-9]{7}$'),
  add column if not exists is_main_whatsapp boolean not null default false;
update students.phones set is_whatsapp = false where number !~ '^01';
alter table students.phones drop constraint if exists phones_whatsapp_mobile;
alter table students.phones add constraint phones_whatsapp_mobile check (number ~ '^01' or not (is_whatsapp or is_main_whatsapp));
create unique index if not exists phones_one_main_whatsapp on students.phones (student_id) where is_main_whatsapp;
update students.phones p set is_main_whatsapp = true
 where p.is_whatsapp and p.id = (select x.id from students.phones x where x.student_id = p.student_id and x.is_whatsapp order by x.sort_order, x.number limit 1);

-- 2) care notes
create table if not exists students.care_notes (
  student_id  uuid primary key references students.students (id) on delete cascade,
  body        text not null check (btrim(body) <> ''),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table students.care_notes enable row level security;
grant select, insert, update, delete on students.care_notes to authenticated;
grant all on students.care_notes to service_role;
create policy care_notes_read on students.care_notes for select to authenticated
  using (not (select app.is_family())
         and ((select app.has_perm('students.view_all')) or (select app.has_perm('students.attendance'))
              or (select app.has_perm('students.edit'))
              or student_id = any ((select students.taught_student_ids())::uuid[])));
create policy care_notes_write on students.care_notes for all to authenticated
  using ((select app.has_perm('students.edit'))) with check ((select app.has_perm('students.edit')));

-- Teachers see the care notes of the students in their own classes, through this function only
create or replace function students.care_notes_for(p_students uuid[])
returns table (student_id uuid, body text)
language sql stable security definer set search_path = '' as $$
  select c.student_id, c.body
    from students.care_notes c
   where c.student_id = any (p_students)
     and not app.is_family()
     and (app.has_perm('students.view_all') or app.has_perm('students.attendance') or app.has_perm('students.edit')
          or exists (select 1 from students.class_sessions cs
                      where cs.on_date between app.today() - 7 and app.today() + 7
                        and app.my_volunteer_id() = any (coalesce(cs.teacher_ids, '{}') || coalesce(array[cs.substitute_id], '{}'))
                        and c.student_id in (select students.class_student_ids(cs.slot_id, cs.id))))
$$;
revoke all on function students.care_notes_for(uuid[]) from public, anon;
grant execute on function students.care_notes_for(uuid[]) to authenticated;

-- 3) finance
create table if not exists students.family_finance (
  student_id      uuid primary key references students.students (id) on delete cascade,
  family_income   text,
  family_support  text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
alter table students.family_finance enable row level security;
grant select, insert, update, delete on students.family_finance to authenticated;
grant all on students.family_finance to service_role;
create policy family_finance_all on students.family_finance for all to authenticated
  using ((select app.has_perm('students.finance'))) with check ((select app.has_perm('students.finance')));
insert into students.family_finance (student_id, family_income, family_support)
select student_id, family_income, family_support from students.student_private
 where coalesce(family_income, family_support) is not null
on conflict (student_id) do nothing;
update students.student_private set family_income = null, family_support = null
 where coalesce(family_income, family_support) is not null;
update public.roles set permissions = array_append(permissions, 'students.finance')
 where key in ('admin', 'activity_leader') and not ('students.finance' = any (permissions));

-- 4) groups of a grade + WhatsApp
alter table students.groups add column if not exists grade text references students.grades (code) on update cascade;

create or replace function students.whatsapp_for(p_students uuid[])
returns table (student_id uuid, name text, link text, target text)
language sql stable security definer set search_path = '' as $$
  with kids as (
    select s.id, e.grade
      from unnest(p_students) as x(id)
      join students.students s on s.id = x.id
      left join students.enrollments e on e.student_id = s.id and e.term_id = students.current_term()
     where s.id = any (students.family_student_ids())
        or app.has_perm('students.view_all') or app.has_perm('students.attendance') or app.has_perm('students.edit')
        or exists (select 1 from students.class_sessions cs
                    where cs.on_date between app.today() - 7 and app.today() + 7
                      and app.my_volunteer_id() = any (coalesce(cs.teacher_ids, '{}') || coalesce(array[cs.substitute_id], '{}'))
                      and s.id in (select students.class_student_ids(cs.slot_id, cs.id)))
  )
  select distinct k.id, w.name, w.link, w.target
    from kids k
    join students.whatsapp_groups w
      on w.target = 'all'
      or (w.target = 'grade' and w.grade = k.grade)
      or (w.target = 'group' and exists (select 1 from students.group_members gm where gm.group_id = w.group_id and gm.student_id = k.id))
$$;
revoke all on function students.whatsapp_for(uuid[]) from public, anon;
grant execute on function students.whatsapp_for(uuid[]) to authenticated;

-- For the teacher of a class: the groups of the grades / groups the class is for
create or replace function students.whatsapp_for_slot(p_slot uuid)
returns table (name text, link text, target text)
language sql stable security definer set search_path = '' as $$
  select distinct w.name, w.link, w.target
    from students.whatsapp_groups w
    join students.audiences a on a.slot_id = p_slot
   where ((w.target = 'grade' and a.target = 'grade' and w.grade = a.grade)
       or (w.target = 'group' and a.target = 'group' and w.group_id = a.group_id)
       or (w.target = 'slot' and w.slot_id = p_slot))
     and not app.is_family()
     and (app.has_perm('students.view_all') or app.has_perm('schedule.edit') or app.has_perm('students.attendance')
          or exists (select 1 from public.schedule_slots s where s.id = p_slot
                      and (s.volunteer_id = app.my_volunteer_id() or app.my_volunteer_id() = any (s.co_teachers))))
$$;
revoke all on function students.whatsapp_for_slot(uuid) from public, anon;
grant execute on function students.whatsapp_for_slot(uuid) to authenticated;

-- 5) ID cards
create or replace function students.alert_expiring_ids()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  perform set_config('app.internal', 'on', true);
  for r in select * from students.expiring_ids(90) where days_left in (90, 30, 7, 0) loop
    perform app.notify(app.emails_with('students.edit'),
      case when r.days_left = 0 then 'بطاقة انتهت النهارده' else 'بطاقة هتنتهي بعد ' || r.days_left || ' يوم' end,
      'بطاقة ' || r.who || coalesce(' (' || r.person || ')', '') || ' للطالب ' || r.student_name || '. اطلب صورة البطاقة الجديدة',
      '/students/ids');
    perform app.notify(
      (select coalesce(array_agg(a.login_email), '{}') from students.accounts a
        join students.students s on s.guardian_id = a.guardian_id where s.id = r.student_id and a.kind = 'guardian'),
      'محتاجين صورة البطاقة الجديدة',
      'بطاقة ' || r.who || case when r.days_left = 0 then ' انتهت' else ' هتنتهي بعد ' || r.days_left || ' يوم' end
        || '. لما تجددها ابعت صورتها للتنظيم في النشاط',
      '/family');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function students.alert_expiring_ids() from public, anon, authenticated;

-- 6) the volunteer's national ID by request
create or replace function app.profile_fields()
returns text[] language sql immutable set search_path = '' as $$
  select array['full_name_ar', 'full_name_en', 'phone', 'whatsapp', 'email', 'qualification', 'area', 'study_year', 'national_id']
$$;

create or replace function public.submit_profile_request(p_changes jsonb, p_photo text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  vid uuid := app.my_volunteer_id();
  cur jsonb;
  clean jsonb := '{}';
  k text;
  val text;
  rid uuid;
  who text;
begin
  if vid is null then
    raise exception 'الحساب ده مش مربوط بمتطوع' using errcode = '42501';
  end if;
  select to_jsonb(v) || jsonb_build_object('national_id', (select p.national_id from public.volunteer_private p where p.volunteer_id = vid))
    into cur from public.volunteers v where v.id = vid;
  for k in select jsonb_object_keys(coalesce(p_changes, '{}')) loop
    if not (k = any (app.profile_fields())) then
      continue;
    end if;
    val := nullif(btrim(coalesce(p_changes->>k, '')), '');
    if k = 'email' then val := lower(val); end if;
    if k in ('phone', 'whatsapp') and val is not null and val !~ '^01[0125][0-9]{8}$' then
      raise exception 'رقم التليفون لازم يكون 11 رقم ويبدأ بـ 01' using errcode = '22023';
    end if;
    if k = 'email' and val is not null and val !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'الإيميل مش صحيح' using errcode = '22023';
    end if;
    if k = 'national_id' and val is not null and val !~ '^[23][0-9]{13}$' then
      raise exception 'الرقم القومي لازم 14 رقم ويبدأ بـ 2 أو 3' using errcode = '22023';
    end if;
    if k in ('full_name_ar', 'phone') and val is null then
      raise exception 'الاسم والتليفون مينفعش يبقوا فاضيين' using errcode = '22023';
    end if;
    if k = 'national_id' and val is null then
      continue;   -- the ID is never cleared by request
    end if;
    if val is distinct from (cur->>k) then
      clean := clean || jsonb_build_object(k, val);
    end if;
  end loop;
  if p_photo is not null and split_part(p_photo, '/', 1) <> vid::text then
    raise exception 'مكان الصورة غلط' using errcode = '22023';
  end if;
  if clean = '{}' and p_photo is null then
    raise exception 'مفيش حاجة اتغيرت' using errcode = '22023';
  end if;

  delete from public.profile_requests where volunteer_id = vid and status = 'pending';
  insert into public.profile_requests (volunteer_id, changes, old_values, photo_path)
  values (vid, clean, (select coalesce(jsonb_object_agg(x, cur->x), '{}') from jsonb_object_keys(clean) x), p_photo)
  returning id into rid;

  who := cur->>'full_name_ar';
  perform app.notify(
    (select coalesce(array_agg(distinct e), '{}') from unnest(app.emails_with('hr.edit') || app.emails_with('volunteers.edit')) e),
    'طلب تعديل بيانات',
    who || ' عايز يعدّل ' || case when clean <> '{}' and p_photo is not null then 'بياناته وصورته'
                                   when p_photo is not null then 'صورته' else 'بياناته' end,
    '/requests?tab=profiles');
  return rid;
end;
$$;

create or replace function public.review_profile_request(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.profile_requests;
  c jsonb;
  email_to text;
begin
  if not (app.has_perm('hr.edit') or app.has_perm('volunteers.edit')) then
    raise exception 'محتاج صلاحية تعديل بيانات المقابلة أو تعديل المتطوعين' using errcode = '42501';
  end if;
  select * into r from public.profile_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then
    raise exception 'الطلب ده اتراجع خلاص أو مش موجود';
  end if;
  c := r.changes;

  if p_approve then
    perform set_config('app.profile_apply', 'on', true);
    update public.volunteers v set
      full_name_ar  = case when c ? 'full_name_ar'  then c->>'full_name_ar'  else v.full_name_ar end,
      full_name_en  = case when c ? 'full_name_en'  then c->>'full_name_en'  else v.full_name_en end,
      phone         = case when c ? 'phone'         then c->>'phone'         else v.phone end,
      whatsapp      = case when c ? 'whatsapp'      then c->>'whatsapp'      else v.whatsapp end,
      email         = case when c ? 'email'         then (c->>'email')::extensions.citext else v.email end,
      qualification = case when c ? 'qualification' then c->>'qualification' else v.qualification end,
      area          = case when c ? 'area'          then c->>'area'          else v.area end,
      study_year    = case when c ? 'study_year'    then c->>'study_year'    else v.study_year end
    where v.id = r.volunteer_id;
    perform set_config('app.profile_apply', 'off', true);
    if c ? 'national_id' then
      perform app.begin_internal();
      insert into public.volunteer_private (volunteer_id, national_id) values (r.volunteer_id, c->>'national_id')
      on conflict (volunteer_id) do update set national_id = excluded.national_id;
      perform app.end_internal();
    end if;
    if r.photo_path is not null then
      insert into public.volunteer_private (volunteer_id, photo_path) values (r.volunteer_id, r.photo_path)
      on conflict (volunteer_id) do update set photo_path = excluded.photo_path;
    end if;
  end if;

  update public.profile_requests
     set status = case when p_approve then 'accepted' else 'rejected' end,
         note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = app.email()::text, reviewed_at = now()
   where id = p_id;

  select v.email into email_to from public.volunteers v where v.id = r.volunteer_id;
  if email_to is not null then
    perform app.notify(array[email_to]::extensions.citext[],
      case when p_approve then 'طلب تعديل بياناتك اتقبل' else 'طلب تعديل بياناتك اترفض' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), case when p_approve then 'بياناتك اتحدّثت' else 'كلّم الـ HR لو عندك سؤال' end),
      '/me');
  end if;
end;
$$;

-- The old «ملاحظات للتنظيم» lived on the student row, which the family can read: move them.
insert into students.care_notes (student_id, body)
select id, btrim(notes) from students.students where btrim(coalesce(notes, '')) <> ''
on conflict (student_id) do nothing;
update students.students set notes = null where notes is not null;

-- Anything still writing students.notes (the sheet import) goes to the care notes instead.
create or replace function students.notes_to_care()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if btrim(coalesce(new.notes, '')) <> '' then
    insert into students.care_notes (student_id, body) values (new.id, btrim(new.notes))
    on conflict (student_id) do update
      set body = case when position(excluded.body in students.care_notes.body) > 0 then students.care_notes.body
                      else students.care_notes.body || E'\n' || excluded.body end,
          updated_at = now();
  end if;
  return null;
end;
$$;
create or replace function students.notes_clear()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.notes := null;
  return new;
end;
$$;
drop trigger if exists students_notes_to_care on students.students;
create trigger students_notes_to_care after insert or update of notes on students.students
  for each row when (new.notes is not null) execute function students.notes_to_care();
-- AFTER triggers see the value; then a BEFORE trigger on the next write would be too late, so
-- clear it right away with a deferred-free second pass:
create or replace function students.notes_clear_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update students.students set notes = null where id = new.id and notes is not null;
  return null;
end;
$$;
drop trigger if exists students_notes_clear on students.students;
create trigger students_notes_clear after insert or update of notes on students.students
  for each row when (new.notes is not null) execute function students.notes_clear_after();
drop function if exists students.notes_clear();

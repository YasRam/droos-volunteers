-- =====================================================================
-- 1) وظيفة واحدة لكل متطوع، وصلاحيات متعددة لكل إيميل.
-- 2) مفيش طلبات تغيير رقم قومي، ومحدش يغيّر رقمه القومي بنفسه.
-- 3) الكامب زي الميني كامب في كل حاجة.
-- 4) أنواع حدث متعددة في نفس المشاركة (مادة/سنة) بتتضاف للقايمة واحدة واحدة.
-- 5) تعديل ومسح القوائم، مع تحديث البيانات اللي فيها القيمة القديمة.
-- 6) أيام المشاركة لكل متطوع (للإحصائيات).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Text normalisation for comparing Arabic names typed different ways
-- (ى/ي، أ/إ/آ/ا، ة/ه).
-- ---------------------------------------------------------------------
create or replace function app.norm(t text)
returns text
language sql immutable
set search_path = ''
as $$
  select translate(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g'), 'ىأإآة', 'يااا' || 'ه')
$$;

create or replace function app.is_camp(event text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select app.norm(event) in ('ميني كامب', 'كامب')
$$;

-- ---------------------------------------------------------------------
-- 1) Position (الوظيفة): one per volunteer, HR decides it.
-- ---------------------------------------------------------------------
create type public.volunteer_position as enum (
  'متطوع', 'HR', 'تنظيم', 'ليدر لجنة', 'ليدر النشاط', 'نائب ليدر النشاط'
);

alter table public.volunteers
  add column position public.volunteer_position not null default 'متطوع';
create index volunteers_position_idx on public.volunteers (position) where position <> 'متطوع';

-- Start from what the permissions say today, so the tree is not empty.
select app.begin_internal();
update public.volunteers v
   set position = case
         when exists (select 1 from public.staff_roles s where s.email = v.email and s.role = 'activity_leader') then 'ليدر النشاط'
         when exists (select 1 from public.staff_roles s where s.email = v.email and s.role = 'hr') then 'HR'
         when exists (select 1 from public.committee_leaders c where c.email = v.email) then 'ليدر لجنة'
         when exists (select 1 from public.staff_roles s where s.email = v.email and s.role = 'organizer') then 'تنظيم'
         else 'متطوع'
       end::public.volunteer_position
 where v.email is not null
   and (exists (select 1 from public.staff_roles s where s.email = v.email)
        or exists (select 1 from public.committee_leaders c where c.email = v.email));
select app.end_internal();

-- Permissions: an email may hold several. Emails that are not volunteers
-- are allowed too (they only show up in the log).
alter table public.staff_roles drop constraint staff_roles_pkey;
alter table public.staff_roles add primary key (email, role);

create or replace function app.has_role(r public.app_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_roles where email = app.email() and role = r)
$$;

-- The highest one, for labels (enum order: admin, activity_leader, hr, organizer).
create or replace function app.my_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.staff_roles where email = app.email() order by role limit 1
$$;

create or replace function app.my_roles()
returns public.app_role[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(role order by role), '{}') from public.staff_roles where email = app.email()
$$;

create or replace function app.is_full()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles
     where email = app.email() and role in ('admin', 'activity_leader', 'hr'))
$$;

-- «تنظيم» limits (7 days) apply only to someone who has no fuller permission.
create or replace function app.is_organizer()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.has_role('organizer') and not app.is_full()
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_roles where email = app.email())
$$;

create or replace function app.my_name()
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select v.full_name_ar from public.volunteers v where v.id = app.my_volunteer_id()),
    (select s.full_name from public.staff_roles s where s.email = app.email() order by s.role limit 1),
    (select c.full_name from public.committee_leaders c where c.email = app.email() limit 1)
  )
$$;

create or replace function public.my_context()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'email', app.email(),
    'full_name', app.my_name(),
    'role', app.my_role(),
    'roles', to_jsonb(app.my_roles()),
    'position', (select v.position from public.volunteers v where v.id = app.my_volunteer_id()),
    'is_full', app.is_full(),
    'is_staff', app.is_staff(),
    'is_organizer', app.is_organizer(),
    'committees', to_jsonb(app.my_committees()),
    'volunteer_id', app.my_volunteer_id()
  )
$$;

grant execute on function app.norm(text), app.is_camp(text), app.has_role(public.app_role), app.my_roles()
  to authenticated, service_role;

-- Column guard: same as before, plus the position is HR data.
create or replace function app.guard_volunteer_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  full_access boolean := app.is_full() or app.is_internal();
  is_self     boolean := old.email is not null and old.email = app.email();
  is_leader   boolean := app.leads(old.main_committee, old.sub_committee);
begin
  if full_access then
    return new;
  end if;

  if new.code is distinct from old.code
     or new.registered_at is distinct from old.registered_at
     or new.birth_date is distinct from old.birth_date
     or new.gender is distinct from old.gender then
    raise exception 'الحقل ده بيتحسب تلقائي ومينفعش يتعدّل' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     or new.position is distinct from old.position
     or new.main_committee is distinct from old.main_committee
     or new.sub_committee is distinct from old.sub_committee then
    raise exception 'بيانات المقابلة والوظيفة يعدّلها الـ HR بس' using errcode = '42501';
  end if;

  if not is_self and (
       new.full_name_ar is distinct from old.full_name_ar
    or new.full_name_en is distinct from old.full_name_en
    or new.phone is distinct from old.phone
    or new.whatsapp is distinct from old.whatsapp
    or new.email is distinct from old.email
    or new.qualification is distinct from old.qualification
    or new.job is distinct from old.job
    or new.area is distinct from old.area
    or new.availability_notes is distinct from old.availability_notes
    or new.referral_source is distinct from old.referral_source) then
    raise exception 'البيانات الشخصية يعدّلها المتطوع نفسه أو الـ HR' using errcode = '42501';
  end if;

  if not is_leader and (
       new.contacted is distinct from old.contacted
    or new.passed_committee_test is distinct from old.passed_committee_test
    or new.joined_group is distinct from old.joined_group
    or new.is_active is distinct from old.is_active
    or new.bought_tshirt is distinct from old.bought_tshirt
    or new.attended_minicamp is distinct from old.attended_minicamp
    or new.minicamp_date is distinct from old.minicamp_date) then
    raise exception 'بيانات اللجنة يعدّلها ليدر اللجنة أو الـ HR' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) National id: HR only, never your own, no requests.
-- ---------------------------------------------------------------------
drop policy if exists volunteer_private_self_request on public.volunteer_private;
drop function if exists public.review_national_id(uuid, boolean);

create or replace function app.guard_private_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_internal() or new.national_id is not distinct from old.national_id then
    return new;
  end if;
  if not app.is_full() then
    raise exception 'الرقم القومي بيعدّله الـ HR بس' using errcode = '42501';
  end if;
  if new.volunteer_id = app.my_volunteer_id() then
    raise exception 'محدش يقدر يغيّر رقمه القومي بنفسه. اطلب من حد تاني في الـ HR' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.national_id_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  parsed record;
begin
  if tg_op = 'INSERT' or new.national_id is distinct from old.national_id then
    parsed := app.parse_national_id(new.national_id);
    if parsed.birth_date is not null or parsed.gender is not null then
      perform app.begin_internal();
      update public.volunteers
         set birth_date = coalesce(parsed.birth_date, birth_date),
             gender = coalesce(parsed.gender, gender)
       where id = new.volunteer_id;
      perform app.end_internal();
    end if;
  end if;
  return null;
end;
$$;

alter table public.volunteer_private
  drop column if exists requested_national_id,
  drop column if exists requested_at;

-- Birth date and gender for anyone whose national id was loaded without them.
select app.begin_internal();
update public.volunteers v
   set birth_date = coalesce(v.birth_date, (app.parse_national_id(p.national_id)).birth_date),
       gender = coalesce(v.gender, (app.parse_national_id(p.national_id)).gender)
  from public.volunteer_private p
 where p.volunteer_id = v.id
   and p.national_id ~ '^[23][0-9]{13}$'
   and (v.birth_date is null or v.gender is null);
select app.end_internal();

delete from public.notifications where link = '/requests/national-id';

-- ---------------------------------------------------------------------
-- 3) Camp = mini camp.
-- ---------------------------------------------------------------------
create or replace function app.participation_after_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.volunteers;
  became_accepted boolean :=
    new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted');
begin
  select * into v from public.volunteers where id = new.volunteer_id;

  if became_accepted then
    perform app.begin_internal();
    if app.is_camp(new.event) then
      -- camp and mini camp mark attendance but never change the status
      update public.volunteers
         set attended_minicamp = true,
             minicamp_date = coalesce(minicamp_date, new.activity_date)
       where id = new.volunteer_id;
    elsif v.status = 'خارج المتابعة' then
      update public.volunteers set status = 'تحت المتابعة' where id = new.volunteer_id;
      perform app.notify(
        array[v.email] || app.emails_of(array['admin', 'activity_leader', 'hr']::public.app_role[]),
        'رجوع تحت المتابعة',
        v.full_name_ar || ' رجع تحت المتابعة بعد مشاركة ' || new.event,
        '/volunteers/' || v.id);
    end if;
    perform app.end_internal();
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    perform app.notify(
      app.emails_of(array['admin', 'activity_leader', 'hr', 'organizer']::public.app_role[]),
      'طلب حضور مستني موافقة',
      v.full_name_ar || ' سجّل ' || new.event || ' يوم ' || to_char(new.activity_date, 'DD/MM'),
      '/requests');
  end if;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' then
    perform app.notify(
      array[v.email],
      case new.status when 'accepted' then 'طلب الحضور اتقبل' else 'طلب الحضور اترفض' end,
      new.event || ' يوم ' || to_char(new.activity_date, 'DD/MM'),
      '/me/activities');
  end if;

  return null;
end;
$$;

-- The «ميني كامب» lookup also counts the «كامب» participations in reports
-- through app.is_camp; nothing else to migrate.

-- ---------------------------------------------------------------------
-- 4) Several subjects in one participation («رياضيات، علوم»): each one
--    joins the «نوع الحدث» list on its own.
-- ---------------------------------------------------------------------
create or replace function app.remember_event_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and nullif(btrim(new.subject), '') is not null then
    insert into public.lookups (list, value, parent, sort_order)
    select 'نوع الحدث', s, new.event,
           coalesce((select max(sort_order) + 1 from public.lookups where list = 'نوع الحدث'), 0)
      from (select distinct btrim(x) as s from regexp_split_to_table(new.subject, '\s*[،,]\s*') as x) parts
     where s <> ''
    on conflict on constraint lookups_unique do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Rename a list value and carry the new name into the data.
-- ---------------------------------------------------------------------
create or replace function public.rename_lookup(p_id bigint, p_value text)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  l public.lookups;
  nv text := btrim(p_value);
begin
  if not app.is_full() then
    raise exception 'تعديل القوائم للإدارة بس' using errcode = '42501';
  end if;
  if nv = '' then
    raise exception 'اكتب القيمة';
  end if;
  select * into l from public.lookups where id = p_id;
  if not found then
    raise exception 'القيمة دي مش موجودة';
  end if;
  if l.value = nv then
    return;
  end if;

  update public.lookups set value = nv where id = p_id;

  if l.list = 'اللجنة' then
    update public.volunteers set main_committee = nv where main_committee = l.value;
    update public.volunteers set sub_committee = nv where sub_committee = l.value;
    update public.committee_leaders set committee = nv where committee = l.value;
  elsif l.list = 'الحدث' then
    update public.participations set event = nv where event = l.value;
    update public.group_activities set event = nv where event = l.value;
    update public.lookups set parent = nv where list = 'نوع الحدث' and parent = l.value;
  elsif l.list = 'المكان' then
    update public.participations set place = nv where place = l.value;
    update public.group_activities set place = nv where place = l.value;
  elsif l.list = 'السنة الدراسية' then
    update public.participations set grade = nv where grade = l.value;
    update public.group_activities set grade = nv where grade = l.value;
    update public.schedule_slots set grade = nv where grade = l.value;
  elsif l.list = 'نوع الحدث' then
    update public.participations set subject = nv where subject = l.value;
    update public.group_activities set subject = nv where subject = l.value;
  end if;
end;
$$;

grant execute on function public.rename_lookup(bigint, text) to authenticated;
revoke execute on function public.rename_lookup(bigint, text) from anon;

-- ---------------------------------------------------------------------
-- 6) Accepted participations per volunteer per day (statistics).
-- ---------------------------------------------------------------------
create or replace view public.participation_days
with (security_invoker = true)
as
select p.volunteer_id, p.activity_date, count(*) as participations
from public.participations p
where p.status = 'accepted'
group by 1, 2;

grant select on public.participation_days to authenticated;

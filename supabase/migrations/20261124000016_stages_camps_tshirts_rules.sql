-- =====================================================================
-- 16) Volunteer stages, camp registration (capacity + waiting list),
--     t-shirt requests, activity rules acceptance
-- =====================================================================

-- Permission for all of the above
update public.roles
   set permissions = array(select distinct unnest(permissions || array['stages.manage']))
 where key in ('admin', 'activity_leader', 'hr');

-- ---------------------------------------------------------------------
-- 1) Activity rules: the text lives in app_settings; accepting is per version
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('rules_text', null), ('rules_version', '1')
on conflict (key) do nothing;

create table if not exists public.rules_acceptances (
  volunteer_id uuid not null references public.volunteers (id) on delete cascade,
  version      int not null,
  accepted_at  timestamptz not null default now(),
  primary key (volunteer_id, version)
);
alter table public.rules_acceptances enable row level security;
create policy rules_read on public.rules_acceptances for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('volunteers.view_all')));

create or replace function public.accept_rules()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  vid uuid := app.my_volunteer_id();
  ver int := coalesce((select value::int from public.app_settings where key = 'rules_version'), 1);
begin
  if vid is null then
    raise exception 'الحساب ده مش مربوط بمتطوع' using errcode = '42501';
  end if;
  if coalesce((select value from public.app_settings where key = 'rules_text'), '') = '' then
    raise exception 'قواعد النشاط لسه متكتبتش' using errcode = '22023';
  end if;
  insert into public.rules_acceptances (volunteer_id, version) values (vid, ver) on conflict do nothing;
end;
$$;
revoke all on function public.accept_rules() from public, anon;
grant execute on function public.accept_rules() to authenticated;

-- ---------------------------------------------------------------------
-- 2) T-shirt requests: the volunteer asks, a reviewer confirms → bought_tshirt
-- ---------------------------------------------------------------------
create table if not exists public.tshirt_requests (
  id           uuid primary key default extensions.gen_random_uuid(),
  volunteer_id uuid not null references public.volunteers (id) on delete cascade,
  size         text,
  notes        text,
  status       public.request_status not null default 'pending',
  review_note  text,
  created_at   timestamptz not null default now(),
  reviewed_by  text,
  reviewed_at  timestamptz
);
create unique index if not exists tshirt_one_pending on public.tshirt_requests (volunteer_id) where status = 'pending';
alter table public.tshirt_requests enable row level security;
create policy tshirt_read on public.tshirt_requests for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('stages.manage')));
create policy tshirt_insert on public.tshirt_requests for insert to authenticated
  with check (volunteer_id = (select app.my_volunteer_id()) and status = 'pending');
create policy tshirt_review on public.tshirt_requests for update to authenticated
  using ((select app.has_perm('stages.manage')));
create policy tshirt_cancel on public.tshirt_requests for delete to authenticated
  using ((volunteer_id = (select app.my_volunteer_id()) and status = 'pending') or (select app.has_perm('stages.manage')));

create or replace function app.tshirt_after_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.volunteers;
begin
  select * into v from public.volunteers where id = new.volunteer_id;
  if tg_op = 'INSERT' then
    if v.bought_tshirt then
      raise exception 'التيشيرت متسجل إنك اشتريته قبل كده' using errcode = '22023';
    end if;
    perform app.notify(app.emails_with('stages.manage'), 'طلب تيشيرت', v.full_name_ar || coalesce(' · مقاس ' || new.size, ''), '/requests?tab=tshirts');
  elsif old.status is distinct from new.status and new.status <> 'pending' then
    if new.status = 'accepted' then
      perform app.begin_internal();
      update public.volunteers set bought_tshirt = true where id = new.volunteer_id;
      perform app.end_internal();
    end if;
    perform app.notify(array[v.email]::extensions.citext[],
      case when new.status = 'accepted' then 'التيشيرت اتسجل' else 'طلب التيشيرت اترفض' end,
      coalesce(new.review_note, ''), '/');
  end if;
  return null;
end;
$$;
create or replace function app.tshirt_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := app.email();
    new.reviewed_at := now();
  end if;
  new.volunteer_id := old.volunteer_id;
  return new;
end;
$$;
create trigger tshirt_stamp before update on public.tshirt_requests for each row execute function app.tshirt_stamp();
create trigger tshirt_after_write after insert or update on public.tshirt_requests for each row execute function app.tshirt_after_write();
create trigger audit_tshirt_requests after insert or update or delete on public.tshirt_requests for each row execute function app.audit();

-- ---------------------------------------------------------------------
-- 3) Camps (كامب / ميني كامب): dates, capacity, registration with a waiting list
-- ---------------------------------------------------------------------
create table if not exists public.camps (
  id                uuid primary key default extensions.gen_random_uuid(),
  kind              text not null default 'ميني كامب' check (kind in ('ميني كامب', 'كامب')),
  title             text,
  camp_date         date not null,
  end_date          date check (end_date is null or end_date >= camp_date),
  place             text,
  capacity          int check (capacity is null or capacity > 0),
  notes             text,
  registration_open boolean not null default true,
  created_by        text,
  created_at        timestamptz not null default now()
);
create table if not exists public.camp_registrations (
  camp_id       uuid not null references public.camps (id) on delete cascade,
  volunteer_id  uuid not null references public.volunteers (id) on delete cascade,
  status        text not null default 'confirmed' check (status in ('confirmed', 'waitlist', 'cancelled')),
  attended      boolean not null default false,
  registered_at timestamptz not null default now(),
  primary key (camp_id, volunteer_id)
);
alter table public.camps enable row level security;
alter table public.camp_registrations enable row level security;
create policy camps_read on public.camps for select to authenticated using (true);
create policy camps_write on public.camps for all to authenticated
  using ((select app.has_perm('stages.manage'))) with check ((select app.has_perm('stages.manage')));
create policy camp_reg_read on public.camp_registrations for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('stages.manage')) or (select app.has_perm('volunteers.view_all')));
create trigger audit_camps after insert or update or delete on public.camps for each row execute function app.audit();

-- Seats taken (confirmed) — visible to everyone, names are not
create or replace function public.camp_seats(p_camp uuid)
returns table (confirmed int, waitlist int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where status = 'confirmed')::int, count(*) filter (where status = 'waitlist')::int
    from public.camp_registrations where camp_id = p_camp
$$;
grant execute on function public.camp_seats(uuid) to authenticated;

-- Register (yourself, or someone else with stages.manage). Full → waiting list.
create or replace function public.register_camp(p_camp uuid, p_volunteer uuid default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.camps;
  vid uuid := coalesce(p_volunteer, app.my_volunteer_id());
  taken int;
  st text;
begin
  if vid is null then
    raise exception 'الحساب ده مش مربوط بمتطوع' using errcode = '42501';
  end if;
  if p_volunteer is not null and p_volunteer is distinct from app.my_volunteer_id() and not app.has_perm('stages.manage') then
    raise exception 'مش مسموح لك تسجل حد تاني' using errcode = '42501';
  end if;
  select * into c from public.camps where id = p_camp for update;
  if c is null then
    raise exception 'الكامب ده مش موجود';
  end if;
  if (not c.registration_open or c.camp_date < app.today()) and not app.has_perm('stages.manage') then
    raise exception 'التسجيل في الكامب ده مقفول' using errcode = '22023';
  end if;
  if exists (select 1 from public.camp_registrations where camp_id = p_camp and volunteer_id = vid and status <> 'cancelled') then
    return (select status from public.camp_registrations where camp_id = p_camp and volunteer_id = vid);
  end if;
  select count(*) into taken from public.camp_registrations where camp_id = p_camp and status = 'confirmed';
  st := case when c.capacity is null or taken < c.capacity then 'confirmed' else 'waitlist' end;
  insert into public.camp_registrations (camp_id, volunteer_id, status)
  values (p_camp, vid, st)
  on conflict (camp_id, volunteer_id) do update set status = excluded.status, registered_at = now(), attended = false;
  return st;
end;
$$;
grant execute on function public.register_camp(uuid, uuid) to authenticated;

-- Cancel; the first on the waiting list takes the seat and is told.
create or replace function public.cancel_camp(p_camp uuid, p_volunteer uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  vid uuid := coalesce(p_volunteer, app.my_volunteer_id());
  nxt uuid;
  c public.camps;
begin
  if p_volunteer is not null and p_volunteer is distinct from app.my_volunteer_id() and not app.has_perm('stages.manage') then
    raise exception 'مش مسموح لك تلغي تسجيل حد تاني' using errcode = '42501';
  end if;
  select * into c from public.camps where id = p_camp for update;
  update public.camp_registrations set status = 'cancelled'
   where camp_id = p_camp and volunteer_id = vid and status <> 'cancelled';
  select volunteer_id into nxt from public.camp_registrations
   where camp_id = p_camp and status = 'waitlist' order by registered_at limit 1;
  if nxt is not null and (c.capacity is null or (select count(*) from public.camp_registrations where camp_id = p_camp and status = 'confirmed') < c.capacity) then
    update public.camp_registrations set status = 'confirmed' where camp_id = p_camp and volunteer_id = nxt;
    perform app.notify(array[(select email from public.volunteers where id = nxt)]::extensions.citext[],
      'مكانك في ' || c.kind || ' اتأكد',
      'اتفضّى مكان وبقيت من المؤكدين يوم ' || to_char(c.camp_date, 'DD/MM'), '/');
  end if;
end;
$$;
grant execute on function public.cancel_camp(uuid, uuid) to authenticated;

-- Attendance: marks the camp participation (which also sets «حضر الكامب» on the volunteer)
create or replace function public.set_camp_attendance(p_camp uuid, p_volunteer uuid, p_attended boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.camps;
begin
  if not app.has_perm('stages.manage') then
    raise exception 'محتاج صلاحية مراحل التطوع' using errcode = '42501';
  end if;
  select * into c from public.camps where id = p_camp;
  insert into public.camp_registrations (camp_id, volunteer_id, status, attended)
  values (p_camp, p_volunteer, 'confirmed', p_attended)
  on conflict (camp_id, volunteer_id) do update set attended = p_attended,
    status = case when p_attended then 'confirmed' else public.camp_registrations.status end;
  perform app.begin_internal();
  if p_attended then
    insert into public.participations (volunteer_id, activity_date, event, place, status, method, created_by, reviewed_by, reviewed_at)
    values (p_volunteer, c.camp_date, c.kind, 'الفرع', 'accepted', 'group', app.email(), app.email(), now())
    on conflict do nothing;
  else
    delete from public.participations where volunteer_id = p_volunteer and activity_date = c.camp_date and event = c.kind;
  end if;
  perform app.end_internal();
end;
$$;
grant execute on function public.set_camp_attendance(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Stages: the path every volunteer goes through; extra stages can be added
-- ---------------------------------------------------------------------
create table if not exists public.stages (
  key           text primary key,
  name          text not null,
  description   text,
  source        text not null default 'manual'
                  check (source in ('registered', 'interview', 'rules', 'joined_group', 'committee_test', 'tshirt', 'minicamp',
                                    'first_activity', 'accepted', 'manual')),
  self_complete boolean not null default false,   -- the volunteer can mark it done
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  is_builtin    boolean not null default false
);
insert into public.stages (key, name, description, source, self_complete, sort_order, is_builtin) values
  ('registered',     'التسجيل',                 'بياناتك اتسجلت في النشاط',                                   'registered',     false, 10, true),
  ('interview',      'المقابلة',                'مقابلة مع الـ HR',                                            'interview',      false, 20, true),
  ('rules',          'الموافقة على قواعد النشاط', 'اقرا قواعد النشاط ووافق عليها',                              'rules',          true,  30, true),
  ('joined_group',   'جروب الواتساب',            'ادخل جروب النشاط وجروب لجنتك',                               'joined_group',   true,  40, true),
  ('first_activity', 'أول مشاركة',               'سجّل حضورك في أول نشاط',                                     'first_activity', false, 50, true),
  ('committee_test', 'اختبار اللجنة',            'اختبار اللجنة الأساسية',                                      'committee_test', false, 60, true),
  ('tshirt',         'التيشيرت',                 'اطلب تيشيرت النشاط',                                          'tshirt',         true,  70, true),
  ('minicamp',       'الميني كامب',              'احضر ميني كامب',                                              'minicamp',       true,  80, true),
  ('accepted',       'القبول',                   'بتبقى «مقبول» بعد فترة الاختبار',                             'accepted',       false, 90, true)
on conflict (key) do nothing;

create table if not exists public.stage_done (
  volunteer_id uuid not null references public.volunteers (id) on delete cascade,
  stage_key    text not null references public.stages (key) on delete cascade on update cascade,
  done_at      timestamptz not null default now(),
  done_by      text,
  primary key (volunteer_id, stage_key)
);
alter table public.stages enable row level security;
alter table public.stage_done enable row level security;
create policy stages_read on public.stages for select to authenticated using (true);
create policy stages_write on public.stages for all to authenticated
  using ((select app.has_perm('stages.manage'))) with check ((select app.has_perm('stages.manage')));
create policy stage_done_read on public.stage_done for select to authenticated
  using (volunteer_id = (select app.my_volunteer_id()) or (select app.has_perm('volunteers.view_all')) or (select app.has_perm('stages.manage')));
create policy stage_done_write on public.stage_done for insert to authenticated
  with check ((select app.has_perm('stages.manage'))
              or (volunteer_id = (select app.my_volunteer_id())
                  and exists (select 1 from public.stages s where s.key = stage_key and s.self_complete and s.source in ('manual', 'joined_group'))));
create policy stage_done_delete on public.stage_done for delete to authenticated
  using ((select app.has_perm('stages.manage')) or volunteer_id = (select app.my_volunteer_id()));
create or replace function app.stage_done_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.done_by := app.email();
  return new;
end;
$$;
create trigger stage_done_stamp before insert on public.stage_done for each row execute function app.stage_done_stamp();
create trigger audit_stages after insert or update or delete on public.stages for each row execute function app.audit('key');

-- A volunteer's stages, done or not
create or replace function public.volunteer_stages(p_volunteer uuid default null)
returns table (key text, name text, description text, source text, self_complete boolean, sort_order int, done boolean, done_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  vid uuid := coalesce(p_volunteer, app.my_volunteer_id());
  v public.volunteers;
  hr public.volunteer_hr;
  ver int := coalesce((select a.value::int from public.app_settings a where a.key = 'rules_version'), 1);
begin
  select * into v from public.volunteers where id = vid;
  if v is null then
    return;
  end if;
  if not (vid = app.my_volunteer_id() or app.has_perm('volunteers.view_all') or app.has_perm('stages.manage')
          or app.leads(v.main_committee, v.sub_committee)) then
    raise exception 'مش مسموح لك تشوف مراحل المتطوع ده' using errcode = '42501';
  end if;
  select * into hr from public.volunteer_hr where volunteer_id = vid;
  return query
  select s.key, s.name, s.description, s.source, s.self_complete, s.sort_order,
         (d.volunteer_id is not null or case s.source
            when 'registered'     then true
            when 'interview'      then hr.interview_date is not null or hr.acceptance is not null
            when 'rules'          then exists (select 1 from public.rules_acceptances r where r.volunteer_id = vid and r.version = ver)
            when 'joined_group'   then v.joined_group
            when 'committee_test' then v.passed_committee_test
            when 'tshirt'         then v.bought_tshirt
            when 'minicamp'       then v.attended_minicamp
            when 'first_activity' then exists (select 1 from public.participations p where p.volunteer_id = vid and p.status = 'accepted')
            when 'accepted'       then hr.acceptance::text = 'مقبول'
            else false
          end) as done,
         coalesce(d.done_at, case s.source
            when 'registered' then v.registered_at
            when 'minicamp'   then v.minicamp_date::timestamptz
            when 'rules'      then (select r.accepted_at from public.rules_acceptances r where r.volunteer_id = vid and r.version = ver)
            when 'first_activity' then (select min(p.activity_date)::timestamptz from public.participations p where p.volunteer_id = vid and p.status = 'accepted')
          end)
    from public.stages s
    left join public.stage_done d on d.volunteer_id = vid and d.stage_key = s.key
   where s.is_active
   order by s.sort_order, s.name;
end;
$$;
revoke all on function public.volunteer_stages(uuid) from public, anon;
grant execute on function public.volunteer_stages(uuid) to authenticated;

-- Camp attendance numbers for the statistics
create or replace function public.camp_stats()
returns table (camp_id uuid, kind text, camp_date date, title text, capacity int, confirmed int, waitlist int, cancelled int, attended int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.camp_date, c.title, c.capacity,
         count(*) filter (where r.status = 'confirmed')::int,
         count(*) filter (where r.status = 'waitlist')::int,
         count(*) filter (where r.status = 'cancelled')::int,
         count(*) filter (where r.attended)::int
    from public.camps c
    left join public.camp_registrations r on r.camp_id = c.id
   where app.has_perm('stats.view') or app.has_perm('stages.manage')
   group by c.id
   order by c.camp_date desc
$$;
grant execute on function public.camp_stats() to authenticated;

-- ---------------------------------------------------------------------
-- 5) Mini camp reminders: everyone in follow-up who never attended one is told the date
-- ---------------------------------------------------------------------
create or replace function app.camp_invitees(p_camp uuid)
returns extensions.citext[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.email), '{}')
    from public.volunteers v
   where v.email is not null
     and v.status::text <> 'خارج المتابعة'
     and not v.attended_minicamp
     and not exists (select 1 from public.camp_registrations r where r.camp_id = p_camp and r.volunteer_id = v.id and r.status <> 'cancelled')
$$;

create or replace function app.camp_announce()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.kind = 'ميني كامب' and new.registration_open and new.camp_date >= app.today()
     and (tg_op = 'INSERT' or not old.registration_open) then
    perform app.notify(app.camp_invitees(new.id),
      'ميني كامب يوم ' || to_char(new.camp_date, 'DD/MM'),
      'لسه محضرتش ميني كامب. سجّل مكانك' || coalesce(' · ' || new.capacity || ' مكان', '') || coalesce(' · ' || new.place, ''),
      '/');
  end if;
  return null;
end;
$$;
drop trigger if exists camps_announce on public.camps;
create trigger camps_announce after insert or update on public.camps for each row execute function app.camp_announce();

-- Send the reminder again (button on the camps page); returns how many were told
create or replace function public.remind_camp(p_camp uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.camps;
  who extensions.citext[];
begin
  if not app.has_perm('stages.manage') then
    raise exception 'محتاج صلاحية مراحل التطوع' using errcode = '42501';
  end if;
  select * into c from public.camps where id = p_camp;
  who := app.camp_invitees(p_camp);
  perform app.notify(who, 'تذكير: ' || c.kind || ' يوم ' || to_char(c.camp_date, 'DD/MM'),
    'لسه محضرتش ميني كامب. سجّل مكانك قبل ما الأماكن تخلص' || coalesce(' · ' || c.place, ''), '/');
  return coalesce(array_length(who, 1), 0);
end;
$$;
grant execute on function public.remind_camp(uuid) to authenticated;

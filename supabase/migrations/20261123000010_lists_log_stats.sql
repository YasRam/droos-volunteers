-- =====================================================================
-- Lists you can edit safely, a readable log, and top-participant stats.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lists: a WhatsApp group link per committee (lookups of «اللجنة»).
-- ---------------------------------------------------------------------
alter table public.lookups add column if not exists link text;
comment on column public.lookups.link is 'لينك جروب الواتساب بتاع اللجنة (لقايمة «اللجنة» بس).';

-- Bulk changes made by these functions write one summary line to the log, not one per row.
create or replace function app.audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old_j = new_j then
    return null;
  end if;
  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (
    coalesce(app.email()::text, case when app.is_internal() then 'system' end),
    tg_table_name,
    tg_op,
    coalesce(new_j, old_j) ->> coalesce(tg_argv[0], 'id'),
    old_j,
    new_j);
  return null;
end;
$$;

-- Which data columns hold each list's values. Lists backed by fixed types
-- (حالة المتطوع، حالة القبول، اليوم) are not renamed or deleted here.
create or replace function app.list_is_fixed(p_list text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_list in ('حالة المتطوع', 'حالة القبول', 'اليوم')
$$;

-- Rename a list value. With p_update_data the old value is replaced in the saved data too;
-- without it, old records keep the old text.
create or replace function public.rename_lookup(p_id bigint, p_value text, p_update_data boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.lookups;
  new_value text := btrim(p_value);
  n int := 0;
  c int;
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    raise exception 'القيمة دي مش موجودة';
  end if;
  if app.list_is_fixed(l.list) then
    raise exception 'القايمة دي ثابتة ومينفعش تتعدّل' using errcode = '42501';
  end if;
  if coalesce(new_value, '') = '' then
    raise exception 'اكتب القيمة الجديدة';
  end if;
  if new_value = l.value then
    return jsonb_build_object('rows', 0);
  end if;
  if exists (select 1 from public.lookups where list = l.list and value = new_value and parent is not distinct from l.parent) then
    raise exception 'القيمة «%» موجودة في القايمة قبل كده', new_value;
  end if;

  update public.lookups set value = new_value where id = p_id;

  if p_update_data then
    perform app.begin_internal();
    perform set_config('app.skip_audit', 'on', true);
    case l.list
      when 'اللجنة' then
        update public.volunteers set main_committee = new_value where main_committee = l.value; get diagnostics c = row_count; n := n + c;
        update public.volunteers set sub_committee = new_value where sub_committee = l.value; get diagnostics c = row_count; n := n + c;
        update public.committee_leaders set committee = new_value where committee = l.value; get diagnostics c = row_count; n := n + c;
      when 'الحدث' then
        update public.participations set event = new_value where event = l.value; get diagnostics c = row_count; n := n + c;
        update public.group_activities set event = new_value where event = l.value; get diagnostics c = row_count; n := n + c;
        update public.lookups set parent = new_value where list = 'نوع الحدث' and parent = l.value;
      when 'نوع الحدث' then
        update public.participations set subject = new_value where subject = l.value and (l.parent is null or event = l.parent); get diagnostics c = row_count; n := n + c;
        update public.group_activities set subject = new_value where subject = l.value and (l.parent is null or event = l.parent); get diagnostics c = row_count; n := n + c;
        update public.schedule_slots set subject = new_value where subject = l.value; get diagnostics c = row_count; n := n + c;
      when 'السنة الدراسية' then
        update public.participations set grade = new_value where grade = l.value; get diagnostics c = row_count; n := n + c;
        update public.group_activities set grade = new_value where grade = l.value; get diagnostics c = row_count; n := n + c;
        update public.schedule_slots set grade = new_value where grade = l.value; get diagnostics c = row_count; n := n + c;
      when 'المكان' then
        update public.participations set place = new_value where place = l.value; get diagnostics c = row_count; n := n + c;
        update public.group_activities set place = new_value where place = l.value; get diagnostics c = row_count; n := n + c;
      when 'القائم على المقابلة' then
        update public.volunteer_hr set interviewer = new_value where interviewer = l.value; get diagnostics c = row_count; n := n + c;
      else
        null;
    end case;
    perform set_config('app.skip_audit', 'off', true);
    perform app.end_internal();
  end if;

  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (app.email(), 'lookups', 'UPDATE', p_id::text,
          jsonb_build_object('list', l.list, 'value', l.value),
          jsonb_build_object('list', l.list, 'value', new_value, 'rows_updated', n));
  return jsonb_build_object('rows', n);
exception
  when unique_violation then
    raise exception 'التغيير ده هيعمل مشاركات متكررة لنفس المتطوع. راجع القيمتين الأول.';
end;
$$;

-- Delete a list value. The saved data is never touched: old records keep their text.
create or replace function public.delete_lookup(p_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.lookups;
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    return;
  end if;
  if app.list_is_fixed(l.list) then
    raise exception 'القايمة دي ثابتة ومينفعش تتمسح منها حاجة' using errcode = '42501';
  end if;
  delete from public.lookups where id = p_id;
  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (app.email(), 'lookups', 'DELETE', p_id::text, jsonb_build_object('list', l.list, 'value', l.value), null);
end;
$$;

-- How many saved records use a value (shown before renaming or deleting).
create or replace function public.lookup_usage(p_id bigint)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  with l as (select * from public.lookups where id = p_id)
  select case l.list
    when 'اللجنة' then (select count(*) from public.volunteers v where v.main_committee = l.value or v.sub_committee = l.value)
    when 'الحدث' then (select count(*) from public.participations p where p.event = l.value)
    when 'نوع الحدث' then (select count(*) from public.participations p where p.subject = l.value) + (select count(*) from public.schedule_slots s where s.subject = l.value)
    when 'السنة الدراسية' then (select count(*) from public.participations p where p.grade = l.value) + (select count(*) from public.schedule_slots s where s.grade = l.value)
    when 'المكان' then (select count(*) from public.participations p where p.place = l.value)
    when 'القائم على المقابلة' then (select count(*) from public.volunteer_hr h where h.interviewer = l.value)
    else 0 end
  from l
  where app.has_perm('settings.manage')
$$;

-- ---------------------------------------------------------------------
-- Readable log: who (by name), on whom, and the rows with private fields
-- removed for anyone who may not see them.
-- ---------------------------------------------------------------------
create or replace function app.redact(j jsonb)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when j is null then null else
    j
    - case when app.has_perm('hr.notes') then '{}'::text[] else array['hr_notes'] end
    - case when app.has_perm('national_id.view') then '{}'::text[] else array['national_id', 'requested_national_id'] end
  end
$$;

create or replace view public.audit_log_read
with (security_barrier = true)
as
select
  a.id,
  a.at,
  a.actor_email,
  coalesce(av.full_name_ar, s.full_name, cl.full_name,
           case when a.actor_email = 'system' or a.actor_email is null then 'السيستم' end,
           a.actor_email) as actor_name,
  a.table_name,
  a.action,
  a.record_id,
  coalesce(tv.full_name_ar, a.new_row ->> 'full_name_ar', a.old_row ->> 'full_name_ar') as target_name,
  tv.id as target_volunteer_id,
  app.redact(a.old_row) as old_row,
  app.redact(a.new_row) as new_row
from public.audit_log a
left join public.staff_roles s on s.email = a.actor_email
left join lateral (select c.full_name from public.committee_leaders c where c.email = a.actor_email limit 1) cl on true
left join public.volunteers av on av.id = coalesce(s.volunteer_id, (select v.id from public.volunteers v where v.email = a.actor_email limit 1))
left join public.volunteers tv on tv.id::text = case
    when a.table_name = 'volunteers' then a.record_id
    when a.table_name in ('volunteer_private', 'volunteer_hr') then a.record_id
    when a.table_name in ('participations', 'schedule_slots') then coalesce(a.new_row, a.old_row) ->> 'volunteer_id'
    when a.table_name in ('staff_roles', 'committee_leaders') then coalesce(a.new_row, a.old_row) ->> 'volunteer_id'
  end
where (select app.has_perm('log.view'));

grant select on public.audit_log_read to authenticated;

create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function app.audit('key');

-- ---------------------------------------------------------------------
-- Top participants for a period (accepted participations only).
-- Runs with the caller's rights: they see only what they may read.
-- ---------------------------------------------------------------------
create or replace function public.top_participants(
  p_from date,
  p_to date,
  p_committee text default null,
  p_event text default null,
  p_limit int default 20
)
returns table (
  volunteer_id uuid,
  code text,
  full_name_ar text,
  main_committee text,
  status public.volunteer_status,
  participations bigint,
  active_days bigint,
  beneficiaries bigint,
  last_date date
)
language sql stable security invoker
set search_path = ''
as $$
  select v.id, v.code, v.full_name_ar, v.main_committee, v.status,
         count(*) as participations,
         count(distinct p.activity_date) as active_days,
         coalesce(sum(p.beneficiaries), 0) as beneficiaries,
         max(p.activity_date) as last_date
  from public.participations p
  join public.volunteers v on v.id = p.volunteer_id
  where p.status = 'accepted'
    and p.activity_date between p_from and p_to
    and (p_event is null or p.event = p_event)
    and (p_committee is null or v.main_committee = p_committee or v.sub_committee = p_committee)
  group by v.id
  order by participations desc, active_days desc, last_date desc
  limit least(greatest(p_limit, 1), 200)
$$;

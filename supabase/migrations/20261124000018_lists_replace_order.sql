-- =====================================================================
-- 18) Lists: every list editable and orderable by settings.manage; deleting a value can move
--     the records that use it to another value; class kind and audience become lists
-- =====================================================================

-- Class kind and audience come from lists now
alter table public.schedule_slots drop constraint if exists schedule_slots_kind_check;
alter table public.schedule_slots drop constraint if exists schedule_slots_audience_check;
insert into public.lookups (list, value, sort_order)
select l, v, n from (values
  ('نوع الحصة', 'حصة', 1), ('نوع الحصة', 'تأسيس', 2), ('نوع الحصة', 'ورشة ثابتة', 3),
  ('لمين', 'الكل', 1), ('لمين', 'بنات بس', 2), ('لمين', 'ولاد بس', 3)) as t(l, v, n)
where not exists (select 1 from public.lookups x where x.list = t.l and x.value = t.v);

-- Moves every record from one value of a list to another. Returns how many records changed.
create or replace function app.lookup_move(p_list text, p_parent text, p_old text, p_new text)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  n int := 0;
  c int;
  e text := app.list_enum(p_list);
begin
  if e = 'volunteer_status' then
    execute format('update public.volunteers set status = %L::public.volunteer_status where status::text = %L', p_new, p_old);
    get diagnostics n = row_count;
    return n;
  elsif e = 'acceptance_grade' then
    execute format('update public.volunteer_hr set acceptance = %L::public.acceptance_grade where acceptance::text = %L', p_new, p_old);
    get diagnostics n = row_count;
    return n;
  end if;
  case p_list
    when 'اللجنة' then
      update public.volunteers set main_committee = p_new where main_committee = p_old; get diagnostics c = row_count; n := n + c;
      update public.volunteers set sub_committee = p_new where sub_committee = p_old; get diagnostics c = row_count; n := n + c;
      update public.committee_leaders set committee = p_new where committee = p_old; get diagnostics c = row_count; n := n + c;
      update public.meetings set committee = p_new where committee = p_old; get diagnostics c = row_count; n := n + c;
    when 'الحدث' then
      update public.participations set event = p_new where event = p_old; get diagnostics c = row_count; n := n + c;
      update public.group_activities set event = p_new where event = p_old; get diagnostics c = row_count; n := n + c;
      update public.lookups set parent = p_new where list = 'نوع الحدث' and parent = p_old;
    when 'نوع الحدث' then
      update public.participations set subject = p_new where subject = p_old and (p_parent is null or event = p_parent); get diagnostics c = row_count; n := n + c;
      update public.group_activities set subject = p_new where subject = p_old and (p_parent is null or event = p_parent); get diagnostics c = row_count; n := n + c;
      update public.schedule_slots set subject = p_new where subject = p_old; get diagnostics c = row_count; n := n + c;
    when 'السنة الدراسية' then
      update public.participations set grade = p_new where grade = p_old; get diagnostics c = row_count; n := n + c;
      update public.group_activities set grade = p_new where grade = p_old; get diagnostics c = row_count; n := n + c;
      update public.schedule_slots set grade = p_new where grade = p_old; get diagnostics c = row_count; n := n + c;
    when 'المكان' then
      update public.participations set place = p_new where place = p_old; get diagnostics c = row_count; n := n + c;
      update public.group_activities set place = p_new where place = p_old; get diagnostics c = row_count; n := n + c;
    when 'القائم على المقابلة' then
      update public.volunteer_hr set interviewer = p_new where interviewer = p_old; get diagnostics c = row_count; n := n + c;
    when 'نوع الحصة' then
      update public.schedule_slots set kind = p_new where kind = p_old; get diagnostics c = row_count; n := n + c;
    when 'لمين' then
      update public.schedule_slots set audience = p_new where audience = p_old; get diagnostics c = row_count; n := n + c;
    when 'سبب الخروج' then
      update public.volunteers set out_reason = p_new where out_reason = p_old; get diagnostics c = row_count; n := n + c;
    when 'السنة الدراسية للمتطوع' then
      update public.volunteers set study_year = p_new where study_year = p_old; get diagnostics c = row_count; n := n + c;
    when 'عرفتنا منين' then
      update public.volunteers set referral_source = p_new where referral_source = p_old; get diagnostics c = row_count; n := n + c;
    else
      null;
  end case;
  return n;
end;
$$;

create or replace function public.rename_lookup(p_id bigint, p_value text, p_update_data boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.lookups;
  new_value text := btrim(p_value);
  n int := 0;
  e text;
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    raise exception 'القيمة دي مش موجودة';
  end if;
  if app.lookup_locked(l.list, l.value) then
    raise exception 'القيمة «%» السيستم بيعتمد عليها ومينفعش تتغير', l.value using errcode = '42501';
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

  e := app.list_enum(l.list);
  perform app.begin_internal();
  perform set_config('app.skip_audit', 'on', true);
  if e is not null then
    -- an enum value is renamed in place, everywhere at once
    execute format('alter type public.%I rename value %L to %L', e, l.value, new_value);
    if e = 'volunteer_status' then
      select count(*) into n from public.volunteers where status::text = new_value;
    else
      select count(*) into n from public.volunteer_hr where acceptance::text = new_value;
    end if;
    perform set_config('app.enum_rename', 'on', true);
    update public.lookups set value = new_value where id = p_id;
    perform set_config('app.enum_rename', 'off', true);
  else
    update public.lookups set value = new_value where id = p_id;
    if p_update_data then
      n := app.lookup_move(l.list, l.parent, l.value, new_value);
    end if;
  end if;
  perform set_config('app.skip_audit', 'off', true);
  perform app.end_internal();

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

-- Delete (or, for status lists, hide) a value. With p_replace_with, every record that used it
-- moves to that value first; without it, old records keep the old value.
drop function if exists public.delete_lookup(bigint);
create or replace function public.delete_lookup(p_id bigint, p_replace_with text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.lookups;
  n int := 0;
  target text := nullif(btrim(coalesce(p_replace_with, '')), '');
begin
  if not app.has_perm('settings.manage') then
    raise exception 'محتاج صلاحية الإعدادات' using errcode = '42501';
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    return jsonb_build_object('rows', 0);
  end if;
  if app.lookup_locked(l.list, l.value) then
    raise exception 'القيمة «%» السيستم بيعتمد عليها ومينفعش تتشال', l.value using errcode = '42501';
  end if;
  if target is not null then
    if target = l.value then
      raise exception 'اختار قيمة تانية';
    end if;
    if not exists (select 1 from public.lookups where list = l.list and value = target) then
      raise exception 'القيمة «%» مش في القايمة', target;
    end if;
    perform app.begin_internal();
    perform set_config('app.skip_audit', 'on', true);
    n := app.lookup_move(l.list, l.parent, l.value, target);
    perform set_config('app.skip_audit', 'off', true);
    perform app.end_internal();
  end if;
  if app.list_enum(l.list) is not null then
    update public.lookups set is_active = false where id = p_id;   -- enum values can't be dropped
  else
    delete from public.lookups where id = p_id;
  end if;
  insert into public.audit_log (actor_email, table_name, action, record_id, old_row, new_row)
  values (app.email(), 'lookups', 'DELETE', p_id::text, jsonb_build_object('list', l.list, 'value', l.value),
          case when target is null then null else jsonb_build_object('list', l.list, 'value', target, 'rows_updated', n) end);
  return jsonb_build_object('rows', n);
exception
  when unique_violation then
    raise exception 'النقل ده هيعمل مشاركات متكررة لنفس المتطوع في نفس اليوم. اختار قيمة تانية.';
end;
$$;
revoke all on function public.delete_lookup(bigint, text) from public, anon;
grant execute on function public.delete_lookup(bigint, text) to authenticated;

-- Usage count for every list the app knows
drop function if exists public.lookup_usage(bigint);
create function public.lookup_usage(p_id bigint)
returns int
language plpgsql stable security definer
set search_path = ''
as $$
declare
  l public.lookups;
begin
  if not app.has_perm('settings.manage') then
    return 0;
  end if;
  select * into l from public.lookups where id = p_id;
  if l is null then
    return 0;
  end if;
  return case l.list
    when 'حالة المتطوع' then (select count(*) from public.volunteers where status::text = l.value)
    when 'حالة القبول' then (select count(*) from public.volunteer_hr where acceptance::text = l.value)
    when 'اللجنة' then (select count(*) from public.volunteers where main_committee = l.value or sub_committee = l.value)
    when 'الحدث' then (select count(*) from public.participations where event = l.value)
    when 'نوع الحدث' then (select count(*) from public.participations where subject = l.value) + (select count(*) from public.schedule_slots where subject = l.value)
    when 'السنة الدراسية' then (select count(*) from public.participations where grade = l.value) + (select count(*) from public.schedule_slots where grade = l.value)
    when 'المكان' then (select count(*) from public.participations where place = l.value)
    when 'القائم على المقابلة' then (select count(*) from public.volunteer_hr where interviewer = l.value)
    when 'نوع الحصة' then (select count(*) from public.schedule_slots where kind = l.value)
    when 'لمين' then (select count(*) from public.schedule_slots where audience = l.value)
    when 'سبب الخروج' then (select count(*) from public.volunteers where out_reason = l.value)
    when 'السنة الدراسية للمتطوع' then (select count(*) from public.volunteers where study_year = l.value)
    when 'عرفتنا منين' then (select count(*) from public.volunteers where referral_source = l.value)
    else 0
  end;
end;
$$;

revoke all on function public.lookup_usage(bigint) from public, anon;
grant execute on function public.lookup_usage(bigint) to authenticated;

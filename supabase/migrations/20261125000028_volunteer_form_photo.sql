-- =====================================================================
-- 28) The printable volunteer form (استمارة التطوع) and the volunteer's photo
--   * a private «photos» bucket: <volunteer_id>/photo.<ext>
--   * volunteer_form(): everything the form prints, in one call
--   * the night-before class reminder no longer opens the excuse screen
-- =====================================================================
alter table public.volunteer_private add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function app.can_see_volunteer_form(vid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select vid = app.my_volunteer_id() or app.has_perm('hr.view') or app.has_perm('volunteers.edit')
$$;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and app.can_see_volunteer_form(((storage.foldername(name))[1])::uuid));
drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (
    (storage.foldername(name))[1] = (select app.my_volunteer_id())::text
    or (select app.has_perm('hr.edit')) or (select app.has_perm('volunteers.edit'))));
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (
    (storage.foldername(name))[1] = (select app.my_volunteer_id())::text
    or (select app.has_perm('hr.edit')) or (select app.has_perm('volunteers.edit'))));
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (
    (storage.foldername(name))[1] = (select app.my_volunteer_id())::text
    or (select app.has_perm('hr.edit')) or (select app.has_perm('volunteers.edit'))));

-- remember where the photo is (the volunteer can't update volunteer_private directly)
create or replace function public.set_photo(p_volunteer uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (p_volunteer = app.my_volunteer_id() or app.has_perm('hr.edit') or app.has_perm('volunteers.edit')) then
    raise exception 'مش مسموح' using errcode = '42501';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_volunteer::text then
    raise exception 'مكان الصورة غلط' using errcode = '22023';
  end if;
  update public.volunteer_private set photo_path = p_path where volunteer_id = p_volunteer;
end;
$$;
revoke all on function public.set_photo(uuid, text) from public, anon;
grant execute on function public.set_photo(uuid, text) to authenticated;

-- Everything the form prints
create or replace function public.volunteer_form(p_volunteer uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when app.can_see_volunteer_form(p_volunteer) then
    to_jsonb(v) - 'search' - 'follow_notes_1' - 'follow_notes_2' - 'follow_notes_3'
    || jsonb_build_object(
      'national_id', p.national_id,
      'photo_path', p.photo_path,
      'interview_date', h.interview_date,
      'interviewer', coalesce((select full_name_ar from public.volunteers i where i.id = h.interviewer_id), h.interviewer),
      'acceptance', h.acceptance,
      'participations', (select count(*) from public.participations x where x.volunteer_id = v.id and x.status = 'accepted'),
      'first_activity', (select min(activity_date) from public.participations x where x.volunteer_id = v.id and x.status = 'accepted'),
      'last_activity', (select max(activity_date) from public.participations x where x.volunteer_id = v.id and x.status = 'accepted'),
      'rules_agreed', (select max(accepted_at) from public.rules_acceptances r where r.volunteer_id = v.id),
      'leads', (select coalesce(jsonb_agg(c.role || ' ' || c.committee), '[]') from public.committee_leaders c where c.volunteer_id = v.id))
  end
  from public.volunteers v
  left join public.volunteer_private p on p.volunteer_id = v.id
  left join public.volunteer_hr h on h.volunteer_id = v.id
  where v.id = p_volunteer
$$;
revoke all on function public.volunteer_form(uuid) from public, anon;
grant execute on function public.volunteer_form(uuid) to authenticated;

-- The night-before reminder: a reminder, not an invitation to excuse yourself
do $$
declare
  src text;
begin
  select pg_get_functiondef('app.remind_classes_tomorrow()'::regprocedure) into src;
  src := replace(src, 'app.slot_label(s) || ''. لو مش هتقدر تيجي اعتذر دلوقتي عشان التنظيم يلحق'',
      ''/schedule?absence='' || s.id || ''&date='' || d);',
    'app.slot_label(s) || ''. مستنيينك 💪'', ''/schedule'');');
  execute src;
end $$;

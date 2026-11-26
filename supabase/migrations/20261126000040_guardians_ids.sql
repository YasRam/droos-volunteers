-- Guardians, parents' phones, ID card expiry alerts, and both sides of the volunteer's ID card.
--
--  * The father is the guardian by default. With an educational guardianship (ولاية تعليمية) the
--    mother is the guardian; if the children live with someone else, a different guardian is added.
--    The guardian's phone (guardians.phone) is the main contact. The father's and mother's phones
--    are optional (student_private.father_phone / mother_phone).
--  * Every morning: the guardian's, father's or mother's ID card that ends in 30 or 7 days, or ended
--    today, tells whoever edits students; the guardian's own account is told too.
--  * certificate_requests.id_card_back_path: the back of the ID card.

alter table students.student_private
  add column if not exists father_phone text,
  add column if not exists mother_phone text;

alter table public.certificate_requests
  add column if not exists id_card_back_path text;

-- Cards that end soon, for students in the current term
create or replace function students.expiring_ids(p_within int default 30)
returns table (student_id uuid, student_name text, who text, person text, valid_until date, days_left int)
language sql stable security definer set search_path = '' as $$
  with cur as (
    select distinct s.id, s.full_name, s.guardian_id
      from students.students s
      join students.enrollments e on e.student_id = s.id and e.status not in ('مفصول', 'منقطع', 'اتنقل')
      join students.terms t on t.id = e.term_id and t.is_current
  ), cards as (
    select c.id, c.full_name, 'ولي الأمر' as who, g.full_name as person, g.id_valid_until as valid_until
      from cur c join students.guardians g on g.id = c.guardian_id
    union all
    select c.id, c.full_name, 'الأب', sp.father_name, sp.father_id_valid_until
      from cur c join students.student_private sp on sp.student_id = c.id
     where sp.father_national_id is distinct from (select g.national_id from students.guardians g where g.id = c.guardian_id)
    union all
    select c.id, c.full_name, 'الأم', sp.mother_name, sp.mother_id_valid_until
      from cur c join students.student_private sp on sp.student_id = c.id
     where sp.mother_national_id is distinct from (select g.national_id from students.guardians g where g.id = c.guardian_id)
  )
  select id, full_name, who, person, valid_until, (valid_until - app.today())::int
    from cards
   where valid_until is not null and valid_until <= app.today() + p_within
     and (app.is_internal() or app.has_perm('students.view_sensitive') or app.has_perm('students.edit'))
   order by valid_until, full_name
$$;
revoke all on function students.expiring_ids(int) from public, anon;
grant execute on function students.expiring_ids(int) to authenticated, service_role;

create or replace function students.alert_expiring_ids()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  perform set_config('app.internal', 'on', true);
  for r in select * from students.expiring_ids(30) where days_left in (30, 7, 0) loop
    perform app.notify(app.emails_with('students.edit'),
      case when r.days_left = 0 then 'بطاقة انتهت النهارده' else 'بطاقة هتنتهي بعد ' || r.days_left || ' يوم' end,
      'بطاقة ' || r.who || coalesce(' (' || r.person || ')', '') || ' للطالب ' || r.student_name || '. اطلب صورة البطاقة الجديدة',
      '/students/' || r.student_id);
    if r.who = 'ولي الأمر' then
      perform app.notify(
        (select coalesce(array_agg(a.login_email), '{}') from students.accounts a
          join students.students s on s.guardian_id = a.guardian_id where s.id = r.student_id and a.kind = 'guardian'),
        'بطاقتك ' || case when r.days_left = 0 then 'انتهت' else 'هتنتهي بعد ' || r.days_left || ' يوم' end,
        'جدّد البطاقة وابعت صورتها للتنظيم في النشاط',
        '/family');
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function students.alert_expiring_ids() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('students-id-expiry', '30 5 * * *', $c$select students.alert_expiring_ids()$c$);
exception when others then null;
end $$;

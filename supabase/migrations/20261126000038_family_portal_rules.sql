-- Family portal and the students' rules.
--
--  * Guardians sign in with their mobile and a password, students with their national ID and a
--    password. Behind the scenes the login is <mobile>@family.droos / <national id>@family.droos.
--    The first time (or after forgetting) they prove who they are with data we already have:
--      guardian  mobile (his, or one on his child's file) + a national ID (his, the father's,
--                the mother's, or one of his children's)
--      student   his national ID + a mobile on his file (his family's)
--    The «account» edge function checks with students.family_check and makes the account.
--    Staff with «students.accounts» can set a password for either from the student's page.
--  * students.rules: the rules the guardian agrees to, one by one (agree or comment), like the
--    volunteers' rules. A new or reworded rule needs agreeing again and tells the guardians.
--    Staff can mark that a guardian agreed on paper.
--  * students.family_home(): everything the family page shows, in one call.

-- ---------------------------------------------------------------------
-- 1) Tries (5 wrong an hour per login, 50 in all)
-- ---------------------------------------------------------------------
create table if not exists students.login_attempts (
  id     bigint generated always as identity primary key,
  login  text not null,
  ok     boolean not null,
  at     timestamptz not null default now()
);
create index if not exists login_attempts_idx on students.login_attempts (login, at desc);
alter table students.login_attempts enable row level security;
grant all on students.login_attempts to service_role;

create or replace function students.digits(t text)
returns text language sql immutable set search_path = '' as $$
  -- Arabic/Persian digits to Latin, keep digits only, +20/0020 → 0
  select regexp_replace(
           regexp_replace(translate(coalesce(t, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'),
           '^(0020|20)(1[0125][0-9]{8})$', '0\2')
$$;

-- ---------------------------------------------------------------------
-- 2) Who is signing up (service role only)
-- ---------------------------------------------------------------------
create or replace function students.family_check(p_kind text, p_login text, p_nid text, p_phone text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := students.digits(p_login);
  nid   text := students.digits(p_nid);
  ph    text := students.digits(coalesce(p_phone, p_login));
  fails int;
  ids   uuid[];
  acc   students.accounts;
begin
  if p_kind not in ('guardian', 'student') then
    return jsonb_build_object('ok', false, 'error', 'اختار ولي أمر ولا طالب');
  end if;
  select count(*) into fails from students.login_attempts l where l.login = p_kind || ':' || v_login and not ok and at > now() - interval '1 hour';
  if fails >= 5 or (select count(*) from students.login_attempts where not ok and at > now() - interval '1 hour') >= 50 then
    return jsonb_build_object('ok', false, 'error', 'محاولات كتير، جرّب بعد ساعة');
  end if;

  if p_kind = 'guardian' then
    if v_login !~ '^01[0125][0-9]{8}$' then
      return jsonb_build_object('ok', false, 'error', 'اكتب الموبايل صح (11 رقم)');
    end if;
    select coalesce(array_agg(distinct g.id), '{}') into ids
      from students.guardians g
      join students.students s on s.guardian_id = g.id
      left join students.student_private sp on sp.student_id = s.id
     where (g.phone = v_login or exists (select 1 from students.phones p where p.student_id = s.id and p.number = v_login))
       and nid ~ '^[23][0-9]{13}$'
       and nid in (g.national_id, sp.national_id, sp.father_national_id, sp.mother_national_id);
  else
    if v_login !~ '^[23][0-9]{13}$' then
      return jsonb_build_object('ok', false, 'error', 'اكتب الرقم القومي صح (14 رقم)');
    end if;
    select coalesce(array_agg(distinct s.id), '{}') into ids
      from students.students s
      join students.student_private sp on sp.student_id = s.id
      left join students.guardians g on g.id = s.guardian_id
     where sp.national_id = v_login
       and ph ~ '^01[0125][0-9]{8}$'
       and (g.phone = ph or exists (select 1 from students.phones p where p.student_id = s.id and p.number = ph));
  end if;

  insert into students.login_attempts (login, ok) values (p_kind || ':' || v_login, cardinality(ids) = 1);
  if cardinality(ids) <> 1 then
    return jsonb_build_object('ok', false, 'error',
      case when cardinality(ids) > 1 then 'الرقم ده على أكتر من ولي أمر. كلّم التنظيم يعملولك كلمة سر'
           else 'البيانات دي مش متطابقة مع اللي عندنا. اتأكد منها أو كلّم التنظيم' end);
  end if;

  select * into acc from students.accounts a
   where (p_kind = 'guardian' and a.guardian_id = ids[1]) or (p_kind = 'student' and a.student_id = ids[1]);
  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', ids[1],
    'login_email', v_login || '@family.droos',
    'user_id', coalesce(acc.user_id, (select u.id from auth.users u where lower(u.email) = v_login || '@family.droos' limit 1)));
end;
$$;

-- Staff set a password: who it is and whether the caller may (service role only)
create or replace function students.family_target(p_caller text, p_kind text, p_student uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with caller as (
    select coalesce(array_agg(distinct p), '{}') as perms
      from public.staff_roles s join public.roles r on r.key = s.role
      cross join lateral unnest(r.permissions) p
     where lower(s.email) = lower(p_caller) and s.active
  ), t as (
    select s.id as student_id, s.guardian_id,
           case when p_kind = 'guardian'
                then coalesce(g.phone, (select p.number from students.phones p where p.student_id = s.id order by p.sort_order, p.number limit 1))
                else sp.national_id end as login
      from students.students s
      left join students.guardians g on g.id = s.guardian_id
      left join students.student_private sp on sp.student_id = s.id
     where s.id = p_student
  )
  select jsonb_build_object(
    'allowed', 'students.accounts' = any (c.perms),
    'kind', p_kind,
    'id', case when p_kind = 'guardian' then t.guardian_id else t.student_id end,
    'login', t.login,
    'login_email', t.login || '@family.droos',
    'user_id', (select a.user_id from students.accounts a
                 where (p_kind = 'guardian' and a.guardian_id = t.guardian_id) or (p_kind = 'student' and a.student_id = t.student_id))
  )
  from t, caller c
$$;

-- After the edge function made (or found) the auth user: link it.
create or replace function students.family_link(p_user uuid, p_kind text, p_id uuid, p_login_email text, p_by text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from students.accounts
   where user_id <> p_user
     and ((p_kind = 'guardian' and guardian_id = p_id) or (p_kind = 'student' and student_id = p_id) or login_email = p_login_email);
  insert into students.accounts (user_id, kind, guardian_id, student_id, login_email, created_by)
  values (p_user, p_kind, case when p_kind = 'guardian' then p_id end, case when p_kind = 'student' then p_id end, p_login_email, p_by)
  on conflict (user_id) do update
    set kind = excluded.kind, guardian_id = excluded.guardian_id, student_id = excluded.student_id, login_email = excluded.login_email;
end;
$$;

revoke all on function students.family_check(text, text, text, text), students.family_target(text, text, uuid),
  students.family_link(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function students.family_check(text, text, text, text), students.family_target(text, text, uuid),
  students.family_link(uuid, text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 3) Rules for the guardian
-- ---------------------------------------------------------------------
create table if not exists students.rules (
  id          uuid primary key default extensions.gen_random_uuid(),
  body        text not null check (btrim(body) <> ''),
  sort_order  int not null default 0,
  version     int not null default 1,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists students.rule_answers (
  guardian_id  uuid not null references students.guardians (id) on delete cascade,
  rule_id      uuid not null references students.rules (id) on delete cascade,
  version      int not null,
  agreed       boolean not null,
  comment      text,
  marked_by    text,            -- null = ولي الأمر بنفسه، غير كده = التنظيم علّم إنه وافق على الورق
  answered_at  timestamptz not null default now(),
  primary key (guardian_id, rule_id)
);
alter table students.rules enable row level security;
alter table students.rule_answers enable row level security;
grant select on students.rules, students.rule_answers to authenticated;
grant all on students.rules, students.rule_answers to service_role;
create policy rules_read on students.rules for select to authenticated using (true);
create policy rule_answers_read on students.rule_answers for select to authenticated
  using ((select app.has_perm('students.view_all')) or guardian_id = (select app.family_account()).guardian_id);

insert into students.rules (body, sort_order)
select body, n from (values
  (1, 'الحضور في ميعاد الحصة بالظبط، والتأخير بيتسجل على الطالب.'),
  (2, format('الغياب من غير عذر بيتحسب، ولما يوصل %s مرات بيتبعت تحذير لولي الأمر، ولو الغياب كمّل ممكن الطالب يتفصل من النشاط.',
             (select warn_after from students.settings limit 1))),
  (3, 'لو الطالب مش هيقدر يحضر، ولي الأمر يبلّغ التنظيم قبل الحصة عشان الغياب يتسجل بعذر.'),
  (4, 'الكارنيه لازم يكون مع الطالب في كل حصة.'),
  (5, 'الطالب يحل الواجب المطلوب منه قبل الحصة اللي بعدها.'),
  (6, 'احترام المتطوعين والزملاء والمكان. الشغب أو قلة الأدب ممكن يخلّي الطالب يطلع من الحصة، ولو اتكرر ممكن يتفصل.'),
  (7, 'المحافظة على المكان والأدوات، وأي تلفيات ولي الأمر مسئول عنها.'),
  (8, 'ممنوع الموبايل أثناء الحصة إلا بإذن المتطوع.'),
  (9, 'الطالب ميمشيش قبل آخر الحصة إلا بإذن من التنظيم أو بحضور ولي الأمر.'),
  (10, 'ولي الأمر يحضر لما التنظيم يطلبه، ويرد على تليفونات ورسايل النشاط.'),
  (11, 'بيانات الطالب وولي الأمر وأرقام التليفونات تكون صحيحة، وأي تغيير يتبلّغ للتنظيم.'),
  (12, 'النشاط مجاني بالكامل، وممنوع دفع أي فلوس أو هدايا للمتطوعين.')
) r(n, body)
where not exists (select 1 from students.rules);

create or replace function students.rules_done(p_guardian uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from students.rules where is_active)
     and not exists (
       select 1 from students.rules r
        where r.is_active
          and not exists (select 1 from students.rule_answers a
                           where a.guardian_id = p_guardian and a.rule_id = r.id and a.version = r.version and a.agreed))
$$;

-- Guardians of students in the current term (who the rules are for)
create or replace function students.current_guardians()
returns table (guardian_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct s.guardian_id
    from students.students s
    join students.enrollments e on e.student_id = s.id and e.status not in ('مفصول', 'منقطع', 'اتنقل')
    join students.terms t on t.id = e.term_id and t.is_current
   where s.guardian_id is not null
$$;

create or replace function students.save_rules(p jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  i int := 0;
  changed int := 0;
  rid uuid;
  old_body text;
  keep uuid[] := '{}';
begin
  if not app.has_perm('students.edit') then
    raise exception 'محتاج صلاحية «يضيف ويعدّل طلاب»' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(p) loop
    if btrim(coalesce(r->>'body', '')) = '' then
      continue;
    end if;
    i := i + 1;
    rid := nullif(r->>'id', '')::uuid;
    old_body := null;
    select body into old_body from students.rules where id = rid;
    if rid is null or old_body is null then
      insert into students.rules (body, sort_order) values (btrim(r->>'body'), i) returning id into rid;
      changed := changed + 1;
    else
      update students.rules
         set sort_order = i,
             is_active = true,
             version = version + case when btrim(body) <> btrim(r->>'body') then 1 else 0 end,
             updated_at = case when btrim(body) <> btrim(r->>'body') then now() else updated_at end,
             body = btrim(r->>'body')
       where id = rid;
      if btrim(old_body) <> btrim(r->>'body') then
        changed := changed + 1;
      end if;
    end if;
    keep := keep || rid;
  end loop;
  update students.rules set is_active = false where is_active and not (id = any (keep));

  if changed > 0 then
    perform app.notify(
      (select coalesce(array_agg(a.login_email), '{}') from students.accounts a where a.kind = 'guardian'),
      'قواعد النشاط اتحدّثت',
      case when changed = 1 then 'فيه قاعدة جديدة أو اتعدلت' else 'فيه ' || changed || ' قواعد جديدة أو اتعدلت' end
        || '. اقراها ووافق عليها من صفحتك',
      '/family');
  end if;
  return changed;
end;
$$;

-- The guardian agrees or comments
create or replace function students.answer_rules(p jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := (select a.guardian_id from students.accounts a where a.user_id = auth.uid() and a.kind = 'guardian');
  x jsonb;
begin
  if gid is null then
    raise exception 'ولي الأمر بس هو اللي بيوافق على القواعد' using errcode = '42501';
  end if;
  for x in select * from jsonb_array_elements(p) loop
    insert into students.rule_answers (guardian_id, rule_id, version, agreed, comment)
    select gid, r.id, r.version, coalesce((x->>'agreed')::boolean, false), nullif(btrim(coalesce(x->>'comment', '')), '')
      from students.rules r where r.id = (x->>'rule_id')::uuid and r.is_active
    on conflict (guardian_id, rule_id) do update
      set version = excluded.version, agreed = excluded.agreed, comment = excluded.comment, marked_by = null, answered_at = now();
  end loop;
  return students.rules_done(gid);
end;
$$;

-- Staff: the guardian agreed on paper (all current rules)
create or replace function students.mark_rules_paper(p_student uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := (select guardian_id from students.students where id = p_student);
begin
  if not (app.has_perm('students.edit') or app.has_perm('students.review')) then
    raise exception 'محتاج صلاحية «يضيف ويعدّل طلاب»' using errcode = '42501';
  end if;
  if gid is null then
    raise exception 'الطالب ده مالوش ولي أمر متسجل. ضيفه الأول';
  end if;
  insert into students.rule_answers (guardian_id, rule_id, version, agreed, comment, marked_by)
  select gid, r.id, r.version, true, 'وافق على الورق', app.email()::text from students.rules r where r.is_active
  on conflict (guardian_id, rule_id) do update
    set version = excluded.version, agreed = true, comment = excluded.comment, marked_by = excluded.marked_by, answered_at = now();
  return students.rules_done(gid);
end;
$$;

-- Staff: per rule, how many guardians agreed, and the comments
create or replace function students.rules_report()
returns table (rule_id uuid, agreed int, pending int, comments jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_perm('students.view_all') then
    raise exception 'محتاج صلاحية «يشوف كل الطلاب»' using errcode = '42501';
  end if;
  return query
  with people as (select c.guardian_id as id from students.current_guardians() c)
  select r.id,
         (select count(*) from students.rule_answers a join people p on p.id = a.guardian_id
           where a.rule_id = r.id and a.version = r.version and a.agreed)::int,
         ((select count(*) from people) - (select count(*) from students.rule_answers a join people p on p.id = a.guardian_id
           where a.rule_id = r.id and a.version = r.version and a.agreed))::int,
         (select coalesce(jsonb_agg(jsonb_build_object('guardian_id', a.guardian_id, 'name', g.full_name, 'comment', a.comment,
                   'agreed', a.agreed, 'old', a.version < r.version, 'at', a.answered_at,
                   'student_id', (select s.id from students.students s where s.guardian_id = g.id order by s.full_name limit 1))
                   order by a.answered_at desc), '[]')
            from students.rule_answers a join students.guardians g on g.id = a.guardian_id
           where a.rule_id = r.id and a.comment is not null and a.marked_by is null)
    from students.rules r
   where r.is_active
   order by r.sort_order;
end;
$$;

-- Whether a student's guardian agreed (for the student's page and admissions)
create or replace function students.rules_status(p_students uuid[])
returns table (student_id uuid, done boolean, on_paper boolean, has_account boolean)
language sql stable security definer set search_path = '' as $$
  select s.id,
         s.guardian_id is not null and students.rules_done(s.guardian_id),
         exists (select 1 from students.rule_answers a where a.guardian_id = s.guardian_id and a.marked_by is not null),
         exists (select 1 from students.accounts a where a.guardian_id = s.guardian_id)
    from students.students s
   where s.id = any (p_students)
     and (app.has_perm('students.view_all') or s.id = any (students.family_student_ids()))
$$;

revoke all on function students.save_rules(jsonb), students.answer_rules(jsonb), students.mark_rules_paper(uuid),
  students.rules_report(), students.rules_status(uuid[]), students.rules_done(uuid), students.current_guardians() from public, anon;
grant execute on function students.save_rules(jsonb), students.answer_rules(jsonb), students.mark_rules_paper(uuid),
  students.rules_report(), students.rules_status(uuid[]), students.rules_done(uuid), students.current_guardians() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) The family page in one call
-- ---------------------------------------------------------------------
create or replace function students.family_home()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  acc students.accounts := app.family_account();
  d date := app.today();
begin
  if acc.user_id is null then
    raise exception 'الحساب ده مش حساب ولي أمر أو طالب' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'kind', acc.kind,
    'login', split_part(acc.login_email::text, '@', 1),
    'name', case when acc.kind = 'guardian' then (select g.full_name from students.guardians g where g.id = acc.guardian_id)
                 else (select s.full_name from students.students s where s.id = acc.student_id) end,
    'guardian_id', coalesce(acc.guardian_id, (select s.guardian_id from students.students s where s.id = acc.student_id)),
    'rules_done', students.rules_done(coalesce(acc.guardian_id, (select s.guardian_id from students.students s where s.id = acc.student_id))),
    'org', (select to_jsonb(o) - 'id' - 'updated_by' from students.org_info o limit 1),
    'children', (
      select coalesce(jsonb_agg(c order by c->>'full_name'), '[]') from (
        select jsonb_build_object(
          'id', s.id,
          'full_name', s.full_name,
          'school', s.school,
          'carnet_no', s.carnet_no,
          'grade', coalesce(e.grade, ap.grade),
          'status', e.status,
          'application', ap.status,
          'counts', (select jsonb_build_object(
                        'present', count(*) filter (where m.is_present),
                        'absent', count(*) filter (where m.counts_absence),
                        'excused', count(*) filter (where a.mark = 'معتذر'),
                        'violations', count(*) filter (where m.is_violation))
                       from students.attendance a
                       join students.attendance_marks m on m.code = a.mark
                       join students.class_sessions cs on cs.id = a.session_id
                      where a.student_id = s.id and (tm.id is null or cs.on_date between tm.starts_on and tm.ends_on)),
          'recent', (select coalesce(jsonb_agg(x order by x->>'date' desc), '[]') from (
                       select jsonb_build_object('date', cs.on_date, 'subject', cs.subject, 'mark', a.mark, 'note', a.note) x
                         from students.attendance a join students.class_sessions cs on cs.id = a.session_id
                        where a.student_id = s.id
                        order by cs.on_date desc, cs.starts_at desc limit 12) q),
          'exams', (select coalesce(jsonb_agg(x order by x->>'date' desc), '[]') from (
                       select jsonb_build_object('date', cs.on_date, 'subject', cs.subject, 'score', r.score, 'max', cs.max_score) x
                         from students.exam_results r join students.class_sessions cs on cs.id = r.session_id
                        where r.student_id = s.id
                        order by cs.on_date desc limit 6) q),
          'upcoming', (select coalesce(jsonb_agg(x order by x->>'date', x->>'starts_at'), '[]') from (
                       select jsonb_build_object('date', cs.on_date, 'starts_at', cs.starts_at, 'ends_at', cs.ends_at,
                                                 'subject', cs.subject, 'kind', cs.kind, 'status', cs.status) x
                         from students.class_sessions cs
                        where cs.on_date between d and d + 7
                          and cs.status in ('متوقعة', 'اتلغت')
                          and s.id in (select students.class_student_ids(cs.slot_id, cs.id))
                        order by cs.on_date, cs.starts_at limit 20) q)
        ) c
        from students.students s
        left join students.terms tm on tm.is_current
        left join students.enrollments e on e.student_id = s.id and e.term_id = tm.id
        left join students.applications ap on ap.student_id = s.id and ap.term_id = tm.id
       where s.id = any (students.family_student_ids())
      ) z)
  );
end;
$$;
revoke all on function students.family_home() from public, anon;
grant execute on function students.family_home() to authenticated;

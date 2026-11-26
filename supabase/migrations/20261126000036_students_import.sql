-- =====================================================================
-- 36) Upload the students' Google Sheet from the site (الطلاب ← رفع شيت).
--
--  The page reads the workbook in the browser and sends one JSON; this function writes it.
--  It can run as a preview (p_apply = false: everything is done, counted, then undone) and
--  it can run again on a newer copy of the same sheet:
--    * a student is found by national ID, else by name (spelling-insensitive);
--    * empty cells never wipe what is already in the system;
--    * an application or a mark that someone changed in the site is left alone;
--    * a class is found again by grade + date + subject (+ its order that day).
--  Importing old absences notifies nobody: the attendance trigger stays quiet meanwhile,
--  and warnings are set silently at the end.
--
--  Payload:
--  { "term": {"name","starts_on","ends_on"},
--    "students": [{ "key", "name", "gender", "school", "shift", "notes", "grade", "status",
--                   "is_new", "papers", "national_id",
--                   "private": {...student_private columns...},
--                   "guardian": {"name","national_id","valid_until","job","phone"},
--                   "phones": [{"number","label","is_whatsapp"}] }],
--    "sessions": [{ "key", "grade", "date", "subject", "kind", "note",
--                   "marks": [{"student","mark"}] }] }      -- student = a student's "key"
-- =====================================================================

alter table students.class_sessions add column if not exists import_key text;
create unique index if not exists class_sessions_import_key on students.class_sessions (import_key) where import_key is not null;

-- Same name whatever the spelling: hamzas, ى/ي, ة/ه, diacritics, «عبد الله» = «عبدالله».
create or replace function students.norm_name(t text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(
           translate(regexp_replace(coalesce(t, ''), '[ًٌٍَُِّْـ]', '', 'g'), 'أإآىةؤئ', 'ااايهوي'),
           '(^|\s)(عبد|ابو)\s+', '\1\2', 'g'), '\s+', ' ', 'g'), ' $', ''))
$$;

-- Old absences come in quietly: no family notice, no warning notice, no dismissal request.
do $$
declare src text;
begin
  src := pg_get_functiondef('students.after_attendance()'::regprocedure);
  if position('students.importing' in src) = 0 then
    src := replace(src,
      E'begin\n  select * into cs from students.class_sessions where id = sid;',
      E'begin\n  if current_setting(''students.importing'', true) = ''on'' then\n    return null;\n  end if;\n  select * into cs from students.class_sessions where id = sid;');
    if position('students.importing' in src) = 0 then
      raise exception 'after_attendance changed: could not add the import guard';
    end if;
    execute src;
  end if;
end;
$$;

create or replace function students.import_sheet(p jsonb, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t jsonb := p->'term';
  term uuid;
  s jsonb; x jsonb; m jsonb;
  ids jsonb := '{}';            -- student key -> uuid
  sid uuid; gid uuid; csid uuid; slot public.schedule_slots;
  pr jsonb; nid text; d date; dayname text; n int;
  st jsonb := jsonb_build_object('students_new',0,'students_updated',0,'guardians_new',0,'phones_new',0,
    'applications_new',0,'accepted_now',0,'sessions_new',0,'sessions_linked',0,'marks_new',0,'marks_changed',0,
    'marks_kept',0,'warnings',0);
  bump text;
  inc constant text := 'استيراد شيت الطلاب';
begin
  if not (app.has_perm('students.edit') and app.has_perm('students.view_sensitive')) then
    raise exception 'رفع الشيت محتاج صلاحية «يضيف ويعدّل طلاب» و«البيانات الحساسة»';
  end if;
  if coalesce(t->>'name', '') = '' then
    raise exception 'اختار الترم';
  end if;

  begin  -- everything below is undone when this is only a preview
    perform set_config('students.importing', 'on', true);

    -- the term
    select id into term from students.terms where name = t->>'name';
    if term is null then
      insert into students.terms (name, starts_on, ends_on, is_current)
      values (t->>'name', (t->>'starts_on')::date, (t->>'ends_on')::date,
              not exists (select 1 from students.terms where is_current))
      returning id into term;
    end if;

    -- students
    for s in select * from jsonb_array_elements(coalesce(p->'students', '[]'))
    loop
      nid := nullif(s->>'national_id', '');
      sid := null;
      if nid is not null then
        select student_id into sid from students.student_private where national_id = nid;
      end if;
      if sid is null then
        select id into sid from students.students
         where students.norm_name(full_name) = students.norm_name(s->>'name')
         order by created_at limit 1;
      end if;

      -- the guardian (father), shared by brothers and sisters
      gid := null;
      x := s->'guardian';
      if x is not null and coalesce(x->>'name', '') <> '' then
        if coalesce(x->>'national_id', '') <> '' then
          select id into gid from students.guardians where national_id = x->>'national_id';
        end if;
        if gid is null and coalesce(x->>'phone', '') <> '' then
          select id into gid from students.guardians
           where phone = x->>'phone' and students.norm_name(full_name) = students.norm_name(x->>'name') limit 1;
        end if;
        if gid is null then
          insert into students.guardians (full_name, relation, national_id, id_valid_until, job, phone)
          values (x->>'name', 'أب', nullif(x->>'national_id', ''), nullif(x->>'valid_until', '')::date,
                  nullif(x->>'job', ''), nullif(x->>'phone', ''))
          returning id into gid;
          st := jsonb_set(st, '{guardians_new}', to_jsonb((st->>'guardians_new')::int + 1));
        end if;
      end if;

      if sid is null then
        insert into students.students (full_name, gender, school, school_shift, guardian_id, notes, created_by)
        values (s->>'name', nullif(s->>'gender', ''), nullif(s->>'school', ''), nullif(s->>'shift', ''), gid,
                nullif(s->>'notes', ''), inc)
        returning id into sid;
        bump := 'students_new';
      else
        update students.students set
          gender = coalesce(gender, nullif(s->>'gender', '')),
          school = coalesce(nullif(s->>'school', ''), school),
          school_shift = coalesce(nullif(s->>'shift', ''), school_shift),
          guardian_id = coalesce(guardian_id, gid)
         where id = sid;
        bump := 'students_updated';
      end if;
      st := jsonb_set(st, array[bump], to_jsonb((st->>bump)::int + 1));
      ids := ids || jsonb_build_object(s->>'key', sid);

      -- private details: fill what is empty, never wipe
      pr := coalesce(s->'private', '{}') || jsonb_strip_nulls(jsonb_build_object('national_id', nid));
      if pr <> '{}' then
        insert into students.student_private as sp (student_id, national_id, address, father_name, father_national_id,
          father_id_valid_until, father_job, mother_name, mother_national_id, mother_id_valid_until, mother_job,
          kids_under_5, kids_5_to_10, boys_over_10, girls_over_10, important_notes, updated_by)
        values (sid, nullif(pr->>'national_id', ''), nullif(pr->>'address', ''), nullif(pr->>'father_name', ''),
          nullif(pr->>'father_national_id', ''), nullif(pr->>'father_id_valid_until', '')::date, nullif(pr->>'father_job', ''),
          nullif(pr->>'mother_name', ''), nullif(pr->>'mother_national_id', ''), nullif(pr->>'mother_id_valid_until', '')::date,
          nullif(pr->>'mother_job', ''), (pr->>'kids_under_5')::int, (pr->>'kids_5_to_10')::int, (pr->>'boys_over_10')::int,
          (pr->>'girls_over_10')::int, nullif(pr->>'important_notes', ''), inc)
        on conflict (student_id) do update set
          national_id = coalesce(sp.national_id, excluded.national_id),
          address = coalesce(sp.address, excluded.address),
          father_name = coalesce(sp.father_name, excluded.father_name),
          father_national_id = coalesce(sp.father_national_id, excluded.father_national_id),
          father_id_valid_until = coalesce(sp.father_id_valid_until, excluded.father_id_valid_until),
          father_job = coalesce(sp.father_job, excluded.father_job),
          mother_name = coalesce(sp.mother_name, excluded.mother_name),
          mother_national_id = coalesce(sp.mother_national_id, excluded.mother_national_id),
          mother_id_valid_until = coalesce(sp.mother_id_valid_until, excluded.mother_id_valid_until),
          mother_job = coalesce(sp.mother_job, excluded.mother_job),
          kids_under_5 = coalesce(sp.kids_under_5, excluded.kids_under_5),
          kids_5_to_10 = coalesce(sp.kids_5_to_10, excluded.kids_5_to_10),
          boys_over_10 = coalesce(sp.boys_over_10, excluded.boys_over_10),
          girls_over_10 = coalesce(sp.girls_over_10, excluded.girls_over_10),
          important_notes = coalesce(sp.important_notes, excluded.important_notes);
      end if;

      -- phones
      n := coalesce((select max(sort_order) from students.phones where student_id = sid), 0);
      for x in select * from jsonb_array_elements(coalesce(s->'phones', '[]'))
      loop
        n := n + 1;
        insert into students.phones (student_id, number, label, is_whatsapp, sort_order)
        values (sid, x->>'number', nullif(x->>'label', ''), coalesce((x->>'is_whatsapp')::boolean, false), n)
        on conflict (student_id, number) do nothing;
        if found then st := jsonb_set(st, '{phones_new}', to_jsonb((st->>'phones_new')::int + 1)); end if;
      end loop;

      -- the application for this term (an accepted one enrolls the student by itself)
      if coalesce(s->>'grade', '') <> '' then
        if not exists (select 1 from students.applications where student_id = sid and term_id = term) then
          insert into students.applications (student_id, term_id, grade, is_new, status, papers, notes, created_by)
          values (sid, term, s->>'grade', coalesce((s->>'is_new')::boolean, true), coalesce(nullif(s->>'status', ''), 'انتظار'),
                  coalesce(nullif(s->>'papers', ''), 'ناقص'), nullif(s->>'notes', ''), inc);
          st := jsonb_set(st, '{applications_new}', to_jsonb((st->>'applications_new')::int + 1));
        elsif s->>'status' = 'مقبول' then
          update students.applications set status = 'مقبول', grade = s->>'grade'
           where student_id = sid and term_id = term and status not in ('مقبول', 'مرفوض', 'بلاك ليست');
          if found then st := jsonb_set(st, '{accepted_now}', to_jsonb((st->>'accepted_now')::int + 1)); end if;
        end if;
      end if;
    end loop;

    -- classes and attendance
    for s in select * from jsonb_array_elements(coalesce(p->'sessions', '[]'))
    loop
      d := (s->>'date')::date;
      dayname := students.weekday_ar(d);
      select id into csid from students.class_sessions where import_key = s->>'key';
      if csid is null then
        select * into slot from public.schedule_slots sl
         where replace(sl.grade, ' ', '') = replace(s->>'grade', ' ', '') and sl.day::text = dayname
           and students.norm_name(sl.subject) = any (select students.norm_name(v) from jsonb_array_elements_text(s->'subjects') v)
           and not exists (select 1 from students.class_sessions c where c.slot_id = sl.id and c.on_date = d and c.status <> 'اتلغت')
         order by sl.starts_at limit 1;
        insert into students.class_sessions (slot_id, on_date, starts_at, ends_at, subject, kind, max_score, takes_attendance, status,
                                             teacher_ids, attendance_at, attendance_by, notes, created_by, import_key)
        values (slot.id, d, coalesce(slot.starts_at, '16:00'), coalesce(slot.ends_at, '17:00'), coalesce(nullif(s->>'subject', ''), 'حصة'),
                case when s->>'kind' = 'امتحان' then 'امتحان' else 'حصة' end, case when s->>'kind' = 'امتحان' then 100 end,
                true, 'اتعملت', coalesce(array_remove(array[slot.volunteer_id] || coalesce(slot.co_teachers, '{}'), null), '{}'),
                d + coalesce(slot.ends_at, '17:00'), inc, nullif(s->>'note', ''), inc, s->>'key')
        returning id into csid;
        insert into students.audiences (session_id, target, grade) values (csid, 'grade', s->>'grade');
        st := jsonb_set(st, '{sessions_new}', to_jsonb((st->>'sessions_new')::int + 1));
        if slot.id is not null then st := jsonb_set(st, '{sessions_linked}', to_jsonb((st->>'sessions_linked')::int + 1)); end if;
        slot := null;
      end if;

      for m in select * from jsonb_array_elements(coalesce(s->'marks', '[]'))
      loop
        sid := (ids->>(m->>'student'))::uuid;
        continue when sid is null;
        if exists (select 1 from students.attendance a where a.session_id = csid and a.student_id = sid) then
          update students.attendance set mark = m->>'mark'
           where session_id = csid and student_id = sid and recorded_by = inc and mark <> m->>'mark';
          if found then bump := 'marks_changed'; else bump := 'marks_kept'; end if;
        else
          insert into students.attendance (session_id, student_id, mark, recorded_by, recorded_at)
          values (csid, sid, m->>'mark', inc, d + time '17:00');
          bump := 'marks_new';
        end if;
        st := jsonb_set(st, array[bump], to_jsonb((st->>bump)::int + 1));
      end loop;

      update students.class_sessions cs set present_count = (
        select count(*) filter (where mk.is_present) from students.attendance a
          join students.attendance_marks mk on mk.code = a.mark where a.session_id = cs.id)
       where cs.id = csid;
    end loop;

    -- weekly classes that know no grade yet take their own
    insert into students.audiences (slot_id, target, grade)
    select sl.id, 'grade', g.code from public.schedule_slots sl
      join students.grades g on replace(g.code, ' ', '') = replace(sl.grade, ' ', '')
     where not exists (select 1 from students.audiences a where a.slot_id = sl.id);

    -- warnings, quietly
    update students.enrollments e set status = 'تحذير',
           status_note = students.absences(e.student_id, term) || ' غياب (من الشيت)', status_at = now()
     where e.term_id = term and e.status = 'نشط'
       and students.absences(e.student_id, term) >= (select warn_after from students.settings);
    get diagnostics n = row_count;
    st := st || jsonb_build_object('warnings', n,
      'over_dismiss', (select count(*) from students.enrollments e where e.term_id = term
                        and students.absences(e.student_id, term) >= (select dismiss_after from students.settings)));

    perform set_config('students.importing', 'off', true);
    if not p_apply then
      raise exception using errcode = 'P0099', message = st::text;
    end if;
  exception when sqlstate 'P0099' then
    return jsonb_build_object('applied', false) || (sqlerrm)::jsonb;
  end;
  return jsonb_build_object('applied', true) || st;
end;
$$;
revoke all on function students.import_sheet(jsonb, boolean) from public, anon;
grant execute on function students.import_sheet(jsonb, boolean) to authenticated;

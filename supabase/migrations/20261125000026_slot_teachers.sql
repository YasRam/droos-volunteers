-- =====================================================================
-- 26) More than one teacher for a class
--   co_teachers   = the other volunteers on the class (volunteer_id stays the first)
--   teaching_mode = «مع بعض»: they teach it together every time
--                   «بالتبادل»: they take turns, one per week, in the order listed
-- =====================================================================
alter table public.schedule_slots
  add column if not exists co_teachers uuid[] not null default '{}',
  add column if not exists teaching_mode text not null default 'مع بعض';
alter table public.schedule_slots drop constraint if exists schedule_slots_teaching_mode_check;
alter table public.schedule_slots add constraint schedule_slots_teaching_mode_check check (teaching_mode in ('مع بعض', 'بالتبادل'));

-- Who teaches this class in a given week (for «بالتبادل»: weeks count from Saturday 3 Jan 2026)
create or replace function app.slot_teacher_on(s public.schedule_slots, d date)
returns uuid[] language sql immutable set search_path = '' as $$
  select case
    when s.teaching_mode = 'بالتبادل' and s.volunteer_id is not null and cardinality(s.co_teachers) > 0 then
      array[(array[s.volunteer_id] || s.co_teachers)[1 + ((d - date '2026-01-03') / 7) % (1 + cardinality(s.co_teachers))]]
    else array_remove(array[s.volunteer_id] || s.co_teachers, null)
  end
$$;

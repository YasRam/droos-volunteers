-- =====================================================================
-- Nobody types a job anymore: everyone is «متطوع», and the job comes from the structure.
--   ليدر / نائب ليدر النشاط  → volunteers.position (set from الصلاحيات ← قيادة النشاط)
--   ليدر / نائب ليدر لجنة X  → committee_leaders
--   HR / تنظيم                → their committee and their permissions, not a job
-- =====================================================================

update public.volunteers
   set position = 'متطوع'
 where position not in ('متطوع', 'ليدر النشاط', 'نائب ليدر النشاط');

alter table public.volunteers drop constraint if exists volunteers_position_check;
alter table public.volunteers add constraint volunteers_position_check
  check (position in ('متطوع', 'نائب ليدر النشاط', 'ليدر النشاط'));

comment on column public.volunteers.position is
  'ليدر النشاط / نائب ليدر النشاط بس. باقي الوظايف بتيجي من committee_leaders (ليدر أو نائب لجنة).';

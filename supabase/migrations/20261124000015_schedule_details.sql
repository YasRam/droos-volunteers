-- =====================================================================
-- 15) Class details: where, what kind, for whom, and whether attendance is taken
-- =====================================================================
alter table public.schedule_slots
  add column if not exists place            text,                                    -- مكان الحصة (قاعة 1، الدور التاني، أونلاين...)
  add column if not exists kind             text not null default 'حصة'
                             check (kind in ('حصة', 'تأسيس', 'ورشة ثابتة')),
  add column if not exists audience         text not null default 'الكل'
                             check (audience in ('الكل', 'بنات بس', 'ولاد بس')),
  add column if not exists takes_attendance boolean not null default true,            -- بيتاخد عليها غياب
  add column if not exists notes            text;

-- The imported behaviour/skills workshops are fixed weekly workshops
update public.schedule_slots set kind = 'ورشة ثابتة' where subject like 'ورشة%' and kind = 'حصة';
update public.schedule_slots set kind = 'تأسيس' where subject like '%تأسيس%' and kind = 'حصة';

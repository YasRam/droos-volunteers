import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AbsenceModal, useUpcomingAbsences } from '@/components/ClassAbsence'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { VolunteerChips } from '@/components/VolunteerPick'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtDate, fmtTime, timeInput, useDirectory, useLookups, withCurrent } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { WEEKDAYS, type ScheduleSlot, type Weekday } from '@/lib/types'
import { sdb, useCurrentTerm, useGrades, useGroups, type Audience } from '@/lib/students'
import { AudienceEditor, useAudiences } from '@/pages/students/Classes'

type AudienceRow = Omit<Audience, 'id' | 'slot_id' | 'session_id'>

const KINDS = ['حصة', 'تأسيس', 'ورشة ثابتة']

type View = 'day' | 'grade' | 'teacher' | 'coverage'

export default function Schedule({ embedded = false }: { embedded?: boolean }) {
  const p = usePermissions()
  const directory = useDirectory()
  const dirName = useCallback((id: string) => directory.data?.find((v) => v.id === id)?.full_name_ar ?? '…', [directory.data])
  const lookups = useLookups()
  const [view, setView] = useState<View>('day')
  const [day, setDay] = useState('')
  const [grade, setGrade] = useState('')
  const [teacher, setTeacher] = useState('')
  const [kind, setKind] = useState('')
  const [editing, setEditing] = useState<ScheduleSlot | 'new' | null>(null)
  const [params, setParams] = useSearchParams()
  const [excuse, setExcuse] = useState<{ slot: ScheduleSlot; date?: string } | null>(null)
  const absences = useUpcomingAbsences()

  const q = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_slots').select('*').order('starts_at')
      if (error) throw error
      return (data as ScheduleSlot[]).sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.starts_at.localeCompare(b.starts_at))
    },
  })
  // opened from the night-before reminder: /schedule?absence=<slot>&date=<day>
  useEffect(() => {
    const id = params.get('absence')
    const slot = id ? q.data?.find((s) => s.id === id) : undefined
    if (slot) {
      setExcuse({ slot, date: params.get('date') ?? undefined })
      setParams({}, { replace: true })
    }
  }, [params, q.data, setParams])

  const rows = (q.data ?? []).filter(
    (s) =>
      (!day || s.day === day) && (!grade || s.grade === grade) && (!kind || (s.kind ?? 'حصة') === kind) && (!teacher || (s.teacher_name ?? '').includes(teacher)),
  )
  const groups = useMemo(() => {
    const keys = (s: ScheduleSlot): string[] =>
      view === 'day'
        ? [s.day]
        : view === 'grade'
          ? [s.grade]
          : slotTeachers(s).length > 1
            ? slotTeachers(s).map((id) => dirName(id))
            : [s.teacher_name || 'من غير مدرس']
    const m = new Map<string, ScheduleSlot[]>()
    for (const s of rows) for (const k of keys(s)) m.set(k, [...(m.get(k) ?? []), s])
    const entries = [...m.entries()]
    if (view === 'day') entries.sort((a, b) => WEEKDAYS.indexOf(a[0] as Weekday) - WEEKDAYS.indexOf(b[0] as Weekday))
    else entries.sort((a, b) => a[0].localeCompare(b[0], 'ar'))
    return entries
  }, [rows, view, dirName])

  const mine = (s: ScheduleSlot) => Boolean(p.volunteerId && slotTeachers(s).includes(p.volunteerId))

  return (
    <>
      {embedded ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm text-muted">{q.data ? `${q.data.length} حصة في الأسبوع. كل حصة هنا بتعمل حصة كل أسبوع في «النهارده» للمدرسين والطلاب.` : ''}</p>
          {p.canEditSchedule && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> حصة جديدة
            </Button>
          )}
        </div>
      ) : (
        <PageHeader
          title="جدول الحصص"
          subtitle={q.data ? `${q.data.length} حصة في الأسبوع` : undefined}
          actions={
            p.canEditSchedule && (
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" /> حصة جديدة
              </Button>
            )
          }
        />
      )}
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: 'day', label: 'حسب اليوم' },
          { value: 'grade', label: 'حسب السنة' },
          { value: 'teacher', label: 'حسب المتطوع' },
          { value: 'coverage', label: 'التغطية والتداخل' },
        ]}
      />
      {view === 'coverage' ? (
        q.data ? <Coverage slots={q.data} grades={(lookups.data?.list('السنة الدراسية') ?? []).filter((g) => /[بع]$/.test(g.trim()))} /> : <Spinner />
      ) : (
      <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={day} onChange={(e) => setDay(e.target.value)} placeholder="كل الأيام" options={WEEKDAYS} />
        <Select value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="كل السنين" options={lookups.data?.list('السنة الدراسية') ?? []} />
        <Input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="اسم المتطوع" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} placeholder="كل الأنواع" options={lookups.data?.list('نوع الحصة').length ? lookups.data.list('نوع الحصة') : KINDS} />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !groups.length ? (
        <Empty title="مفيش حصص" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map(([title, slots]) => (
            <Card key={title} className="p-0">
              <p className="border-b border-line px-4 py-2 font-bold text-brand-800">{title}</p>
              <div className="divide-y divide-line">
                {slots.map((s) => (
                  <div key={s.id} className={clsx('flex items-center gap-3 px-4 py-2.5', mine(s) && 'bg-brand-50')}>
                    <span className="w-28 shrink-0 text-xs font-semibold text-muted">
                      {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={clsx('truncate text-sm font-semibold', mine(s) && 'text-brand-800')}>
                        {s.subject} · {view === 'grade' ? s.day : s.grade}
                      </p>
                      <p className={clsx('truncate text-xs', s.teacher_name ? 'text-muted' : 'italic text-gray-400')}>
                        {view === 'teacher' ? (
                          s.day
                        ) : slotTeachers(s).length > 1 ? (
                          <>
                            {slotTeachers(s).map((id, i) => (
                              <span key={id}>
                                {i > 0 && ' + '}
                                <VolunteerName id={id} name={dirName(id)} />
                              </span>
                            ))}
                            {' '}({s.teaching_mode === 'بالتبادل' ? `بالتبادل، الأسبوع ده: ${dirName(turnThisWeek(s) ?? '')}` : 'مع بعض'})
                          </>
                        ) : s.volunteer_id ? (
                          <VolunteerName id={s.volunteer_id} name={s.teacher_name} />
                        ) : (
                          s.teacher_name || 'من غير مدرس'
                        )}
                        {mine(s) && ' · حصتك'}
                      </p>
                      <SlotTags s={s} />
                      {(absences.data ?? [])
                        .filter((a) => a.slot_id === s.id)
                        .map((a) => (
                          <Badge key={a.id} tone={a.status === 'approved' ? 'red' : 'orange'}>
                            {dirName(a.volunteer_id)} {a.status === 'approved' ? 'معتذر' : 'طالب يعتذر'} {fmtDate(a.on_date)}
                          </Badge>
                        ))}
                    </div>
                    {mine(s) && (
                      <Button size="sm" variant="ghost" onClick={() => setExcuse({ slot: s })}>
                        اعتذار
                      </Button>
                    )}
                    {p.canEditSchedule && (
                      <button onClick={() => setEditing(s)} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="تعديل">
                        <Pencil className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      </>
      )}
      {excuse && <AbsenceModal slot={excuse.slot} date={excuse.date} onClose={() => setExcuse(null)} />}
      {editing && <SlotForm slot={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SlotForm({ slot, onClose }: { slot: ScheduleSlot | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const dir = useDirectory()
  const perms = usePermissions()
  const canAudience = perms.can('students.edit')
  const grades = useGrades()
  const term = useCurrentTerm()
  const groups = useGroups(term.data?.id)
  const audiences = useAudiences()
  const extra = slot as (ScheduleSlot & { starts_on?: string | null; ends_on?: string | null; status?: string }) | null
  const [f, setF] = useState({
    subject: slot?.subject ?? '',
    kind: slot?.kind ?? 'حصة',
    takes_attendance: slot?.takes_attendance ?? true,
    day: (slot?.day ?? 'السبت') as Weekday,
    starts_at: slot ? timeInput(slot.starts_at) : '15:00',
    ends_at: slot ? timeInput(slot.ends_at) : '16:00',
    place: slot?.place ?? '',
    starts_on: extra?.starts_on ?? '',
    ends_on: extra?.ends_on ?? '',
    status: extra?.status ?? 'شغالة',
    outside: Boolean(slot && !slot.volunteer_id && slot.teacher_name),
    volunteer_id: slot?.volunteer_id ?? '',
    teacher_name: slot?.volunteer_id ? '' : (slot?.teacher_name ?? ''),
    teaching_mode: slot?.teaching_mode ?? 'مع بعض',
    notes: slot?.notes ?? '',
    grade: slot?.grade ?? '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const [coTeachers, setCoTeachers] = useState<string[]>(slot?.co_teachers ?? [])
  const current: AudienceRow[] = (audiences.data ?? [])
    .filter((x) => slot && x.slot_id === slot.id)
    .map(({ target, grade, group_id, student_id }) => ({ target, grade, group_id, student_id }))
  const [rows, setRows] = useState<AudienceRow[] | null>(null)
  const aud = rows ?? current

  // The label shown everywhere for "who is it for": one grade, one group, or a summary
  const audienceLabel = (list: AudienceRow[]) => {
    if (!list.length) return f.grade
    const gs = [...new Set(list.filter((x) => x.target === 'grade').map((x) => x.grade!))]
    const gr = list.filter((x) => x.target === 'group').map((x) => groups.data?.find((g) => g.id === x.group_id)?.name ?? 'مجموعة')
    if (list.some((x) => x.target === 'all')) return 'كل الطلاب'
    const parts = [...gs, ...gr]
    return parts.length ? parts.join(' + ') : 'طلاب بالاسم'
  }

  // Clashes with other weekly classes (same day and overlapping time)
  const all = qc.getQueryData<ScheduleSlot[]>(['schedule']) ?? []
  const clashes = useMemo(() => {
    const overlap = (x: ScheduleSlot) =>
      x.id !== slot?.id && x.day === f.day && (x as { status?: string }).status !== 'اتلغت' && timeInput(x.starts_at) < f.ends_at && timeInput(x.ends_at) > f.starts_at
    const out: string[] = []
    const people = [f.volunteer_id, ...coTeachers].filter(Boolean)
    for (const x of all.filter(overlap)) {
      const theirs = [x.volunteer_id, ...(x.co_teachers ?? [])]
      const who = people.filter((id) => theirs.includes(id)).map((id) => dir.data?.find((v) => v.id === id)?.full_name_ar ?? 'متطوع')
      if (who.length) out.push(`${who.join('، ')} عنده «${x.subject} · ${x.grade}» في نفس الوقت (${fmtTime(x.starts_at)})`)
      if (f.place.trim() && x.place && x.place.trim() === f.place.trim()) out.push(`المكان «${x.place}» محجوز لـ«${x.subject} · ${x.grade}» في نفس الوقت`)
    }
    return out
  }, [all, f.day, f.starts_at, f.ends_at, f.place, f.volunteer_id, coTeachers, dir.data, slot?.id])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['schedule'] })
    qc.invalidateQueries({ queryKey: ['students'] })
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!f.subject.trim()) throw { message: 'اكتب المادة' }
      if (f.ends_at <= f.starts_at) throw { message: 'وقت النهاية لازم يكون بعد البداية' }
      if (canAudience && !aud.length) throw { message: 'اختار الحصة لمين (سنة أو مجموعة أو طلاب)' }
      if (!canAudience && !f.grade) throw { message: 'اختار السنة الدراسية' }
      if (f.outside && !f.teacher_name.trim()) throw { message: 'اكتب اسم المدرس' }
      if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw { message: 'تاريخ النهاية قبل البداية' }
      if (clashes.length && !confirm(`فيه تعارض:\n${clashes.join('\n')}\n\nتحفظ برضه؟`)) throw { message: 'اتلغى الحفظ' }
      const volunteer = f.outside ? null : f.volunteer_id || null
      const co = volunteer ? coTeachers.filter((id) => id !== volunteer) : []
      const payload = {
        subject: f.subject.trim(),
        kind: f.kind,
        takes_attendance: f.takes_attendance,
        day: f.day,
        starts_at: f.starts_at,
        ends_at: f.ends_at,
        place: f.place.trim() || null,
        starts_on: f.starts_on || null,
        ends_on: f.ends_on || null,
        status: slot ? f.status : 'شغالة',
        volunteer_id: volunteer,
        teacher_name: f.outside ? f.teacher_name.trim() : volunteer ? (dir.data?.find((v) => v.id === volunteer)?.full_name_ar ?? null) : null,
        co_teachers: co,
        teaching_mode: co.length ? f.teaching_mode : 'مع بعض',
        notes: f.notes.trim() || null,
        grade: canAudience ? audienceLabel(aud) : f.grade,
      }
      const res = slot
        ? await supabase.from('schedule_slots').update(payload).eq('id', slot.id).select('id').single()
        : await supabase.from('schedule_slots').insert(payload).select('id').single()
      if (res.error) throw res.error
      const id = (res.data as { id: string }).id
      if (canAudience && rows) {
        const del = await sdb().from('audiences').delete().eq('slot_id', id)
        if (del.error) throw del.error
        if (rows.length) {
          const ins = await sdb().from('audiences').insert(rows.map((r) => ({ ...r, slot_id: id })))
          if (ins.error) throw ins.error
        }
      }
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      invalidate()
      onClose()
    },
    onError: (e: { message?: string }) => (e?.message === 'اتلغى الحفظ' ? undefined : toastError(e)),
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('schedule_slots').delete().eq('id', slot!.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الحصة اتمسحت')
      invalidate()
      onClose()
    },
    onError: toastError,
  })
  const subjects = [...new Set(lookups.data?.list('نوع الحدث', 'تدريس') ?? [])]
  const places = [...new Set(all.map((x) => x.place).filter((x): x is string => Boolean(x)))]
  const kinds = withCurrent(lookups.data?.list('نوع الحصة').length ? lookups.data.list('نوع الحصة') : KINDS, slot?.kind)
  const section = 'space-y-3 rounded-2xl bg-surface p-3'
  return (
    <Modal open onClose={onClose} title={slot ? 'تعديل حصة' : 'حصة جديدة'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className={section}>
          <p className="text-sm font-bold">الحصة</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="المادة">
              <Input value={f.subject} onChange={(e) => set('subject', e.target.value)} list="subjects" />
              <datalist id="subjects">{subjects.map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="النوع" hint="الامتحان بيتحدد من يوم الحصة نفسه">
              <Select value={f.kind} onChange={(e) => set('kind', e.target.value)} options={kinds} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-700" checked={f.takes_attendance} onChange={(e) => set('takes_attendance', e.target.checked)} />
            بيتاخد عليها غياب
          </label>
        </div>

        <div className={section}>
          <p className="text-sm font-bold">لمين</p>
          {canAudience ? (
            <AudienceEditor value={aud} onChange={setRows} />
          ) : (
            <Field label="السنة الدراسية">
              <Select value={f.grade} onChange={(e) => set('grade', e.target.value)} placeholder="اختار..." options={withCurrent(grades.data ?? [], slot?.grade)} />
            </Field>
          )}
          <p className="text-xs text-muted">الطلاب دول هم اللي بيظهروا في الغياب، وبيوصلهم إشعار لو الحصة اتلغت أو اتأجلت.</p>
        </div>

        <div className={section}>
          <p className="text-sm font-bold">الميعاد والمكان</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="اليوم">
              <Select value={f.day} onChange={(e) => set('day', e.target.value as Weekday)} options={WEEKDAYS} />
            </Field>
            <Field label="من">
              <Input type="time" value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
            </Field>
            <Field label="إلى">
              <Input type="time" value={f.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
            </Field>
          </div>
          <Field label="المكان">
            <Input value={f.place} onChange={(e) => set('place', e.target.value)} list="places" placeholder="مثلاً: قاعة 1" />
            <datalist id="places">{places.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="بتبدأ من" hint="فاضي = من النهارده">
              <Input type="date" value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} />
            </Field>
            <Field label="بتخلص" hint="فاضي = مستمرة">
              <Input type="date" value={f.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
            </Field>
          </div>
          {slot && (
            <Field label="الحالة" hint="متوقفة أو اتلغت: الحصص الجاية بتختفي من «النهارده»">
              <Select value={f.status} onChange={(e) => set('status', e.target.value)} options={['شغالة', 'متوقفة', 'اتلغت']} />
            </Field>
          )}
        </div>

        <div className={section}>
          <p className="text-sm font-bold">مين بيدّيها</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              [false, 'متطوع من النشاط'],
              [true, 'مدرس من بره'],
            ].map(([v, label]) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => set('outside', v as boolean)}
                className={clsx('rounded-xl px-3 py-2 text-sm font-semibold ring-1', f.outside === v ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'bg-white text-muted ring-line')}
              >
                {label as string}
              </button>
            ))}
          </div>
          {f.outside ? (
            <Field label="اسم المدرس">
              <Input value={f.teacher_name} onChange={(e) => set('teacher_name', e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="المتطوع" hint="فاضي = الحصة محتاجة مدرس">
                <Select value={f.volunteer_id} onChange={(e) => set('volunteer_id', e.target.value)} placeholder="— لسه —" options={(dir.data ?? []).map((v) => ({ value: v.id, label: v.full_name_ar }))} />
              </Field>
              {f.volunteer_id && (
                <Field label="متطوعين تانيين معاه" hint="سيبها فاضية لو مدرس واحد">
                  <VolunteerChips value={coTeachers} onChange={setCoTeachers} />
                </Field>
              )}
              {f.volunteer_id && coTeachers.filter((x) => x !== f.volunteer_id).length > 0 && (
                <Field label="بيشتغلوا إزاي؟">
                  <Select
                    value={f.teaching_mode}
                    onChange={(e) => set('teaching_mode', e.target.value as typeof f.teaching_mode)}
                    options={[
                      { value: 'مع بعض', label: 'مع بعض: كلهم في الحصة كل مرة' },
                      { value: 'بالتبادل', label: 'بالتبادل: كل أسبوع واحد بالترتيب' },
                    ]}
                  />
                </Field>
              )}
            </>
          )}
        </div>

        <Field label="ملاحظات (اختياري)">
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {clashes.length > 0 && (
          <div className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800">
            <p className="font-bold">تعارض في المواعيد</p>
            <ul className="list-disc ps-5">{clashes.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" loading={save.isPending}>
            حفظ
          </Button>
          {slot && (
            <Button type="button" variant="secondary" className="text-red-600" loading={remove.isPending} onClick={() => confirm('مسح الحصة دي؟') && remove.mutate()}>
              مسح
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

function SlotTags({ s }: { s: ScheduleSlot }) {
  const tags = [
    s.kind && s.kind !== 'حصة' ? s.kind : null,
    s.audience && s.audience !== 'الكل' ? s.audience : null,
    s.place,
    s.takes_attendance === false ? 'من غير غياب' : null,
  ].filter(Boolean)
  if (!tags.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} tone={t === 'بنات بس' ? 'purple' : t === 'ولاد بس' ? 'blue' : t === 'من غير غياب' ? 'orange' : 'gray'}>
          {t}
        </Badge>
      ))}
    </div>
  )
}

/** Everyone on the class: the main volunteer first, then the others. */
export const slotTeachers = (s: ScheduleSlot) => [s.volunteer_id, ...(s.co_teachers ?? [])].filter((x): x is string => Boolean(x))

/** «بالتبادل»: one teacher a week, in order, counting weeks from Saturday 3 Jan 2026 (same as the server). */
export function turnThisWeek(s: ScheduleSlot, day = new Date()) {
  const all = slotTeachers(s)
  if (s.teaching_mode !== 'بالتبادل' || all.length < 2) return null
  const weeks = Math.floor((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - Date.UTC(2026, 0, 3)) / (7 * 864e5))
  return all.at(((weeks % all.length) + all.length) % all.length) ?? null
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** One physical session: the same teacher, subject, place and time can serve several grades. */
function sessionsOf(slots: ScheduleSlot[]) {
  const m = new Map<string, ScheduleSlot[]>()
  for (const s of slots) {
    const k = [s.day, s.starts_at, s.ends_at, s.subject, s.teacher_name ?? '', s.place ?? ''].join('|')
    m.set(k, [...(m.get(k) ?? []), s])
  }
  return [...m.values()].map((g) => ({ ...g[0], grades: g.map((x) => x.grade) }))
}
type Session = ReturnType<typeof sessionsOf>[number]

/** Grade × subject coverage, and how many sessions run at the same time. */
function Coverage({ slots, grades }: { slots: ScheduleSlot[]; grades: string[] }) {
  const teaching = slots.filter((s) => (s.kind ?? 'حصة') !== 'ورشة ثابتة')
  const subjects = [...new Set(teaching.map((s) => s.subject))].sort((a, b) => a.localeCompare(b, 'ar'))
  const allGrades = [...new Set([...grades, ...slots.map((s) => s.grade)])]
  const count = (g: string, sub?: string) => teaching.filter((s) => s.grade === g && (!sub || s.subject === sub)).length
  const hours = (g: string) => slots.filter((s) => s.grade === g).reduce((n, s) => n + (mins(s.ends_at) - mins(s.starts_at)) / 60, 0)
  const uncovered = allGrades.filter((g) => !slots.some((s) => s.grade === g))
  const sessions = sessionsOf(slots)

  // Peak overlap per day (sweep over start/end times)
  const peaks = WEEKDAYS.map((d) => {
    const ss = sessions.filter((s) => s.day === d)
    const points = ss.flatMap((s) => [{ t: mins(s.starts_at), d: 1 }, { t: mins(s.ends_at), d: -1 }]).sort((a, b) => a.t - b.t || a.d - b.d)
    let cur = 0
    let best = 0
    let at = 0
    for (const p of points) {
      cur += p.d
      if (cur > best) {
        best = cur
        at = p.t
      }
    }
    const during = ss.filter((s) => mins(s.starts_at) <= at && mins(s.ends_at) > at)
    return { day: d, total: ss.length, best, at, during }
  })
  const overlap = (a: Session, b: Session) => a.day === b.day && mins(a.starts_at) < mins(b.ends_at) && mins(b.starts_at) < mins(a.ends_at)
  const clashes: { kind: string; a: Session; b: Session }[] = []
  sessions.forEach((a, i) =>
    sessions.slice(i + 1).forEach((b) => {
      if (!overlap(a, b)) return
      if (a.place && a.place === b.place) clashes.push({ kind: `نفس المكان (${a.place})`, a, b })
      else if (a.teacher_name && a.teacher_name === b.teacher_name) clashes.push({ kind: `نفس المدرس (${a.teacher_name})`, a, b })
    }),
  )
  const hh = (m: number) => fmtTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-2xl font-bold">{sessions.length}</p>
          <p className="text-xs text-muted">حصة وورشة في الأسبوع</p>
        </Card>
        <Card>
          <p className="text-2xl font-bold">{Math.max(0, ...peaks.map((p) => p.best))}</p>
          <p className="text-xs text-muted">أكتر عدد حصص في نفس الوقت</p>
        </Card>
        <Card>
          <p className={clsx('text-2xl font-bold', uncovered.length && 'text-red-600')}>{uncovered.length}</p>
          <p className="text-xs text-muted">سنين مالهاش ولا حصة</p>
        </Card>
        <Card>
          <p className={clsx('text-2xl font-bold', clashes.length && 'text-orange-600')}>{clashes.length}</p>
          <p className="text-xs text-muted">تعارض (نفس المكان أو المدرس)</p>
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <p className="border-b border-line px-4 py-2 font-bold">عدد الحصص في الأسبوع لكل سنة ومادة</p>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-xs">
            <tr>
              <th className="px-3 py-2 text-start">السنة</th>
              {subjects.map((s) => (
                <th key={s} className="px-2 py-2">
                  {s}
                </th>
              ))}
              <th className="px-2 py-2">الإجمالي</th>
              <th className="px-2 py-2">ساعات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {allGrades.map((g) => (
              <tr key={g} className={clsx(!count(g) && 'bg-red-50')}>
                <td className="px-3 py-1.5 font-semibold">{g}</td>
                {subjects.map((s) => {
                  const n = count(g, s)
                  return (
                    <td key={s} className={clsx('px-2 py-1.5 text-center', n ? 'font-semibold text-emerald-700' : 'text-gray-300')}>
                      {n || '—'}
                    </td>
                  )
                })}
                <td className={clsx('px-2 py-1.5 text-center font-bold', !count(g) && 'text-red-600')}>{count(g) || 'مفيش'}</td>
                <td className="px-2 py-1.5 text-center text-muted">{hours(g) ? hours(g).toFixed(1) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">الورش الثابتة مش محسوبة هنا، بس محسوبة في الساعات. الخانة الفاضية = مادة بتتدرس لسنين تانية ومش للسنة دي.</p>
      </Card>

      <Card className="p-0">
        <p className="border-b border-line px-4 py-2 font-bold">الحصص اللي شغالة في نفس الوقت</p>
        <div className="divide-y divide-line">
          {peaks
            .filter((p) => p.total)
            .map((p) => (
              <div key={p.day} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="w-20 font-semibold">{p.day}</span>
                <span className="text-muted">{p.total} حصة</span>
                <Badge tone={p.best >= 4 ? 'orange' : 'brand'}>
                  أقصى {p.best} في نفس الوقت · {hh(p.at)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{p.during.map((s) => `${s.subject} (${s.grades.join('، ')})`).join(' · ')}</span>
              </div>
            ))}
        </div>
      </Card>

      {clashes.length > 0 && (
        <Card className="p-0">
          <p className="border-b border-line px-4 py-2 font-bold text-orange-700">تعارضات</p>
          <div className="divide-y divide-line text-sm">
            {clashes.map((c, i) => (
              <div key={i} className="px-4 py-2">
                <span className="font-semibold">{c.a.day}</span> · {c.kind}: {c.a.subject} {hh(mins(c.a.starts_at))} و{c.b.subject} {hh(mins(c.b.starts_at))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

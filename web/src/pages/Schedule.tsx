import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtTime, timeInput, useDirectory, useLookups } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { WEEKDAYS, type ScheduleSlot, type Weekday } from '@/lib/types'

const KINDS = ['حصة', 'تأسيس', 'ورشة ثابتة']
const AUDIENCES = ['الكل', 'بنات بس', 'ولاد بس']

type View = 'day' | 'grade' | 'teacher' | 'coverage'

export default function Schedule() {
  const p = usePermissions()
  const lookups = useLookups()
  const [view, setView] = useState<View>('day')
  const [day, setDay] = useState('')
  const [grade, setGrade] = useState('')
  const [teacher, setTeacher] = useState('')
  const [kind, setKind] = useState('')
  const [editing, setEditing] = useState<ScheduleSlot | 'new' | null>(null)

  const q = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_slots').select('*').order('starts_at')
      if (error) throw error
      return (data as ScheduleSlot[]).sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.starts_at.localeCompare(b.starts_at))
    },
  })

  const rows = (q.data ?? []).filter(
    (s) =>
      (!day || s.day === day) && (!grade || s.grade === grade) && (!kind || (s.kind ?? 'حصة') === kind) && (!teacher || (s.teacher_name ?? '').includes(teacher)),
  )
  const groups = useMemo(() => {
    const key = (s: ScheduleSlot) => (view === 'day' ? s.day : view === 'grade' ? s.grade : s.teacher_name || 'من غير مدرس')
    const m = new Map<string, ScheduleSlot[]>()
    for (const s of rows) m.set(key(s), [...(m.get(key(s)) ?? []), s])
    const entries = [...m.entries()]
    if (view === 'day') entries.sort((a, b) => WEEKDAYS.indexOf(a[0] as Weekday) - WEEKDAYS.indexOf(b[0] as Weekday))
    else entries.sort((a, b) => a[0].localeCompare(b[0], 'ar'))
    return entries
  }, [rows, view])

  const mine = (s: ScheduleSlot) => Boolean(p.volunteerId && s.volunteer_id === p.volunteerId)

  return (
    <>
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
        <Select value={kind} onChange={(e) => setKind(e.target.value)} placeholder="كل الأنواع" options={KINDS} />
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
                        {view === 'teacher' ? s.day : s.volunteer_id ? <VolunteerName id={s.volunteer_id} name={s.teacher_name} /> : s.teacher_name || 'من غير مدرس'}
                        {mine(s) && ' · حصتك'}
                      </p>
                      <SlotTags s={s} />
                    </div>
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
      {editing && <SlotForm slot={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SlotForm({ slot, onClose }: { slot: ScheduleSlot | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const dir = useDirectory()
  const form = useForm({
    defaultValues: {
      day: slot?.day ?? 'السبت',
      grade: slot?.grade ?? '',
      subject: slot?.subject ?? '',
      volunteer_id: slot?.volunteer_id ?? '',
      teacher_name: slot?.teacher_name ?? '',
      starts_at: slot ? timeInput(slot.starts_at) : '15:00',
      ends_at: slot ? timeInput(slot.ends_at) : '16:00',
      place: slot?.place ?? '',
      kind: slot?.kind ?? 'حصة',
      audience: slot?.audience ?? 'الكل',
      takes_attendance: slot?.takes_attendance ?? true,
      notes: slot?.notes ?? '',
    },
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedule'] })
  const save = useMutation({
    mutationFn: async (f: Parameters<Parameters<typeof form.handleSubmit>[0]>[0]) => {
      if (!f.grade || !f.subject) throw { message: 'اختار السنة والمادة' }
      if (f.ends_at <= f.starts_at) throw { message: 'وقت النهاية لازم يكون بعد البداية' }
      const teacher = f.volunteer_id ? dir.data?.find((v) => v.id === f.volunteer_id)?.full_name_ar : f.teacher_name
      const payload = { ...f, volunteer_id: f.volunteer_id || null, teacher_name: teacher || null, place: f.place.trim() || null, notes: f.notes.trim() || null }
      const { error } = slot ? await supabase.from('schedule_slots').update(payload).eq('id', slot.id) : await supabase.from('schedule_slots').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      invalidate()
      onClose()
    },
    onError: toastError,
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
  const all = qc.getQueryData<ScheduleSlot[]>(['schedule']) ?? []
  const places = [...new Set(all.map((x) => x.place).filter((x): x is string => Boolean(x)))]
  return (
    <Modal open onClose={onClose} title={slot ? 'تعديل حصة' : 'حصة جديدة'}>
      <form onSubmit={form.handleSubmit((f) => save.mutate(f))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="اليوم">
          <Select {...form.register('day')} options={WEEKDAYS} />
        </Field>
        <Field label="السنة الدراسية">
          <Select {...form.register('grade')} placeholder="اختار..." options={lookups.data?.list('السنة الدراسية') ?? []} />
        </Field>
        <Field label="المادة">
          <Input {...form.register('subject')} list="subjects" />
          <datalist id="subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="المتطوع">
          <Select {...form.register('volunteer_id')} placeholder="— مش متطوع —" options={(dir.data ?? []).map((v) => ({ value: v.id, label: v.full_name_ar }))} />
        </Field>
        {!form.watch('volunteer_id') && (
          <div className="sm:col-span-2">
            <Field label="اسم المدرس" hint="لو المدرس مش متطوع في النشاط">
              <Input {...form.register('teacher_name')} />
            </Field>
          </div>
        )}
        <Field label="من">
          <Input type="time" {...form.register('starts_at')} />
        </Field>
        <Field label="إلى">
          <Input type="time" {...form.register('ends_at')} />
        </Field>
        <Field label="مكان الحصة">
          <Input {...form.register('place')} list="places" placeholder="مثلاً: قاعة 1" />
          <datalist id="places">{places.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="النوع">
          <Select {...form.register('kind')} options={KINDS} />
        </Field>
        <Field label="لمين">
          <Select {...form.register('audience')} options={AUDIENCES} />
        </Field>
        <Field label="الغياب">
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-700" {...form.register('takes_attendance')} />
            بيتاخد عليها غياب
          </label>
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات (اختياري)">
            <Input {...form.register('notes')} />
          </Field>
        </div>
        <div className="flex gap-2 sm:col-span-2">
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

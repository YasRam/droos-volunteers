import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarClock, ClipboardCheck, Megaphone, Plus, UserRoundCog, Users } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { AbsenceModal } from '@/components/ClassAbsence'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui'
import { VolunteerSelect } from '@/components/VolunteerPick'
import { usePermissions } from '@/lib/auth'
import { addDays, cairoToday, fmtDate, fmtShort, fmtTime, timeInput, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { sdb, useCurrentTerm, useGrades, useGroups, useMarks, useStudents, type Audience, type ClassSession, type RosterRow } from '@/lib/students'
import { type ScheduleSlot } from '@/lib/types'
import { useStudentAccess } from './Students'

type Slot = ScheduleSlot & { starts_on: string | null; ends_on: string | null; status: string }
type Tab = 'day' | 'weekly'

export function useSlots() {
  return useQuery({
    queryKey: ['students', 'slots'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_slots').select('*').order('day').order('starts_at')
      if (error) throw error
      return data as Slot[]
    },
  })
}

export function useAudiences() {
  return useQuery({
    queryKey: ['students', 'audiences'],
    queryFn: async () => {
      const { data, error } = await sdb().from('audiences').select('*')
      if (error) throw error
      return data as Audience[]
    },
  })
}

export default function Classes() {
  const a = useStudentAccess()
  const [tab, setTab] = useState<Tab>('day')
  return (
    <>
      <PageHeader title="الحصص والحضور" subtitle="كل حصة أسبوعية بتعمل حصة كل أسبوع لوحدها. أخد الغياب بيسجّل الحصة في المتابعة اليومية." />
      {a.edit && <Tabs tabs={[{ value: 'day' as Tab, label: 'حصص اليوم' }, { value: 'weekly' as Tab, label: 'لمين كل حصة' }]} value={tab} onChange={setTab} />}
      {tab === 'day' ? <DayView /> : <WeeklyAudiences />}
    </>
  )
}

export function DayView() {
  const a = useStudentAccess()
  const p = usePermissions()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [day, setDay] = useState(params.get('date') || cairoToday())
  const [excuse, setExcuse] = useState<{ slot: Slot; date: string } | null>(null)
  const [pickSub, setPickSub] = useState<ClassSession | null>(null)
  const staff = p.can('absences.review') || p.can('schedule.edit') || a.attendance
  const slots = useSlots()
  const dir = useDirectory()
  const [roster, setRoster] = useState<ClassSession | null>(null)
  const [request, setRequest] = useState<ClassSession | null>(null)
  const [announce, setAnnounce] = useState<ClassSession | null>(null)
  const [oneOff, setOneOff] = useState(false)

  // the weekly classes make their sessions on demand (the daily job does it too)
  useEffect(() => {
    sdb().rpc('ensure_sessions', { p_from: addDays(day, -7), p_to: addDays(day, 14) }).then(({ error }) => {
      if (!error) qc.invalidateQueries({ queryKey: ['students', 'sessions'] })
    })
  }, [day, qc])

  const sessions = useQuery({
    queryKey: ['students', 'sessions', day],
    queryFn: async () => {
      const { data, error } = await sdb().from('class_sessions').select('*').eq('on_date', day).order('starts_at')
      if (error) throw error
      return data as ClassSession[]
    },
  })
  const slotBy = useMemo(() => new Map((slots.data ?? []).map((s) => [s.id, s])), [slots.data])
  const name = (id: string | null | undefined) => (id ? dir.data?.find((v) => v.id === id)?.full_name_ar ?? '…' : '')
  const mine = (s: ClassSession) => Boolean(p.volunteerId) && (s.teacher_ids.includes(p.volunteerId!) || s.substitute_id === p.volunteerId)
  const list = (sessions.data ?? []).filter((s) => a.all || a.attendance || mine(s))

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Button variant="secondary" onClick={() => setDay(addDays(day, -1))}>اليوم اللي قبله</Button>
        <Field label="اليوم"><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field>
        <Button variant="secondary" onClick={() => setDay(addDays(day, 1))}>اليوم اللي بعده</Button>
        {day !== cairoToday() && <Button variant="ghost" onClick={() => setDay(cairoToday())}>النهارده</Button>}
        {(a.edit || a.attendance) && <Button className="ms-auto" variant="secondary" onClick={() => setOneOff(true)}><Plus className="size-4" /> حصة مرة واحدة</Button>}
      </div>
      <p className="mb-2 text-sm font-semibold">{fmtDate(day)}</p>
      {sessions.isLoading ? <Spinner /> : !list.length ? (
        <Empty title="مفيش حصص في اليوم ده">{a.all ? 'الحصص بتيجي من الجدول الأسبوعي.' : 'مفيش حصص ليك في اليوم ده.'}</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((s) => {
            const slot = s.slot_id ? slotBy.get(s.slot_id) : undefined
            const can = a.attendance || mine(s)
            return (
              <Card key={s.id} className={clsx('space-y-2', s.status === 'اتلغت' && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{s.subject}{slot?.grade ? ` · ${slot.grade}` : ''}{s.kind === 'امتحان' ? ' · امتحان' : ''}</p>
                    <p className="text-sm text-muted">
                      {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}{slot?.place ? ` · ${slot.place}` : ''}
                      {s.teacher_ids.length ? ` · ${s.teacher_ids.map(name).join('، ')}` : ''}
                      {s.substitute_id ? ` · درّس مكانه ${name(s.substitute_id)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={s.status === 'اتعملت' ? 'green' : s.status === 'اتلغت' ? 'red' : s.status === 'اتأجلت' ? 'orange' : 'gray'}>{s.status}</Badge>
                    {s.needs_substitute && !s.substitute_id && s.status === 'متوقعة' && <Badge tone="red">محتاجة بديل</Badge>}
                  </div>
                </div>
                {s.notes && <p className="text-xs text-muted">{s.notes}</p>}
                {s.attendance_at && <p className="text-sm">حضر {s.present_count ?? 0}{!s.takes_attendance ? ' · مش بيتاخد عليها غياب' : ''}</p>}
                {!s.takes_attendance && !s.attendance_at && <p className="text-xs text-muted">الحصة دي مش بيتاخد عليها غياب، بس الحضور بيتسجل.</p>}
                <div className="flex flex-wrap gap-2">
                  {can && s.status !== 'اتلغت' && s.status !== 'اتأجلت' && (
                    <Button size="sm" onClick={() => setRoster(s)}><ClipboardCheck className="size-4" /> {s.attendance_at ? 'عدّل الحضور' : 'خد الغياب'}</Button>
                  )}
                  {s.slot_id && (mine(s) || p.leader || a.review) && s.status === 'متوقعة' && (
                    <Button size="sm" variant="secondary" onClick={() => setRequest(s)}><CalendarClock className="size-4" /> إلغاء / تأجيل / إيقاف</Button>
                  )}
                  {(mine(s) || a.all) && (
                    <Button size="sm" variant="secondary" onClick={() => setAnnounce(s)}><Megaphone className="size-4" /> تنبيه للطلاب</Button>
                  )}
                  {staff && s.slot_id && s.status === 'متوقعة' && (
                    <Button size="sm" variant={s.needs_substitute && !s.substitute_id ? 'primary' : 'secondary'} onClick={() => setPickSub(s)}>
                      <UserRoundCog className="size-4" /> {s.substitute_id ? 'غيّر البديل' : 'بديل'}
                    </Button>
                  )}
                  {slot && p.volunteerId && s.teacher_ids.includes(p.volunteerId) && s.status === 'متوقعة' && s.on_date > cairoToday() && (
                    <Button size="sm" variant="ghost" onClick={() => setExcuse({ slot, date: s.on_date })}>اعتذار</Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {roster && <RosterModal s={roster} onClose={() => setRoster(null)} />}
      {request && <RequestModal s={request} onClose={() => setRequest(null)} />}
      {announce && <AnnounceModal s={announce} onClose={() => setAnnounce(null)} />}
      {oneOff && <OneOffModal day={day} onClose={() => setOneOff(false)} />}
      {excuse && <AbsenceModal slot={excuse.slot} date={excuse.date} onClose={() => setExcuse(null)} />}
      {pickSub && <SubstituteModal s={pickSub} onClose={() => setPickSub(null)} />}
    </>
  )
}

function SubstituteModal({ s, onClose }: { s: ClassSession; onClose: () => void }) {
  const qc = useQueryClient()
  const [who, setWho] = useState<string | null>(s.substitute_id)
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await sdb().rpc('set_substitute', { p_session: s.id, p_volunteer: who })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(who ? 'البديل اتحط واتبلغ' : 'البديل اتشال')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`بديل · ${s.subject} · ${fmtShort(s.on_date)}`}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          البديل بيوصله إشعار، وبيوصله تذكير بالحصة بالليل وقبلها بساعتين، والحصة بتتسجل له في المتابعة اليومية. لو الحصة محتاجة بديل ومحدش اتحط لحد 8 بالليل قبلها، بتتلغي والأهالي بيتبلغوا.
        </p>
        <Field label="مين هيدّيها"><VolunteerSelect value={who} onChange={setWho} /></Field>
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

function RosterModal({ s, onClose }: { s: ClassSession; onClose: () => void }) {
  const qc = useQueryClient()
  const marks = useMarks()
  const roster = useQuery({
    queryKey: ['students', 'roster', s.id],
    queryFn: async () => {
      const { data, error } = await sdb().rpc('session_roster', { p_session: s.id })
      if (error) throw error
      return data as RosterRow[]
    },
  })
  const [marksBy, setMarksBy] = useState<Record<string, string>>({})
  const [scores, setScores] = useState<Record<string, string>>({})
  const [maxScore, setMaxScore] = useState(s.max_score?.toString() ?? '')
  const [substitute, setSubstitute] = useState<string | null>(s.substitute_id)
  useEffect(() => {
    if (!roster.data) return
    setMarksBy(Object.fromEntries(roster.data.map((r) => [r.student_id, r.mark ?? r.suggested ?? 'حاضر'])))
    setScores(Object.fromEntries(roster.data.map((r) => [r.student_id, r.score?.toString() ?? ''])))
  }, [roster.data])
  const exam = s.kind === 'امتحان'
  const save = useMutation({
    mutationFn: async () => {
      const rows = roster.data ?? []
      if (!rows.length) throw { message: 'مفيش طلاب في الحصة دي' }
      if (exam && !maxScore) throw { message: 'اكتب الدرجة النهائية للامتحان' }
      const patch: Partial<ClassSession> = { substitute_id: substitute }
      if (exam) patch.max_score = Number(maxScore)
      const up = await sdb().from('class_sessions').update(patch).eq('id', s.id)
      if (up.error) throw up.error
      const att = await sdb().from('attendance').upsert(rows.map((r) => ({ session_id: s.id, student_id: r.student_id, mark: marksBy[r.student_id] ?? 'حاضر' })))
      if (att.error) throw att.error
      if (exam) {
        const withScore = rows.filter((r) => scores[r.student_id]?.trim())
        for (const r of withScore) {
          const v = Number(scores[r.student_id])
          if (Number.isNaN(v) || v < 0 || v > Number(maxScore)) throw { message: `درجة ${r.full_name} مش صح` }
        }
        if (withScore.length) {
          const res = await sdb().from('exam_results').upsert(withScore.map((r) => ({ session_id: s.id, student_id: r.student_id, score: Number(scores[r.student_id]) })))
          if (res.error) throw res.error
        }
      }
    },
    onSuccess: () => {
      toast.success('الحضور اتسجل، والحصة اتسجلت في المتابعة اليومية')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    Object.values(marksBy).forEach((m) => (out[m] = (out[m] ?? 0) + 1))
    return out
  }, [marksBy])
  const setAll = (m: string) => setMarksBy(Object.fromEntries((roster.data ?? []).map((r) => [r.student_id, r.suggested ?? m])))

  return (
    <Modal open onClose={onClose} title={`${s.subject} · ${fmtShort(s.on_date)}`}>
      {roster.isLoading ? <Spinner /> : !roster.data?.length ? (
        <p className="text-sm text-muted">مفيش طلاب في الحصة دي. حدد مين بيحضرها من تعديل الحصة في «الجدول الأسبوعي».</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button size="sm" variant="secondary" onClick={() => setAll('حاضر')}>الكل حاضر</Button>
            <Button size="sm" variant="secondary" onClick={() => setAll('غائب')}>الكل غائب</Button>
            <span className="text-muted">{Object.entries(counts).map(([m, n]) => `${m} ${n}`).join(' · ')}</span>
          </div>
          {exam && (
            <Field label="الدرجة النهائية"><Input type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} className="w-32" /></Field>
          )}
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
            {roster.data.map((r) => (
              <li key={r.student_id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 text-sm">
                  {r.full_name} <span className="text-muted">{r.grade ? `· ${r.grade}` : ''}</span>
                  {r.call_in && <Badge tone="red">استدعاء ولي أمر</Badge>}
                  {r.suggested && <Badge tone="orange">{r.suggested}</Badge>}
                </span>
                <Select className="h-8 w-32" value={marksBy[r.student_id] ?? 'حاضر'} onChange={(e) => setMarksBy((m) => ({ ...m, [r.student_id]: e.target.value }))}
                  options={(marks.data ?? []).map((m) => m.code)} />
                {exam && (
                  <Input className="h-8 w-20" type="number" min={0} placeholder="الدرجة" value={scores[r.student_id] ?? ''}
                    onChange={(e) => setScores((x) => ({ ...x, [r.student_id]: e.target.value }))} />
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">الطالب اللي عليه «استدعاء ولي أمر» التنظيم بيقرر يدخّله ولا لأ. اللي في إجازة أو فصل مؤقت بيتسجل كده لوحده.</p>
          <Field label="درّس مكان المدرس (لو حد دخل مكانه)"><VolunteerSelect value={substitute} onChange={setSubstitute} /></Field>
          <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ الحضور</Button>
        </div>
      )}
    </Modal>
  )
}

function RequestModal({ s, onClose }: { s: ClassSession; onClose: () => void }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'إلغاء مرة' | 'تأجيل' | 'إيقاف' | 'إلغاء خالص'>('إلغاء مرة')
  const [newDate, setNewDate] = useState(addDays(s.on_date, 1))
  const [newFrom, setNewFrom] = useState(timeInput(s.starts_at))
  const [newTo, setNewTo] = useState(timeInput(s.ends_at))
  const [pauseTo, setPauseTo] = useState(addDays(s.on_date, 14))
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const base = { slot_id: s.slot_id, session_id: s.id, kind, reason: reason.trim() || null }
      const row: Record<string, unknown> =
        kind === 'إلغاء مرة' ? { ...base, on_date: s.on_date }
        : kind === 'تأجيل' ? { ...base, on_date: s.on_date, new_date: newDate, new_starts_at: newFrom, new_ends_at: newTo }
        : kind === 'إيقاف' ? { ...base, pause_from: s.on_date, pause_to: pauseTo }
        : { ...base, from_date: s.on_date }
      const { error } = await sdb().from('slot_requests').insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الطلب اتبعت للتنظيم، ومفيش حاجة هتتغير قبل الموافقة')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`طلب · ${s.subject} · ${fmtShort(s.on_date)}`}>
      <div className="space-y-3">
        <Field label="الطلب"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} options={['إلغاء مرة', 'تأجيل', 'إيقاف', 'إلغاء خالص']} /></Field>
        {kind === 'تأجيل' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="اليوم الجديد"><Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></Field>
            <Field label="من"><Input type="time" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} /></Field>
            <Field label="لحد"><Input type="time" value={newTo} onChange={(e) => setNewTo(e.target.value)} /></Field>
          </div>
        )}
        {kind === 'إيقاف' && <Field label="متوقفة لحد"><Input type="date" value={pauseTo} onChange={(e) => setPauseTo(e.target.value)} /></Field>}
        {kind === 'إلغاء خالص' && <p className="text-sm text-orange-700">الحصة الأسبوعية هتتقفل من {fmtShort(s.on_date)}، وكل اللي بعدها هيتلغي.</p>}
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} loading={save.isPending}>ابعت الطلب</Button>
      </div>
    </Modal>
  )
}

function AnnounceModal({ s, onClose }: { s: ClassSession; onClose: () => void }) {
  const [body, setBody] = useState('')
  const [scope, setScope] = useState<'session' | 'slot'>('session')
  const save = useMutation({
    mutationFn: async () => {
      if (!body.trim()) throw { message: 'اكتب التنبيه' }
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user.email ?? null
      const row: Record<string, unknown> = scope === 'slot' && s.slot_id ? { body: body.trim(), target: 'slot', slot_id: s.slot_id, created_by: email } : { body: body.trim(), target: 'session', session_id: s.id, created_by: email }
      const { error } = await sdb().from('announcements').insert(row)
      if (error) throw error
    },
    onSuccess: () => { toast.success('التنبيه اتبعت للطلاب وأولياء الأمور'); onClose() },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="تنبيه للطلاب">
      <div className="space-y-3">
        <Textarea rows={3} placeholder="زي: هاتوا كتاب القراءة بكرة" value={body} onChange={(e) => setBody(e.target.value)} />
        {s.slot_id && (
          <Field label="لمين"><Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} options={[{ value: 'session', label: 'طلاب الحصة دي' }, { value: 'slot', label: 'طلاب الحصة كل أسبوع' }]} /></Field>
        )}
        <Button onClick={() => save.mutate()} loading={save.isPending}>ابعت</Button>
      </div>
    </Modal>
  )
}

/** Who a class is for: everyone, grades, groups or named students. */
export function AudienceEditor({ value, onChange }: { value: Omit<Audience, 'id' | 'slot_id' | 'session_id'>[]; onChange: (v: Omit<Audience, 'id' | 'slot_id' | 'session_id'>[]) => void }) {
  const term = useCurrentTerm()
  const grades = useGrades()
  const groups = useGroups(term.data?.id)
  const students = useStudents()
  const [target, setTarget] = useState<'all' | 'grade' | 'group' | 'student'>('grade')
  const [pick, setPick] = useState('')
  const label = (x: Omit<Audience, 'id' | 'slot_id' | 'session_id'>) =>
    x.target === 'all' ? 'كل الطلاب' : x.target === 'grade' ? x.grade : x.target === 'group' ? groups.data?.find((g) => g.id === x.group_id)?.name ?? 'مجموعة' : students.data?.find((s) => s.id === x.student_id)?.full_name ?? 'طالب'
  const options =
    target === 'grade' ? (grades.data ?? []).map((g) => ({ value: g, label: g }))
    : target === 'group' ? (groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    : target === 'student' ? (students.data ?? []).filter((s) => s.enrollment).map((s) => ({ value: s.id, label: `${s.full_name} · ${s.enrollment?.grade}` }))
    : []
  const add = () => {
    if (target !== 'all' && !pick) return
    const row = { target, grade: target === 'grade' ? pick : null, group_id: target === 'group' ? pick : null, student_id: target === 'student' ? pick : null }
    onChange([...value, row])
    setPick('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {!value.length && <span className="text-sm text-muted">لسه محدش.</span>}
        {value.map((x, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 ps-3 pe-1 text-sm font-semibold text-brand-800">
            {label(x)}
            <button type="button" className="rounded-full px-1 hover:bg-brand-100" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="شيل">×</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select className="w-36" value={target} onChange={(e) => { setTarget(e.target.value as typeof target); setPick('') }}
          options={[{ value: 'grade', label: 'سنة' }, { value: 'group', label: 'مجموعة' }, { value: 'student', label: 'طالب بالاسم' }, { value: 'all', label: 'كل الطلاب' }]} />
        {target !== 'all' && <Select className="min-w-40 flex-1" value={pick} onChange={(e) => setPick(e.target.value)} options={options} placeholder="اختار" />}
        <Button variant="secondary" onClick={add}><Plus className="size-4" /> ضيف</Button>
      </div>
    </div>
  )
}

function WeeklyAudiences() {
  const slots = useSlots()
  const aud = useAudiences()
  const term = useCurrentTerm()
  const groups = useGroups(term.data?.id)
  const [edit, setEdit] = useState<Slot | null>(null)
  const forSlot = (id: string) => (aud.data ?? []).filter((x) => x.slot_id === id)
  const label = (x: Audience) =>
    x.target === 'all' ? 'كل الطلاب' : x.target === 'grade' ? x.grade : x.target === 'group' ? groups.data?.find((g) => g.id === x.group_id)?.name ?? 'مجموعة' : 'طالب'
  if (slots.isLoading || aud.isLoading) return <Spinner />
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs text-muted">
          <tr>
            <th className="p-2 text-start">الحصة</th>
            <th className="p-2 text-start">الميعاد</th>
            <th className="p-2 text-start">لمين</th>
            <th className="p-2 text-start">الحالة</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {(slots.data ?? []).map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="p-2 font-semibold">{s.subject} · {s.grade}</td>
              <td className="p-2">{s.day} {fmtTime(s.starts_at)}{s.ends_on ? ` · لحد ${fmtShort(s.ends_on)}` : ''}</td>
              <td className="p-2">{forSlot(s.id).map(label).join('، ') || <span className="text-orange-700">لسه</span>}</td>
              <td className="p-2"><Badge tone={s.status === 'شغالة' ? 'green' : s.status === 'اتلغت' ? 'red' : 'gray'}>{s.status}</Badge></td>
              <td className="p-2"><Button size="sm" variant="secondary" onClick={() => setEdit(s)}><Users className="size-4" /> عدّل</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <SlotAudienceModal slot={edit} current={forSlot(edit.id)} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function SlotAudienceModal({ slot, current, onClose }: { slot: Slot; current: Audience[]; onClose: () => void }) {
  const qc = useQueryClient()
  const p = usePermissions()
  const [rows, setRows] = useState(current.map(({ target, grade, group_id, student_id }) => ({ target, grade, group_id, student_id })))
  const [startsOn, setStartsOn] = useState(slot.starts_on ?? '')
  const [endsOn, setEndsOn] = useState(slot.ends_on ?? '')
  const [status, setStatus] = useState(slot.status)
  const save = useMutation({
    mutationFn: async () => {
      const del = await sdb().from('audiences').delete().eq('slot_id', slot.id)
      if (del.error) throw del.error
      if (rows.length) {
        const ins = await sdb().from('audiences').insert(rows.map((r) => ({ ...r, slot_id: slot.id })))
        if (ins.error) throw ins.error
      }
      if (p.canEditSchedule) {
        const up = await supabase.from('schedule_slots').update({ starts_on: startsOn || null, ends_on: endsOn || null, status }).eq('id', slot.id)
        if (up.error) throw up.error
      }
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`${slot.subject} · ${slot.grade} · ${slot.day}`}>
      <div className="space-y-3">
        <Field label="الحصة لمين"><AudienceEditor value={rows} onChange={setRows} /></Field>
        {p.canEditSchedule && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="بتبدأ من" hint="فاضي = من دلوقتي"><Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></Field>
              <Field label="بتخلص" hint="فاضي = مستمرة"><Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></Field>
            </div>
            <Field label="الحالة"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={['شغالة', 'متوقفة', 'اتلغت']} /></Field>
          </>
        )}
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

function OneOffModal({ day, onClose }: { day: string; onClose: () => void }) {
  const qc = useQueryClient()
  const p = usePermissions()
  const [date, setDate] = useState(day)
  const [from, setFrom] = useState('16:00')
  const [to, setTo] = useState('17:00')
  const [subject, setSubject] = useState('')
  const [kind, setKind] = useState<'حصة' | 'امتحان'>('حصة')
  const [takes, setTakes] = useState(true)
  const [teacher, setTeacher] = useState<string | null>(p.volunteerId)
  const [rows, setRows] = useState<Omit<Audience, 'id' | 'slot_id' | 'session_id'>[]>([])
  const save = useMutation({
    mutationFn: async () => {
      if (!subject.trim()) throw { message: 'اكتب المادة أو اسم الحصة' }
      if (!rows.length) throw { message: 'حدد الحصة لمين' }
      if (to <= from) throw { message: 'ميعاد النهاية قبل البداية' }
      const id = crypto.randomUUID()
      const ins = await sdb().from('class_sessions').insert({ id, on_date: date, starts_at: from, ends_at: to, subject: subject.trim(), kind, takes_attendance: takes, teacher_ids: teacher ? [teacher] : [] })
      if (ins.error) throw ins.error
      const a = await sdb().from('audiences').insert(rows.map((r) => ({ ...r, session_id: id })))
      if (a.error) throw a.error
    },
    onSuccess: () => {
      toast.success('الحصة اتعملت')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="حصة مرة واحدة">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="اليوم"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="من"><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="لحد"><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="المادة / الحصة"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="النوع"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} options={['حصة', 'امتحان']} /></Field>
          <Field label="بيتاخد عليها غياب"><Select value={takes ? 'yes' : 'no'} onChange={(e) => setTakes(e.target.value === 'yes')} options={[{ value: 'yes', label: 'أيوه' }, { value: 'no', label: 'لأ (ورشة)' }]} /></Field>
        </div>
        <Field label="المدرس"><VolunteerSelect value={teacher} onChange={setTeacher} /></Field>
        <Field label="لمين"><AudienceEditor value={rows} onChange={setRows} /></Field>
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BellRing, CalendarX, MessageSquarePlus, Pencil, Phone } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle } from '@/components/ui'
import { ageFrom, cairoToday, fmtDate, fmtShort, whatsappLink } from '@/lib/data'
import { toastError } from '@/lib/errors'
import {
  ENROLLMENT_TONE,
  sdb,
  useCurrentTerm,
  useMarks,
  type ClassSession,
  type Enrollment,
  type Flag,
  type Leave,
  type Note,
  type Student,
} from '@/lib/students'
import { useStudentAccess } from './Students'

export default function StudentDetail() {
  const { id } = useParams()
  const a = useStudentAccess()
  const term = useCurrentTerm()
  const marks = useMarks()
  const [modal, setModal] = useState<null | 'flag' | 'leave' | 'note'>(null)

  const q = useQuery({
    queryKey: ['students', 'detail', id],
    queryFn: async () => {
      const [s, enr, att, res, flags, leaves, notes, groups] = await Promise.all([
        sdb().from('students').select('*').eq('id', id!).single(),
        sdb().from('enrollments').select('*, term:terms(name)').eq('student_id', id!),
        sdb().from('attendance').select('mark, note, session:class_sessions(id, on_date, subject, kind, takes_attendance, status)').eq('student_id', id!),
        sdb().from('exam_results').select('score, note, session:class_sessions(on_date, subject, max_score)').eq('student_id', id!),
        sdb().from('flags').select('*').eq('student_id', id!).order('created_at', { ascending: false }),
        sdb().from('leaves').select('*').eq('student_id', id!).order('from_date', { ascending: false }),
        sdb().from('notes').select('*').eq('student_id', id!).order('created_at', { ascending: false }),
        sdb().from('group_members').select('group:groups(id, name, kind, term_id)').eq('student_id', id!),
      ])
      if (s.error) throw s.error
      type Att = { mark: string; note: string | null; session: Pick<ClassSession, 'id' | 'on_date' | 'subject' | 'kind' | 'takes_attendance' | 'status'> }
      type Res = { score: number; note: string | null; session: { on_date: string; subject: string; max_score: number | null } }
      return {
        s: s.data as Student,
        enrollments: (enr.data ?? []) as (Enrollment & { term: { name: string } })[],
        attendance: ((att.data ?? []) as unknown as Att[]).sort((x, y) => y.session.on_date.localeCompare(x.session.on_date)),
        results: ((res.data ?? []) as unknown as Res[]).sort((x, y) => y.session.on_date.localeCompare(x.session.on_date)),
        flags: (flags.data ?? []) as Flag[],
        leaves: (leaves.data ?? []) as Leave[],
        notes: (notes.data ?? []) as Note[],
        groups: ((groups.data ?? []) as unknown as { group: { id: string; name: string; kind: string; term_id: string } }[]).map((g) => g.group),
      }
    },
  })

  if (q.isLoading) return <Spinner />
  if (!q.data) return <Empty title="الطالب ده مش موجود أو مش من طلابك" />
  const { s, enrollments, attendance, results, flags, leaves, notes, groups } = q.data
  const current = enrollments.find((e) => e.term_id === term.data?.id) ?? null
  const counting = new Set((marks.data ?? []).filter((m) => m.counts_absence).map((m) => m.code))
  const absences = attendance.filter((x) => counting.has(x.mark) && x.session.takes_attendance && x.session.status !== 'اتلغت' && term.data && x.session.on_date >= term.data.starts_on && x.session.on_date <= term.data.ends_on).length
  const present = attendance.filter((x) => (marks.data ?? []).find((m) => m.code === x.mark)?.is_present).length
  const openFlags = flags.filter((f) => !f.lifted_at)

  return (
    <>
      <PageHeader
        title={s.full_name}
        subtitle={[current?.grade, s.gender, ageFrom(s.birth_date) != null ? `${ageFrom(s.birth_date)} سنة` : null, s.school, s.carnet_no && `كارنيه ${s.carnet_no}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {a.edit && (
              <Link to={`/students/${s.id}/edit`}>
                <Button variant="secondary"><Pencil className="size-4" /> تعديل</Button>
              </Link>
            )}
            {a.flags && <Button variant="secondary" onClick={() => setModal('flag')}><BellRing className="size-4" /> استدعاء / فصل مؤقت</Button>}
            {a.flags && <Button variant="secondary" onClick={() => setModal('leave')}><CalendarX className="size-4" /> إجازة</Button>}
            <Button variant="secondary" onClick={() => setModal('note')}><MessageSquarePlus className="size-4" /> ملاحظة</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {current ? <Badge tone={ENROLLMENT_TONE[current.status]}>{current.status}{current.status_note ? ` · ${current.status_note}` : ''}</Badge> : <Badge>مش مقيد في الترم ده</Badge>}
        {openFlags.map((f) => (
          <Badge key={f.id} tone="red">{f.kind}{f.to_date ? ` لحد ${fmtShort(f.to_date)}` : ''}</Badge>
        ))}
        {groups.filter((g) => g.term_id === term.data?.id).map((g) => <Badge key={g.id} tone="brand">{g.name}</Badge>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="font-bold">الحضور</h2>
          <div className="flex gap-4 text-sm">
            <span>حضر: <b>{present}</b></span>
            <span className={clsx(absences >= 3 && 'font-bold text-orange-700')}>غياب الترم: <b>{absences}</b></span>
          </div>
          {!attendance.length ? (
            <p className="text-sm text-muted">لسه مفيش حضور متسجل.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
              {attendance.map((x) => (
                <li key={x.session.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{fmtShort(x.session.on_date)} · {x.session.subject}{x.session.kind === 'امتحان' ? ' (امتحان)' : ''}</span>
                  <Badge tone={counting.has(x.mark) ? 'red' : (marks.data ?? []).find((m) => m.code === x.mark)?.is_present ? 'green' : 'gray'}>{x.mark}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-bold">الدرجات</h2>
          {!results.length ? (
            <p className="text-sm text-muted">مفيش درجات.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {results.map((r, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span>{fmtShort(r.session.on_date)} · {r.session.subject}</span>
                  <b>{r.score}{r.session.max_score ? ` / ${r.session.max_score}` : ''}</b>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-bold">الاستدعاءات والفصل والإجازات</h2>
          {!flags.length && !leaves.length && <p className="text-sm text-muted">مفيش.</p>}
          {flags.map((f) => <FlagRow key={f.id} f={f} />)}
          {leaves.map((l) => (
            <p key={l.id} className="text-sm">إجازة من {fmtShort(l.from_date)} لـ {fmtShort(l.to_date)}{l.reason ? ` · ${l.reason}` : ''}</p>
          ))}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-bold">الملاحظات</h2>
          {!notes.length && <p className="text-sm text-muted">مفيش ملاحظات.</p>}
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl bg-surface p-2 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted">{fmtDate(n.created_at)}{n.for_guardian ? ' · اتبعتت لولي الأمر' : ''}</p>
            </div>
          ))}
        </Card>

        {enrollments.length > 1 && (
          <Card className="space-y-2">
            <h2 className="font-bold">الترمات اللي فاتت</h2>
            {enrollments.filter((e) => e.term_id !== term.data?.id).map((e) => (
              <p key={e.id} className="text-sm">{e.term.name} · {e.grade} · {e.status}</p>
            ))}
          </Card>
        )}

        {(a.contacts || a.sensitive) && <FamilyCard s={s} />}
      </div>

      {modal === 'flag' && <FlagModal studentId={s.id} onClose={() => setModal(null)} />}
      {modal === 'leave' && <LeaveModal studentId={s.id} onClose={() => setModal(null)} />}
      {modal === 'note' && <NoteModal studentId={s.id} onClose={() => setModal(null)} />}
    </>
  )
}

function FlagRow({ f }: { f: Flag }) {
  const qc = useQueryClient()
  const lift = useMutation({
    mutationFn: async () => {
      const patch = f.kind === 'استدعاء' ? { guardian_came_on: cairoToday(), lifted_at: new Date().toISOString() } : { lifted_at: new Date().toISOString() }
      const { error } = await sdb().from('flags').update(patch).eq('id', f.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(f.kind === 'استدعاء' ? 'اتسجل إن ولي الأمر حضر' : 'الفصل المؤقت اتلغى')
      qc.invalidateQueries({ queryKey: ['students'] })
    },
    onError: toastError,
  })
  const a = useStudentAccess()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        <b>{f.kind}</b> · {f.reason} · من {fmtShort(f.from_date)}{f.to_date ? ` لـ ${fmtShort(f.to_date)}` : ''}
        {f.lifted_at && <span className="text-muted"> · {f.guardian_came_on ? `ولي الأمر حضر ${fmtShort(f.guardian_came_on)}` : 'اتلغى'}</span>}
      </span>
      {!f.lifted_at && a.flags && (
        <Button size="sm" variant="secondary" loading={lift.isPending} onClick={() => lift.mutate()}>
          {f.kind === 'استدعاء' ? 'ولي الأمر حضر' : 'إلغاء الفصل'}
        </Button>
      )}
    </div>
  )
}

function FamilyCard({ s }: { s: Student }) {
  const a = useStudentAccess()
  const q = useQuery({
    queryKey: ['students', 'family', s.id],
    queryFn: async () => {
      const [g, phones, priv] = await Promise.all([
        s.guardian_id ? sdb().from('guardians').select('*').eq('id', s.guardian_id).maybeSingle() : Promise.resolve({ data: null }),
        sdb().from('phones').select('*').eq('student_id', s.id).order('sort_order'),
        a.sensitive ? sdb().from('student_private').select('*').eq('student_id', s.id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      return {
        g: g.data as { full_name: string; relation: string; phone: string | null; job: string | null; national_id: string | null; custody_document: string | null } | null,
        phones: (phones.data ?? []) as { number: string; label: string | null; is_whatsapp: boolean }[],
        priv: priv.data as Record<string, string | number | null> | null,
      }
    },
  })
  if (q.isLoading) return <Card><Spinner /></Card>
  const d = q.data!
  const row = (label: string, v: ReactNode) => (v === null || v === undefined || v === '' ? null : <p className="text-sm"><span className="text-muted">{label}: </span>{v}</p>)
  return (
    <Card className="space-y-2 lg:col-span-2">
      <h2 className="font-bold">الأسرة والتواصل</h2>
      {d.g && row('ولي الأمر', `${d.g.full_name} (${d.g.relation})${d.g.job ? ` · ${d.g.job}` : ''}`)}
      {d.g?.custody_document && row('ورقة الولاية', d.g.custody_document)}
      <div className="flex flex-wrap gap-2">
        {d.phones.map((p) => (
          <span key={p.number} className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-sm" dir="ltr">
            <Phone className="size-3.5" />
            <a href={`tel:${p.number}`}>{p.number}</a>
            {p.label && <span className="text-muted" dir="rtl">({p.label})</span>}
            {p.is_whatsapp && <a className="text-emerald-700" href={whatsappLink(p.number) ?? '#'} target="_blank" rel="noreferrer">واتساب</a>}
          </span>
        ))}
      </div>
      {d.priv && (
        <div className="grid gap-1 border-t border-line pt-2 sm:grid-cols-2">
          {row('الرقم القومي', d.priv.national_id)}
          {row('العنوان', d.priv.address)}
          {row('الأب', [d.priv.father_name, d.priv.father_job, d.priv.father_national_id].filter(Boolean).join(' · '))}
          {row('بطاقة الأب سارية حتى', d.priv.father_id_valid_until)}
          {row('الأم', [d.priv.mother_name, d.priv.mother_job, d.priv.mother_national_id].filter(Boolean).join(' · '))}
          {row('بطاقة الأم سارية حتى', d.priv.mother_id_valid_until)}
          {row('الأبناء', [d.priv.kids_under_5, d.priv.kids_5_to_10, d.priv.boys_over_10, d.priv.girls_over_10].some((x) => x != null)
            ? `أقل من 5: ${d.priv.kids_under_5 ?? 0} · 5–10: ${d.priv.kids_5_to_10 ?? 0} · ولاد +10: ${d.priv.boys_over_10 ?? 0} · بنات +10: ${d.priv.girls_over_10 ?? 0}` : null)}
          {row('الدخل', d.priv.family_income)}
          {row('الدعم', d.priv.family_support)}
          {row('صحي', d.priv.health_notes)}
          {row('ملاحظات هامة', d.priv.important_notes)}
        </div>
      )}
    </Card>
  )
}

function useDone(onClose: () => void, msg: string) {
  const qc = useQueryClient()
  return {
    onSuccess: () => {
      toast.success(msg)
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  }
}

function FlagModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [kind, setKind] = useState<'استدعاء' | 'فصل مؤقت'>('استدعاء')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState(cairoToday())
  const [to, setTo] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw { message: 'اكتب السبب' }
      if (kind === 'فصل مؤقت' && !to) throw { message: 'الفصل المؤقت لحد إمتى؟' }
      const { error } = await sdb().from('flags').insert({ student_id: studentId, kind, reason: reason.trim(), from_date: from, to_date: to || null })
      if (error) throw error
    },
    ...useDone(onClose, 'اتسجل، وولي الأمر هيوصله إشعار'),
  })
  return (
    <Modal open onClose={onClose} title="استدعاء / فصل مؤقت">
      <div className="space-y-3">
        <Field label="النوع"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} options={['استدعاء', 'فصل مؤقت']} /></Field>
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          {kind === 'فصل مؤقت' && <Field label="لحد"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
        </div>
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

function LeaveModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [from, setFrom] = useState(cairoToday())
  const [to, setTo] = useState(cairoToday())
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      if (to < from) throw { message: 'تاريخ النهاية قبل البداية' }
      const { error } = await sdb().from('leaves').insert({ student_id: studentId, from_date: from, to_date: to, reason: reason.trim() || null })
      if (error) throw error
    },
    ...useDone(onClose, 'الإجازة اتسجلت، والحصص اللي فيها مش هتتحسب غياب'),
  })
  return (
    <Modal open onClose={onClose} title="إجازة">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="لحد"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

function NoteModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [body, setBody] = useState('')
  const [forGuardian, setForGuardian] = useState(false)
  const save = useMutation({
    mutationFn: async () => {
      if (!body.trim()) throw { message: 'اكتب الملاحظة' }
      const { error } = await sdb().from('notes').insert({ student_id: studentId, body: body.trim(), for_guardian: forGuardian })
      if (error) throw error
    },
    ...useDone(onClose, forGuardian ? 'الملاحظة اتبعتت لولي الأمر' : 'الملاحظة اتحفظت'),
  })
  return (
    <Modal open onClose={onClose} title="ملاحظة">
      <div className="space-y-3">
        <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        <Toggle checked={forGuardian} onChange={setForGuardian} label="ابعتها لولي الأمر" />
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

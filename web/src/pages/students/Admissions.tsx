import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { fmtShort } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { APPLICATION_STATUSES, PAPERS, sdb, useGrades, useTerms, type Application } from '@/lib/students'
import { useStudentAccess } from './Students'

type Row = Application & { student: { full_name: string } }
const TONE: Record<string, 'green' | 'red' | 'orange' | 'gray' | 'purple'> = {
  مقبول: 'green', مرفوض: 'red', 'بلاك ليست': 'purple', انتظار: 'gray', 'لم يمتحن': 'orange', 'انتظار التصحيح': 'orange', 'إعادة امتحان': 'orange',
}

const DONE = ['مقبول', 'مرفوض', 'بلاك ليست']
const STEPS = ['انتظار', 'لم يمتحن', 'انتظار التصحيح', 'إعادة امتحان']

/**
 * القبول: every new student starts here. One line per student with what is left:
 * papers → exam → decision. «اقبل» enrolls him in the term right away.
 */
export default function Admissions() {
  const a = useStudentAccess()
  const qc = useQueryClient()
  const terms = useTerms()
  const grades = useGrades()
  const [termId, setTermId] = useState<string>('')
  const term = terms.data?.find((t) => t.id === termId) ?? terms.data?.find((t) => t.is_current) ?? terms.data?.[0] ?? null
  const [status, setStatus] = useState<string>('open')
  const [grade, setGrade] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [newTerm, setNewTerm] = useState(false)

  const q = useQuery({
    queryKey: ['students', 'applications', term?.id],
    enabled: Boolean(term),
    queryFn: async () => {
      const { data, error } = await sdb().from('applications').select('*, student:students(full_name)').eq('term_id', term!.id).order('created_at', { ascending: false })
      if (error) throw error
      return data as Row[]
    },
  })
  const all = q.data ?? []
  const rows = useMemo(() => {
    const s = search.trim()
    return all
      .filter((r) => (status === 'open' ? !DONE.includes(r.status) : status === 'all' ? true : r.status === status))
      .filter((r) => !grade || r.grade === grade)
      .filter((r) => !s || r.student.full_name.includes(s))
      .sort((x, y) => x.grade.localeCompare(y.grade) || x.student.full_name.localeCompare(y.student.full_name, 'ar'))
  }, [all, status, grade, search])
  const count = (s: string) => all.filter((r) => r.status === s).length
  const bulk = useMutation({
    mutationFn: async (to: string) => {
      const ids = [...picked]
      const { error } = await sdb().from('applications').update({ status: to }).in('id', ids)
      if (error) throw error
      return { to, n: ids.length }
    },
    onSuccess: ({ to, n }) => {
      toast.success(to === 'مقبول' ? `${n} اتقبلوا واتقيدوا في الترم` : `${n} بقوا «${to}»`)
      setPicked(new Set())
      qc.invalidateQueries({ queryKey: ['students'] })
    },
    onError: toastError,
  })
  const toggle = (id: string) => setPicked((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      <PageHeader
        title="القبول"
        subtitle="كل طالب جديد بيبدأ هنا. الخطوات: الورق ← الامتحان ← القرار. «اقبل» بيقيّده في الترم على طول."
        actions={
          a.edit && (
            <>
              <Link to="/students/new"><Button><Plus className="size-4" /> طالب جديد</Button></Link>
              <Button variant="secondary" onClick={() => setNewTerm(true)}>ترم جديد</Button>
            </>
          )
        }
      />
      {terms.isLoading ? <Spinner /> : !terms.data?.length ? (
        <Empty title="مفيش ترمات لسه">اعمل أول ترم عشان تبدأ تضيف طلاب.</Empty>
      ) : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <Select value={term?.id ?? ''} onChange={(e) => { setTermId(e.target.value); setPicked(new Set()) }} options={terms.data.map((t) => ({ value: t.id, label: t.name + (t.is_current ? ' (الحالي)' : '') }))} />
            <Select value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="كل السنين" options={grades.data ?? []} />
            <Input className="sm:col-span-2" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر باسم الطالب" />
          </div>
          <Tabs
            tabs={[
              { value: 'open', label: 'لسه', count: all.filter((r) => !DONE.includes(r.status)).length },
              ...STEPS.map((x) => ({ value: x, label: x, count: count(x) })).filter((t) => t.count),
              { value: 'مقبول', label: 'مقبول', count: count('مقبول') },
              { value: 'مرفوض', label: 'مرفوض', count: count('مرفوض') },
              { value: 'بلاك ليست', label: 'بلاك ليست', count: count('بلاك ليست') },
              { value: 'all', label: 'الكل', count: all.length },
            ]}
            value={status}
            onChange={(v) => { setStatus(v); setPicked(new Set()) }}
          />
          {a.edit && picked.size > 0 && (
            <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-800 p-3 text-white shadow-lg">
              <span className="font-semibold">اخترت {picked.size}</span>
              <Button size="sm" variant="success" loading={bulk.isPending} onClick={() => bulk.mutate('مقبول')}>اقبلهم</Button>
              <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => bulk.mutate('لم يمتحن')}>لسه ممتحنوش</Button>
              <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => confirm(`رفض ${picked.size} طالب؟`) && bulk.mutate('مرفوض')}>ارفضهم</Button>
              <button className="ms-auto text-sm underline" onClick={() => setPicked(new Set())}>إلغاء</button>
            </div>
          )}
          {q.isLoading ? <Spinner /> : !rows.length ? <Empty title="مفيش طلبات هنا" /> : (
            <div className="space-y-2">
              {a.edit && (
                <label className="flex items-center gap-2 px-1 text-sm text-muted">
                  <input type="checkbox" checked={rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                  اختار الكل ({rows.length})
                </label>
              )}
              {rows.map((r) => <AppRow key={r.id} r={r} editable={a.edit} picked={picked.has(r.id)} onPick={() => toggle(r.id)} />)}
            </div>
          )}
        </>
      )}
      {newTerm && <NewTerm onClose={() => setNewTerm(false)} />}
    </>
  )
}

function AppRow({ r, editable, picked, onPick }: { r: Row; editable: boolean; picked: boolean; onPick: () => void }) {
  const qc = useQueryClient()
  const grades = useGrades()
  const save = useMutation({
    mutationFn: async (patch: Partial<Application>) => {
      const { error } = await sdb().from('applications').update(patch).eq('id', r.id)
      if (error) throw error
      return patch
    },
    onSuccess: (patch) => {
      if (patch.status === 'مقبول') toast.success(`${r.student.full_name} اتقبل واتقيّد في الترم`)
      qc.invalidateQueries({ queryKey: ['students'] })
    },
    onError: toastError,
  })
  const papersOk = r.papers === 'تم'
  return (
    <Card className={`flex flex-wrap items-center gap-3 py-3 ${picked ? 'ring-2 ring-brand-400' : ''}`}>
      {editable && <input type="checkbox" checked={picked} onChange={onPick} aria-label="اختار" className="size-5" />}
      <div className="min-w-40 flex-1">
        <Link to={`/students/${r.student_id}`} className="font-bold hover:underline">{r.student.full_name}</Link>
        <p className="text-xs text-muted">{r.is_new ? 'مستجد' : 'مقيد قبل كده'} · اتسجل {fmtShort(r.created_at)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {editable ? <Select className="h-9 w-24" value={r.grade} onChange={(e) => save.mutate({ grade: e.target.value })} options={grades.data ?? [r.grade]} aria-label="السنة" /> : <Badge tone="brand">{r.grade}</Badge>}
        {editable ? (
          <Select className={`h-9 w-36 ${papersOk ? '' : 'text-orange-700'}`} value={r.papers} onChange={(e) => save.mutate({ papers: e.target.value as Application['papers'] })} options={PAPERS.map((x) => ({ value: x, label: `الورق: ${x}` }))} aria-label="الورق" />
        ) : <Badge tone={papersOk ? 'green' : 'orange'}>الورق: {r.papers}</Badge>}
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" disabled={!editable} checked={r.carnet_given} onChange={(e) => save.mutate({ carnet_given: e.target.checked })} /> الكارنيه
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {editable ? (
          <>
            <Select className="h-9 w-36" value={r.status} onChange={(e) => save.mutate({ status: e.target.value as Application['status'] })} options={[...APPLICATION_STATUSES]} aria-label="الحالة" />
            {!DONE.includes(r.status) && (
              <Button size="sm" variant="success" loading={save.isPending} onClick={() => save.mutate({ status: 'مقبول' })}>اقبل</Button>
            )}
          </>
        ) : <Badge tone={TONE[r.status]}>{r.status}</Badge>}
      </div>
    </Card>
  )
}

function NewTerm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [current, setCurrent] = useState(true)
  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !from || !to) throw { message: 'اكتب الاسم والتاريخين' }
      if (to <= from) throw { message: 'تاريخ النهاية قبل البداية' }
      if (current) {
        const { error } = await sdb().from('terms').update({ is_current: false }).eq('is_current', true)
        if (error) throw error
      }
      const { error } = await sdb().from('terms').insert({ name: name.trim(), starts_on: from, ends_on: to, is_current: current })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الترم اتعمل')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="ترم جديد">
      <div className="space-y-3">
        <Field label="الاسم" hint="زي «الترم الأول 2026-2027»"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="لحد"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} /> ده الترم الحالي
        </label>
        <p className="text-xs text-muted">الترمات اللي فاتت بتفضل محفوظة ببياناتها وحضورها.</p>
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

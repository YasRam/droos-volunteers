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

export default function Admissions() {
  const a = useStudentAccess()
  const terms = useTerms()
  const [termId, setTermId] = useState<string>('')
  const term = terms.data?.find((t) => t.id === termId) ?? terms.data?.find((t) => t.is_current) ?? terms.data?.[0] ?? null
  const [status, setStatus] = useState<string>('open')
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
  const rows = useMemo(() => {
    const all = q.data ?? []
    if (status === 'open') return all.filter((r) => !['مقبول', 'مرفوض', 'بلاك ليست'].includes(r.status))
    if (status === 'all') return all
    return all.filter((r) => r.status === status)
  }, [q.data, status])
  const count = (s: string) => (q.data ?? []).filter((r) => r.status === s).length

  return (
    <>
      <PageHeader
        title="القبول"
        subtitle="كل طالب جديد بيبدأ هنا بحالة «انتظار». «مقبول» بيقيّده في الترم على طول."
        actions={a.edit && <Button variant="secondary" onClick={() => setNewTerm(true)}><Plus className="size-4" /> ترم جديد</Button>}
      />
      {terms.isLoading ? <Spinner /> : !terms.data?.length ? (
        <Empty title="مفيش ترمات لسه">اعمل أول ترم عشان تبدأ تضيف طلاب.</Empty>
      ) : (
        <>
          <Card className="mb-3 max-w-sm">
            <Field label="الترم">
              <Select value={term?.id ?? ''} onChange={(e) => setTermId(e.target.value)} options={terms.data.map((t) => ({ value: t.id, label: t.name + (t.is_current ? ' (الحالي)' : '') }))} />
            </Field>
          </Card>
          <Tabs
            tabs={[
              { value: 'open', label: 'لسه', count: (q.data ?? []).filter((r) => !['مقبول', 'مرفوض', 'بلاك ليست'].includes(r.status)).length },
              { value: 'مقبول', label: 'مقبول', count: count('مقبول') },
              { value: 'مرفوض', label: 'مرفوض', count: count('مرفوض') },
              { value: 'بلاك ليست', label: 'بلاك ليست', count: count('بلاك ليست') },
              { value: 'all', label: 'الكل', count: q.data?.length },
            ]}
            value={status}
            onChange={setStatus}
          />
          {q.isLoading ? <Spinner /> : !rows.length ? <Empty title="مفيش طلبات هنا" /> : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-muted">
                  <tr>
                    <th className="p-2 text-start">الطالب</th>
                    <th className="p-2 text-start">السنة</th>
                    <th className="p-2 text-start">مستجد</th>
                    <th className="p-2 text-start">الحالة</th>
                    <th className="p-2 text-start">الورق</th>
                    <th className="p-2 text-start">الكارنيه</th>
                    <th className="p-2 text-start">اتسجل</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => <AppRow key={r.id} r={r} editable={a.edit} />)}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
      {newTerm && <NewTerm onClose={() => setNewTerm(false)} />}
    </>
  )
}

function AppRow({ r, editable }: { r: Row; editable: boolean }) {
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
  return (
    <tr className="border-t border-line">
      <td className="p-2 font-semibold"><Link to={`/students/${r.student_id}`} className="hover:underline">{r.student.full_name}</Link></td>
      <td className="p-2">
        {editable ? <Select className="h-8 w-24" value={r.grade} onChange={(e) => save.mutate({ grade: e.target.value })} options={grades.data ?? [r.grade]} /> : r.grade}
      </td>
      <td className="p-2">{r.is_new ? 'مستجد' : 'مقيد'}</td>
      <td className="p-2">
        {editable ? (
          <Select className="h-8 w-36" value={r.status} onChange={(e) => save.mutate({ status: e.target.value as Application['status'] })} options={[...APPLICATION_STATUSES]} />
        ) : <Badge tone={TONE[r.status]}>{r.status}</Badge>}
      </td>
      <td className="p-2">
        {editable ? <Select className="h-8 w-36" value={r.papers} onChange={(e) => save.mutate({ papers: e.target.value as Application['papers'] })} options={[...PAPERS]} /> : r.papers}
      </td>
      <td className="p-2">
        <input type="checkbox" disabled={!editable} checked={r.carnet_given} onChange={(e) => save.mutate({ carnet_given: e.target.checked })} aria-label="اتسلم الكارنيه" />
      </td>
      <td className="p-2 text-muted">{fmtShort(r.created_at)}</td>
    </tr>
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

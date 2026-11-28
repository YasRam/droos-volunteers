import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PauseCircle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtShort } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { sdb, useCurrentTerm, useGrades, useGroups } from '@/lib/students'
import { supabase } from '@/lib/supabase'

interface Pause { id: string; from_date: string; to_date: string; reason: string | null; grade: string | null; group_id: string | null; slot_id: string | null }

/** Stop classes for a while: everything, a grade, a group, or one class (exams, holidays...). */
export function Pauses() {
  const qc = useQueryClient()
  const p = usePermissions()
  const canEdit = p.can('schedule.edit') || p.can('students.edit') || p.can('students.review')
  const term = useCurrentTerm()
  const groups = useGroups(term.data?.id)
  const [adding, setAdding] = useState(false)
  const q = useQuery({
    queryKey: ['students', 'pauses'],
    queryFn: async () => {
      const { data, error } = await sdb().from('schedule_pauses').select('*').order('from_date', { ascending: false })
      if (error) throw error
      return data as Pause[]
    },
  })
  const slots = useQuery({
    queryKey: ['pause-slots'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_slots').select('id, subject, grade, day')
      if (error) throw error
      return data as { id: string; subject: string; grade: string; day: string }[]
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sdb().from('schedule_pauses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الإيقاف اتشال، والحصص هترجع تظهر')
      qc.invalidateQueries({ queryKey: ['students', 'pauses'] })
    },
    onError: toastError,
  })
  const scope = (x: Pause) => {
    if (x.slot_id) {
      const s = slots.data?.find((s) => s.id === x.slot_id)
      return s ? `حصة ${s.subject} · ${s.grade} (${s.day})` : 'حصة'
    }
    if (x.group_id) return `مجموعة ${groups.data?.find((g) => g.id === x.group_id)?.name ?? ''}`
    if (x.grade) return `سنة ${x.grade}`
    return 'كل الحصص'
  }
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">الحصص اللي في فترة الإيقاف بتتلغي وأولياء الأمور بيوصلهم إشعار. السنة أو المجموعة بتوقف كل الحصص اللي لطلابها. لو شيلت الإيقاف الحصص الجاية بترجع.</p>
        {canEdit && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> إيقاف جديد
          </Button>
        )}
      </div>
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty title="مفيش إيقافات" /> : (
        <Card className="divide-y divide-line p-0">
          {q.data.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <PauseCircle className="size-5 text-orange-600" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{scope(x)}</p>
                <p className="text-xs text-muted">
                  {fmtShort(x.from_date)} ← {fmtShort(x.to_date)}
                  {x.reason ? ` · ${x.reason}` : ''}
                </p>
              </div>
              {x.to_date < today ? <Badge tone="gray">خلص</Badge> : x.from_date <= today ? <Badge tone="orange">شغال دلوقتي</Badge> : <Badge tone="brand">جاي</Badge>}
              {canEdit && (
                <button className="text-red-600" onClick={() => confirm('شيل الإيقاف ده؟') && remove.mutate(x.id)} aria-label="شيل">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
      {adding && <NewPause slots={slots.data ?? []} onClose={() => setAdding(false)} />}
    </div>
  )
}

function NewPause({ slots, onClose }: { slots: { id: string; subject: string; grade: string; day: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const grades = useGrades()
  const term = useCurrentTerm()
  const groups = useGroups(term.data?.id)
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ scope: 'grade', pick: '', from_date: today, to_date: today, reason: '' })
  const save = useMutation({
    mutationFn: async () => {
      if (f.scope !== 'all' && !f.pick) throw { message: 'اختار هتوقف إيه' }
      if (f.to_date < f.from_date) throw { message: 'النهاية قبل البداية' }
      const { error } = await sdb().from('schedule_pauses').insert({
        from_date: f.from_date,
        to_date: f.to_date,
        reason: f.reason.trim() || null,
        grade: f.scope === 'grade' ? f.pick : null,
        group_id: f.scope === 'group' ? f.pick : null,
        slot_id: f.scope === 'slot' ? f.pick : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتوقفت')
      qc.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: toastError,
  })
  const options =
    f.scope === 'grade' ? (grades.data ?? []).map((g) => ({ value: g, label: g }))
    : f.scope === 'group' ? (groups.data ?? []).map((g) => ({ value: g.id, label: g.grade ? `${g.grade} ← ${g.name}` : `عامة: ${g.name}` }))
    : f.scope === 'slot' ? slots.map((s) => ({ value: s.id, label: `${s.subject} · ${s.grade} (${s.day})` }))
    : []
  return (
    <Modal open onClose={onClose} title="إيقاف الحصص">
      <div className="space-y-3">
        <Field label="هتوقف إيه">
          <Select
            value={f.scope}
            onChange={(e) => setF({ ...f, scope: e.target.value, pick: '' })}
            options={[
              { value: 'grade', label: 'سنة دراسية' },
              { value: 'group', label: 'مجموعة' },
              { value: 'slot', label: 'حصة واحدة' },
              { value: 'all', label: 'كل الحصص' },
            ]}
          />
        </Field>
        {f.scope !== 'all' && (
          <Field label="اختار">
            <Select value={f.pick} onChange={(e) => setF({ ...f, pick: e.target.value })} placeholder="—" options={options} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="من">
            <Input type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value })} />
          </Field>
          <Field label="لحد">
            <Input type="date" value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} />
          </Field>
        </div>
        <Field label="السبب">
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="امتحانات، إجازة..." />
        </Field>
        <Button className="w-full" onClick={() => save.mutate()} loading={save.isPending}>
          حفظ
        </Button>
      </div>
    </Modal>
  )
}

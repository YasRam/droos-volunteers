import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Empty, PageHeader, Spinner, Tabs } from '@/components/ui'
import { fmtShort, fmtTime } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { sdb } from '@/lib/students'

type Tab = 'dismissals' | 'changes'

interface SlotRequest {
  id: string
  slot_id: string
  kind: string
  on_date: string | null
  new_date: string | null
  new_starts_at: string | null
  pause_from: string | null
  pause_to: string | null
  from_date: string | null
  reason: string | null
  requested_by: string
  requested_at: string
}
interface Dismissal { id: string; absences: number; review_note: string | null; created_at: string; enrollment: { student_id: string; grade: string; student: { full_name: string } } }
interface Change { id: string; student_id: string; changes: Record<string, { old: unknown; new: unknown }>; requested_at: string; student: { full_name: string } }

export default function StudentRequests() {
  const [tab, setTab] = useState<Tab>('dismissals')
  const q = useQuery({
    queryKey: ['students', 'requests'],
    queryFn: async () => {
      const [dm, ch] = await Promise.all([
        sdb().from('dismissal_requests').select('id, absences, review_note, created_at, enrollment:enrollments(student_id, grade, student:students(full_name))').eq('status', 'pending').order('created_at'),
        sdb().from('change_requests').select('id, student_id, changes, requested_at, student:students(full_name)').eq('status', 'pending').order('requested_at'),
      ])
      for (const r of [dm, ch]) if (r.error) throw r.error
      return {
        dismissals: dm.data as unknown as Dismissal[],
        changes: ch.data as unknown as Change[],
      }
    },
  })
  if (q.isLoading) return <Spinner />
  const d = q.data!
  return (
    <>
      <PageHeader title="طلبات الطلاب" subtitle="مفيش حاجة من دول بتتطبق قبل الموافقة. طلبات إلغاء وتأجيل الحصص في «الحصص» ← «الطلبات»." />
      <Tabs
        tabs={[
          { value: 'dismissals' as Tab, label: 'الفصل', count: d.dismissals.length },
          { value: 'changes' as Tab, label: 'تعديل البيانات', count: d.changes.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'dismissals' && (
        <p className="mb-3 rounded-xl bg-surface p-3 text-sm text-muted">
          الطلبات دي السيستم بيعملها لوحده لما غياب الطالب من غير عذر يوصل لحد الفصل اللي في الإعدادات (بعد التحذير). التنظيم بيقرر:
          «افصل» يخلّي حالته «مفصول» في الترم ده بس (يقدر يتقدّم الترم الجاي)، و«ميتفصلش» يقفل الطلب.
        </p>
      )}
      {tab === 'dismissals' && (!d.dismissals.length ? <Empty title="مفيش طلبات فصل" /> : (
        <div className="space-y-2">
          {d.dismissals.map((r) => (
            <Decide key={r.id} table="dismissal_requests" id={r.id} approve="افصل" reject="ميتفصلش">
              <Link to={`/students/${r.enrollment.student_id}`} className="font-semibold hover:underline">{r.enrollment.student.full_name}</Link>
              <p className="text-sm">{r.enrollment.grade} · {r.absences} غياب</p>
              {r.review_note && <p className="text-sm text-orange-700">{r.review_note}</p>}
              <p className="text-xs text-muted">لو فيه غياب بعذر، غيّره لـ «معتذر» من الحصة نفسها والطلب هيتشال لوحده.</p>
            </Decide>
          ))}
        </div>
      ))}
      {tab === 'changes' && (!d.changes.length ? <Empty title="مفيش طلبات تعديل" /> : (
        <div className="space-y-2">
          {d.changes.map((r) => (
            <Decide key={r.id} table="change_requests" id={r.id}>
              <Link to={`/students/${r.student_id}`} className="font-semibold hover:underline">{r.student.full_name}</Link>
              <ul className="text-sm">
                {Object.entries(r.changes).map(([k, v]) => <li key={k}>{k}: {String(v.old ?? '—')} ← <b>{String(v.new ?? '—')}</b></li>)}
              </ul>
              <p className="text-xs text-muted">من ولي الأمر · {fmtShort(r.requested_at)}. الموافقة بتسجّل الطلب، والتعديل نفسه من «تعديل» في ملف الطالب.</p>
            </Decide>
          ))}
        </div>
      ))}
    </>
  )
}

function Decide({ table, id, children, approve = 'موافقة', reject = 'رفض' }: { table: string; id: string; children: React.ReactNode; approve?: string; reject?: string }) {
  const qc = useQueryClient()
  const act = useMutation({
    mutationFn: async (status: 'approved' | 'rejected') => {
      const { error } = await sdb().from(table).update({ status }).eq('id', id)
      if (error) throw error
      return status
    },
    onSuccess: (s) => {
      toast.success(s === 'approved' ? 'اتوافق واتطبق' : 'اترفض')
      qc.invalidateQueries({ queryKey: ['students'] })
    },
    onError: toastError,
  })
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
      <div className="flex gap-2">
        <Button size="sm" variant="success" loading={act.isPending && act.variables === 'approved'} onClick={() => act.mutate('approved')}>{approve}</Button>
        <Button size="sm" variant="secondary" loading={act.isPending && act.variables === 'rejected'} onClick={() => act.mutate('rejected')}>{reject}</Button>
      </div>
    </Card>
  )
}

/** Cancel / postpone / pause requests on the classes (shown in الحصص ← الطلبات). */
export function SlotRequests() {
  const q = useQuery({
    queryKey: ['students', 'slot-requests'],
    queryFn: async () => {
      const [slots, sr] = await Promise.all([
        supabase.from('schedule_slots').select('id, subject, grade, day, starts_at'),
        sdb().from('slot_requests').select('*').eq('status', 'pending').order('requested_at'),
      ])
      if (sr.error) throw sr.error
      return {
        slots: new Map(((slots.data ?? []) as { id: string; subject: string; grade: string; day: string; starts_at: string }[]).map((s) => [s.id, s])),
        classes: sr.data as SlotRequest[],
      }
    },
  })
  if (q.isLoading) return <Spinner />
  const d = q.data!
  return (
    <>
      {(!d.classes.length ? <Empty title="مفيش طلبات حصص" /> : (
        <div className="space-y-2">
          {d.classes.map((r) => {
            const s = d.slots.get(r.slot_id)
            const what =
              r.kind === 'إلغاء مرة' ? `إلغاء حصة ${fmtShort(r.on_date)}`
              : r.kind === 'تأجيل' ? `تأجيل حصة ${fmtShort(r.on_date)} لـ ${fmtShort(r.new_date)} ${fmtTime(r.new_starts_at)}`
              : r.kind === 'إيقاف' ? `إيقاف من ${fmtShort(r.pause_from)} لـ ${fmtShort(r.pause_to)}`
              : `إلغاء الحصة خالص من ${fmtShort(r.from_date)}`
            return (
              <Decide key={r.id} table="slot_requests" id={r.id}>
                <p className="font-semibold">{s ? `${s.subject} · ${s.grade} · ${s.day} ${fmtTime(s.starts_at)}` : 'حصة'}</p>
                <p className="text-sm">{what}{r.reason ? ` · ${r.reason}` : ''}</p>
                <p className="text-xs text-muted">من {r.requested_by} · {fmtShort(r.requested_at)}</p>
              </Decide>
            )
          })}
        </div>
      ))}
    </>
  )
}

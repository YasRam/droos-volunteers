import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Data = Record<string, string | undefined>
interface Row {
  id: string
  created_at: string
  volunteer_id: string
  code: string
  data: Data
  prev_data: Data
  volunteer_status: string
  acceptance: string | null
  recruit_status: string | null
  out_reason: string | null
  hr_notes: string | null
  interview_date: string | null
  follow_notes: string[] | null
  participations: number
  last_activity: string | null
  registered_at: string | null
  history: { at: string; kind: string; outcome: string | null; notes: string | null }[]
  earlier_requests: number
}

const LABELS: [string, string][] = [
  ['full_name_ar', 'الاسم'],
  ['full_name_en', 'الاسم بالإنجليزي'],
  ['phone', 'الموبايل'],
  ['whatsapp', 'الواتساب'],
  ['email', 'الإيميل'],
  ['qualification', 'المؤهل'],
  ['job', 'الشغل'],
  ['area', 'المنطقة'],
  ['study_year', 'السنة الدراسية'],
  ['availability_notes', 'المواعيد المناسبة'],
  ['referral_source', 'عرف النشاط منين'],
  ['facebook', 'فيسبوك'],
]
const CLOSED = ['مرفوض', 'مفصول', 'معتذر نهائى', 'معتذر نهائي']

/** People already in the system who filled the join form again: old vs new data, and why they left if they did. */
export function JoinRequests() {
  const p = usePermissions()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['registration-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('registration_requests_list')
      if (error) throw error
      return data as Row[]
    },
  })
  const review = useMutation({
    mutationFn: async (a: { id: string; approve: boolean; reopen: boolean }) => {
      const { error } = await supabase.rpc('review_registration', { p_id: a.id, p_approve: a.approve, p_reopen: a.reopen })
      if (error) throw error
      return a.approve
    },
    onSuccess: (approve) => {
      toast.success(approve ? 'البيانات الجديدة اتحفظت' : 'اترفض، والبيانات القديمة زي ما هي')
      qc.invalidateQueries({ queryKey: ['registration-requests'] })
      qc.invalidateQueries({ queryKey: ['pending-count'] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="مفيش حد سجّل تاني">لما حد موجود قبل كده (نفس الرقم القومي) يملأ فورم التسجيل، طلبه بيظهر هنا.</Empty>
  return (
    <div className="space-y-4">
      {q.data.map((r) => (
        <RequestCard key={r.id} r={r} canEdit={p.can('hr.edit')} busy={review.isPending} onReview={(approve, reopen) => review.mutate({ id: r.id, approve, reopen })} />
      ))}
    </div>
  )
}

function RequestCard({ r, canEdit, busy, onReview }: { r: Row; canEdit: boolean; busy: boolean; onReview: (approve: boolean, reopen: boolean) => void }) {
  const closed = r.volunteer_status === 'خارج المتابعة' || r.recruit_status === 'مقفول' || CLOSED.includes(r.acceptance ?? '')
  const [reopen, setReopen] = useState(closed)
  const changed = LABELS.filter(([k]) => r.data[k] && r.data[k] !== r.prev_data[k])
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <VolunteerName id={r.volunteer_id} name={r.prev_data.full_name_ar ?? r.code} className="font-bold" />
        <span className="text-xs text-muted">{r.code} · سجّل {fmtDate(r.created_at)}</span>
        <Badge tone={r.volunteer_status === 'خارج المتابعة' ? 'gray' : 'green'}>{r.volunteer_status}</Badge>
        {r.acceptance && <Badge tone={CLOSED.includes(r.acceptance) ? 'red' : 'brand'}>{r.acceptance}</Badge>}
      </div>

      {/* Who this person is to us */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Fact label="متسجل من">{r.registered_at ? fmtDate(r.registered_at) : '—'}</Fact>
        <Fact label="المشاركات">{r.participations ? `${r.participations} · آخرها ${r.last_activity ? fmtDate(r.last_activity) : '—'}` : 'ولا مشاركة'}</Fact>
        <Fact label="الانترفيو">{r.interview_date ? `${fmtDate(r.interview_date)} · ${r.acceptance ?? '—'}` : 'لسه'}</Fact>
        <Fact label="قايمة الجداد">{r.recruit_status ?? '—'}{r.earlier_requests ? ` · سجّل تاني ${r.earlier_requests} مرة قبل كده` : ''}</Fact>
      </div>

      <div className={clsx('mt-3 space-y-1.5 rounded-xl p-3 text-sm', closed ? 'bg-orange-50' : 'bg-surface')}>
        <p className={clsx('font-bold', closed ? 'text-orange-800' : 'text-ink')}>ملاحظات عليه</p>
        {r.out_reason && <p>• سبب الخروج: <b>{r.out_reason}</b></p>}
        {r.hr_notes && <p>• ملاحظات الـ HR: {r.hr_notes}</p>}
        {(r.follow_notes ?? []).map((n, i) => (
          <p key={i}>• ملاحظة متابعة: {n}</p>
        ))}
        {r.history.map((h, i) => (
          <p key={i}>
            • {h.kind === 'call' ? 'مكالمة' : h.kind === 'interview' ? 'انترفيو' : 'رجوع للتواصل'}: <b>{h.outcome ?? '—'}</b>
            {h.notes ? ` — ${h.notes}` : ''} <span className="text-xs text-muted">({fmtDate(h.at)})</span>
          </p>
        ))}
        {!r.out_reason && !r.hr_notes && !(r.follow_notes ?? []).length && !r.history.length && <p className="text-muted">مفيش أي ملاحظات متسجلة عليه</p>}
      </div>

      <div className="mt-3 overflow-x-auto">
        <p className="mb-1 text-sm font-bold">البيانات {changed.length ? `(اتغير ${changed.length})` : '(متغيرش حاجة)'}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 text-start font-semibold">الخانة</th>
              <th className="py-1 text-start font-semibold">اللي عندنا</th>
              <th className="py-1 text-start font-semibold">اللي كتبه دلوقتي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {LABELS.filter(([k]) => r.data[k] || r.prev_data[k]).map(([k, label]) => {
              const diff = Boolean(r.data[k]) && r.data[k] !== r.prev_data[k]
              return (
                <tr key={k} className={diff ? 'bg-amber-50' : undefined}>
                  <td className="py-1.5 pe-3 text-muted">{label}</td>
                  <td className={clsx('py-1.5 pe-3', diff && 'text-red-700')}>{r.prev_data[k] || '—'}</td>
                  <td className={clsx('py-1.5', diff ? 'font-semibold text-emerald-700' : 'text-muted')}>{r.data[k] || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {closed && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-700" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />
              رجّعه لقايمة «للتواصل»
            </label>
          )}
          <div className="ms-auto flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onReview(false, false)}>
              رفض
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onReview(true, closed && reopen)}>
              وافق على الجديد
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold">{children}</p>
    </div>
  )
}

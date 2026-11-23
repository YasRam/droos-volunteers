import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, X } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Button, Card, Empty, PageHeader, Spinner } from '@/components/ui'
import { fmtShort, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Participation } from '@/lib/types'

const describe = (r: Participation) =>
  [r.event, r.subject, r.grade, r.beneficiaries ? `${r.beneficiaries} طالب` : null].filter(Boolean).join(' · ')

/** Attendance requests. Each one shows what is already accepted for the same person on the same day. */
export default function Requests() {
  const qc = useQueryClient()
  const dir = useDirectory()
  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])
  const q = useQuery({
    queryKey: ['pending'],
    queryFn: async () => {
      const { data, error } = await supabase.from('participations').select('*').eq('status', 'pending').order('created_at')
      if (error) throw error
      const pending = data as Participation[]
      if (!pending.length) return { pending, sameDay: new Map<string, Participation[]>() }
      const dates = [...new Set(pending.map((r) => r.activity_date))]
      const ids = [...new Set(pending.map((r) => r.volunteer_id))]
      const acc = await supabase.from('participations').select('*').eq('status', 'accepted').in('activity_date', dates).in('volunteer_id', ids)
      if (acc.error) throw acc.error
      const sameDay = new Map<string, Participation[]>()
      for (const a of acc.data as Participation[]) {
        const k = a.volunteer_id + a.activity_date
        sameDay.set(k, [...(sameDay.get(k) ?? []), a])
      }
      return { pending, sameDay }
    },
  })
  const review = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: 'accepted' | 'rejected' }) => {
      const { error } = await supabase.from('participations').update({ status }).in('id', ids)
      if (error) throw error
      return status
    },
    onSuccess: (status) => {
      toast.success(status === 'accepted' ? 'اتقبل' : 'اترفض')
      qc.invalidateQueries({ queryKey: ['pending'] })
      qc.invalidateQueries({ queryKey: ['pending-count'] })
    },
    onError: toastError,
  })

  const rows = q.data?.pending ?? []
  return (
    <>
      <PageHeader title="طلبات الحضور" subtitle="تحت كل طلب بيظهر اللي اتقبل للشخص ده في نفس اليوم" />
      {q.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش طلبات مستنية" />
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Button variant="success" size="sm" loading={review.isPending} onClick={() => review.mutate({ ids: rows.map((r) => r.id), status: 'accepted' })}>
              <Check className="size-4" /> قبول الكل ({rows.length})
            </Button>
          </div>
          <Card className="divide-y divide-line p-0">
            {rows.map((r) => {
              const same = q.data?.sameDay.get(r.volunteer_id + r.activity_date) ?? []
              return (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        <VolunteerName id={r.volunteer_id} name={names.get(r.volunteer_id)} />
                      </p>
                      <p className="text-xs text-muted">
                        {fmtShort(r.activity_date)} · {describe(r)}
                      </p>
                      {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="success" onClick={() => review.mutate({ ids: [r.id], status: 'accepted' })}>
                        <Check className="size-4" /> قبول
                      </Button>
                      <Button size="sm" variant="secondary" className="text-red-600" onClick={() => review.mutate({ ids: [r.id], status: 'rejected' })}>
                        <X className="size-4" /> رفض
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 rounded-xl bg-surface px-3 py-2 text-xs">
                    {same.length ? (
                      <>
                        <p className="mb-1 font-bold text-emerald-700">متقبل له في نفس اليوم ({same.length}):</p>
                        <ul className="space-y-0.5">
                          {same.map((a) => (
                            <li key={a.id} className="flex items-center gap-1.5">
                              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                              {describe(a)}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-muted">مفيش حاجة متقبلة له في اليوم ده</p>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>
        </>
      )}
    </>
  )
}

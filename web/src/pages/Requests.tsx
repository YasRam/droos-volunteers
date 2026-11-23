import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '@/components/ui'
import { fmtShort, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Participation } from '@/lib/types'

const describe = (r: Participation) => [r.event, r.subject, r.grade, r.beneficiaries ? `${r.beneficiaries} طالب` : null].filter(Boolean).join(' · ')

/** Attendance requests. Each one shows what's already accepted for that person on that day. */
export default function Requests() {
  const qc = useQueryClient()
  const dir = useDirectory()
  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])
  const q = useQuery({
    queryKey: ['pending'],
    queryFn: async () => {
      const { data, error } = await supabase.from('participations').select('*').eq('status', 'pending').order('activity_date').order('created_at')
      if (error) throw error
      const pending = data as Participation[]
      const sameDay = new Map<string, Participation[]>()
      if (!pending.length) return { pending, sameDay }
      // accepted participations of the same people on the same days
      const { data: acc, error: e2 } = await supabase
        .from('participations')
        .select('*')
        .eq('status', 'accepted')
        .in('volunteer_id', [...new Set(pending.map((p) => p.volunteer_id))])
        .in('activity_date', [...new Set(pending.map((p) => p.activity_date))])
      if (e2) throw e2
      for (const a of acc as Participation[]) {
        const k = `${a.volunteer_id}|${a.activity_date}`
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
      qc.invalidateQueries({ queryKey: ['followups'] })
    },
    onError: toastError,
  })

  const pending = q.data?.pending ?? []
  return (
    <>
      <PageHeader title="طلبات الحضور" subtitle="المتطوعين اللي سجّلوا حضورهم بنفسهم ومستنيين موافقة" />
      {q.isLoading ? (
        <Spinner />
      ) : !pending.length ? (
        <Empty title="مفيش طلبات مستنية" />
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Button variant="success" size="sm" loading={review.isPending} onClick={() => review.mutate({ ids: pending.map((r) => r.id), status: 'accepted' })}>
              <Check className="size-4" /> قبول الكل ({pending.length})
            </Button>
          </div>
          <Card className="divide-y divide-line p-0">
            {pending.map((r) => {
              const already = q.data?.sameDay.get(`${r.volunteer_id}|${r.activity_date}`) ?? []
              return (
                <div key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-semibold">
                      <VolunteerName id={r.volunteer_id} name={names.get(r.volunteer_id)} />
                    </p>
                    <p className="text-sm">
                      {fmtShort(r.activity_date)} · {describe(r)}
                    </p>
                    {r.notes && <p className="mt-1 text-xs text-muted">{r.notes}</p>}
                    {already.length > 0 && (
                      <div className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
                        <p className="font-semibold">متسجل له في نفس اليوم ومتقبل:</p>
                        {already.map((a) => (
                          <p key={a.id} className="mt-0.5">
                            <Badge tone="green">مقبول</Badge> {describe(a)}
                          </p>
                        ))}
                      </div>
                    )}
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
              )
            })}
          </Card>
        </>
      )}
    </>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Button, Card, Empty, Field, Input, PageHeader, RequestBadge, Select, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { addDays, cairoToday, fmtShort, useDirectory, useLookups } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Participation } from '@/lib/types'

export default function FollowUps() {
  const p = usePermissions()
  const qc = useQueryClient()
  const today = cairoToday()
  const lookups = useLookups()
  const dir = useDirectory()
  const [from, setFrom] = useState(addDays(today, -7))
  const [to, setTo] = useState(today)
  const [event, setEvent] = useState('')
  const [status, setStatus] = useState('')

  const q = useQuery({
    queryKey: ['followups', from, to, event, status],
    queryFn: async () => {
      let query = supabase.from('participations').select('*').gte('activity_date', from).lte('activity_date', to).order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
      if (event) query = query.eq('event', event)
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw error
      return data as Participation[]
    },
  })
  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('participations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتمسحت')
      qc.invalidateQueries({ queryKey: ['followups'] })
    },
    onError: toastError,
  })

  const byDay = useMemo(() => {
    const m = new Map<string, Participation[]>()
    for (const r of q.data ?? []) m.set(r.activity_date, [...(m.get(r.activity_date) ?? []), r])
    return [...m.entries()]
  }, [q.data])

  return (
    <>
      <PageHeader title="المتابعة اليومية" subtitle={p.full ? undefined : 'آخر 7 أيام'} />
      <Card className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="من">
          <Input type="date" value={from} min={p.full ? undefined : addDays(today, -7)} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="إلى">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="الحدث">
          <Select value={event} onChange={(e) => setEvent(e.target.value)} placeholder="الكل" options={lookups.data?.list('الحدث') ?? []} />
        </Field>
        <Field label="الحالة">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="الكل"
            options={[
              { value: 'accepted', label: 'مقبول' },
              { value: 'pending', label: 'مستني موافقة' },
              { value: 'rejected', label: 'مرفوض' },
            ]}
          />
        </Field>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : !byDay.length ? (
        <Empty title="مفيش مشاركات في الفترة دي" />
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-bold text-muted">
                {fmtShort(day)} · {rows.length}
              </h2>
              <Card className="divide-y divide-line p-0">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold"><VolunteerName id={r.volunteer_id} name={names.get(r.volunteer_id)} /></p>
                      <p className="truncate text-xs text-muted">
                        {r.event}
                        {r.subject && ` · ${r.subject}`}
                        {r.grade && ` · ${r.grade}`}
                        {r.beneficiaries && ` · ${r.beneficiaries} طالب`}
                        {r.method === 'group' && ' · جماعي'}
                      </p>
                    </div>
                    <RequestBadge status={r.status} />
                    {p.full && (
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm('مسح المشاركة دي؟') && remove.mutate(r.id)} aria-label="مسح">
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

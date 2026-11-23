import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Button, Card, Empty, PageHeader, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtShort, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Participation, VolunteerPrivate } from '@/lib/types'

export default function Requests() {
  const p = usePermissions()
  const location = useLocation()
  const [tab, setTab] = useState<'attendance' | 'nid'>(location.pathname.endsWith('national-id') && p.full ? 'nid' : 'attendance')
  return (
    <>
      <PageHeader title="الطلبات" />
      {p.full && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'attendance', label: 'طلبات الحضور' },
            { value: 'nid', label: 'تغيير الرقم القومي' },
          ]}
        />
      )}
      {tab === 'attendance' ? <Attendance /> : <NationalIds />}
    </>
  )
}

function Attendance() {
  const qc = useQueryClient()
  const dir = useDirectory()
  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])
  const q = useQuery({
    queryKey: ['pending'],
    queryFn: async () => {
      const { data, error } = await supabase.from('participations').select('*').eq('status', 'pending').order('created_at')
      if (error) throw error
      return data as Participation[]
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

  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="مفيش طلبات مستنية" />
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="success" size="sm" loading={review.isPending} onClick={() => review.mutate({ ids: q.data!.map((r) => r.id), status: 'accepted' })}>
          <Check className="size-4" /> قبول الكل ({q.data.length})
        </Button>
      </div>
      <Card className="divide-y divide-line p-0">
        {q.data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold"><VolunteerName id={r.volunteer_id} name={names.get(r.volunteer_id)} /></p>
              <p className="text-xs text-muted">
                {fmtShort(r.activity_date)} · {r.event}
                {r.subject && ` · ${r.subject}`}
                {r.grade && ` · ${r.grade}`}
                {r.beneficiaries && ` · ${r.beneficiaries} طالب`}
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
        ))}
      </Card>
    </>
  )
}

function NationalIds() {
  const qc = useQueryClient()
  const dir = useDirectory()
  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])
  const q = useQuery({
    queryKey: ['nid-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_private').select('*').not('requested_national_id', 'is', null).order('requested_at')
      if (error) throw error
      return data as VolunteerPrivate[]
    },
  })
  const review = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_national_id', { p_volunteer_id: id, p_approve: approve })
      if (error) throw error
      return approve
    },
    onSuccess: (approve) => {
      toast.success(approve ? 'الرقم القومي اتغيّر' : 'الطلب اترفض')
      qc.invalidateQueries({ queryKey: ['nid-requests'] })
    },
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="مفيش طلبات تغيير رقم قومي" />
  return (
    <Card className="divide-y divide-line p-0">
      {q.data.map((r) => (
        <div key={r.volunteer_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold"><VolunteerName id={r.volunteer_id} name={names.get(r.volunteer_id)} /></p>
            <p className="text-xs text-muted">
              الحالي <span className="ltr">{r.national_id ?? '—'}</span> ← المطلوب <span className="ltr font-semibold text-ink">{r.requested_national_id}</span>
            </p>
          </div>
          <Button size="sm" variant="success" onClick={() => review.mutate({ id: r.volunteer_id, approve: true })}>
            موافقة
          </Button>
          <Button size="sm" variant="secondary" className="text-red-600" onClick={() => review.mutate({ id: r.volunteer_id, approve: false })}>
            رفض
          </Button>
        </div>
      ))}
    </Card>
  )
}

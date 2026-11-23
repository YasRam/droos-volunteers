import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, RequestBadge, Select, Spinner } from '@/components/ui'
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

  // One block per person, most active first
  const byPerson = useMemo(() => {
    const m = new Map<string, Participation[]>()
    for (const r of q.data ?? []) m.set(r.volunteer_id, [...(m.get(r.volunteer_id) ?? []), r])
    return [...m.entries()]
      .map(([id, rows]) => ({ id, rows, days: new Set(rows.map((r) => r.activity_date)).size }))
      .sort((a, b) => b.days - a.days || b.rows.length - a.rows.length || (names.get(a.id) ?? '').localeCompare(names.get(b.id) ?? '', 'ar'))
  }, [q.data, names])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

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
      ) : !byPerson.length ? (
        <Empty title="مفيش مشاركات في الفترة دي" />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {byPerson.length} متطوع · {q.data?.length} مشاركة · مترتبين بعدد الأيام
          </p>
          <Card className="divide-y divide-line p-0">
            {byPerson.map(({ id, rows, days }) => (
              <div key={id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => toggle(id)} className="text-muted" aria-label="التفاصيل">
                    <ChevronDown className={clsx('size-5 transition', open.has(id) && 'rotate-180')} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      <VolunteerName id={id} name={names.get(id)} />
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[...new Set(rows.map((r) => r.event))].join('، ')} · آخر مرة {fmtShort(rows[0].activity_date)}
                    </p>
                  </div>
                  <Badge tone="brand">{days} يوم</Badge>
                  <Badge tone="green">{rows.length} مشاركة</Badge>
                  {rows.some((r) => r.status === 'pending') && <Badge tone="orange">فيه طلب مستني</Badge>}
                </div>
                {open.has(id) && (
                  <div className="divide-y divide-line border-t border-line bg-surface/50">
                    {rows.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 py-2 pe-4 ps-12">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            <span className="font-semibold">{fmtShort(r.activity_date)}</span> · {r.event}
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
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  )
}

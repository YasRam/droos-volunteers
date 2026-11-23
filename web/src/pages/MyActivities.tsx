import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Card, Empty, PageHeader, RequestBadge, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtShort } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import type { Participation } from '@/lib/types'

const monthFmt = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' })

export default function MyActivities() {
  const { volunteerId } = usePermissions()
  const q = useQuery({
    queryKey: ['my-activities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('participations')
        .select('*')
        .eq('volunteer_id', volunteerId!)
        .order('activity_date', { ascending: false })
      if (error) throw error
      return data as Participation[]
    },
  })

  const months = useMemo(() => {
    const groups = new Map<string, Participation[]>()
    for (const p of q.data ?? []) {
      const key = p.activity_date.slice(0, 7)
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    return [...groups.entries()]
  }, [q.data])

  const accepted = q.data?.filter((p) => p.status === 'accepted').length ?? 0

  return (
    <>
      <PageHeader title="أنشطتي" subtitle={q.data ? `${accepted} مشاركة مقبولة من ${q.data.length}` : undefined} />
      {q.isLoading ? (
        <Spinner />
      ) : !months.length ? (
        <Empty title="لسه مفيش مشاركات">أول ما تسجّل "حضرت النهارده" هتظهر هنا.</Empty>
      ) : (
        <div className="space-y-5">
          {months.map(([month, rows]) => (
            <section key={month}>
              <h2 className="mb-2 text-sm font-bold text-muted">
                {monthFmt.format(new Date(month + '-01T00:00:00'))} · {rows.filter((r) => r.status === 'accepted').length} مشاركة
              </h2>
              <Card className="divide-y divide-line p-0">
                {rows.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {p.event}
                        {p.subject && <span className="text-muted"> · {p.subject}</span>}
                        {p.grade && <span className="text-muted"> · {p.grade}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {fmtShort(p.activity_date)}
                        {p.place && ` · ${p.place}`}
                        {p.beneficiaries && ` · ${p.beneficiaries} طالب`}
                      </p>
                    </div>
                    <RequestBadge status={p.status} />
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

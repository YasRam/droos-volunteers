import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Badge, Card, StatusBadge } from './ui'
import { useParticipationSummary } from '@/lib/certificates'
import { ageFrom, fmtDate } from '@/lib/data'
import type { Volunteer } from '@/lib/types'

const MONTH = 30.44 * 864e5

function since(date?: string | null) {
  if (!date) return null
  const months = Math.floor((Date.now() - Date.parse(date)) / MONTH)
  if (months < 1) return 'أقل من شهر'
  if (months < 12) return `${months} ${months <= 10 ? 'شهور' : 'شهر'}`
  const y = Math.floor(months / 12)
  const m = months % 12
  return `${y} ${y === 1 ? 'سنة' : y === 2 ? 'سنتين' : 'سنين'}${m ? ` و${m} ${m <= 10 ? 'شهور' : 'شهر'}` : ''}`
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-end font-semibold">{children ?? '—'}</dd>
    </div>
  )
}

/**
 * Everything the system knows or works out about a volunteer: job, status, committees,
 * birth date / age / gender (from the national ID), time in the activity, camps, t-shirt,
 * and the participation totals.
 */
export function VolunteerFacts({ v }: { v: Volunteer }) {
  const summary = useParticipationSummary(v.id)
  const age = ageFrom(v.birth_date)
  const s = summary.data
  const p = usePermissions()
  const hr = useQuery({
    queryKey: ['volunteer-hr-facts', v.id],
    enabled: p.can('hr.view'),
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_hr_read').select('interview_date, interviewer, interviewer_id, acceptance').eq('volunteer_id', v.id).maybeSingle()
      if (error) throw error
      if (!data?.interviewer_id) return data
      const { data: who } = await supabase.from('volunteer_directory').select('full_name_ar').eq('id', data.interviewer_id).maybeSingle()
      return { ...data, interviewer: who?.full_name_ar ?? data.interviewer }
    },
  })
  const lastAgo = s?.last_date ? Math.floor((Date.now() - Date.parse(s.last_date)) / 864e5) : null

  return (
    <Card>
      <p className="mb-1 font-bold">في النشاط</p>
      <dl className="divide-y divide-line text-sm">
        <Row label="الكود">
          <span className="ltr">{v.code}</span>
        </Row>
        <Row label="الوظيفة">
          <Badge tone="brand">{v.position}</Badge>
        </Row>
        <Row label="الحالة">
          <StatusBadge status={v.status} />
        </Row>
        <Row label="اللجنة">
          {v.main_committee ?? '—'}
          {v.sub_committee && <span className="text-muted"> + {v.sub_committee}</span>}
        </Row>
        <Row label="تاريخ الميلاد">{v.birth_date ? `${fmtDate(v.birth_date)} (${age} سنة)` : 'مش معروف (مفيش رقم قومي)'}</Row>
        <Row label="النوع">{v.gender ?? '—'}</Row>
        <Row label="اتسجل">{`${fmtDate(v.registered_at)} · من ${since(v.registered_at)}`}</Row>
        {p.can('hr.view') && (
          <Row label="الانترفيو">
            {hr.data?.interview_date ? `${fmtDate(hr.data.interview_date)}${hr.data.interviewer ? ' · ' + hr.data.interviewer : ''}${hr.data.acceptance ? ' · ' + hr.data.acceptance : ''}` : 'لسه'}
          </Row>
        )}
        <Row label="الميني كامب">{v.attended_minicamp ? `حضر${v.minicamp_date ? ' ' + fmtDate(v.minicamp_date) : ''}` : 'لسه'}</Row>
        <Row label="الكامب">{v.attended_camp ? `حضر${v.camp_date ? ' ' + fmtDate(v.camp_date) : ''}` : 'لسه'}</Row>
        <Row label="حفلة التخرج">{v.attended_graduation ? `حضر${v.graduation_date ? ' ' + fmtDate(v.graduation_date) : ''}` : 'لسه'}</Row>
        <Row label="التيشيرت">{v.bought_tshirt ? 'اشترى' : 'لسه'}</Row>
      </dl>

      <p className="mb-1 mt-4 font-bold">المشاركات</p>
      {summary.isLoading ? (
        <p className="text-sm text-muted">بيحمّل...</p>
      ) : !s || !s.total ? (
        <p className="text-sm text-muted">مفيش مشاركات مقبولة لسه</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-emerald-50 py-2">
              <p className="text-lg font-bold text-emerald-700">{s.total}</p>
              <p className="text-xs text-muted">مشاركة</p>
            </div>
            <div className="rounded-xl bg-brand-50 py-2">
              <p className="text-lg font-bold text-brand-700">{s.days}</p>
              <p className="text-xs text-muted">يوم</p>
            </div>
            <div className="rounded-xl bg-surface py-2">
              <p className="text-lg font-bold">{s.beneficiaries}</p>
              <p className="text-xs text-muted">طالب</p>
            </div>
          </div>
          <dl className="mt-2 divide-y divide-line text-sm">
            <Row label="أول مشاركة">{fmtDate(s.first_date)}</Row>
            <Row label="آخر مشاركة">
              {fmtDate(s.last_date)}
              {lastAgo !== null && <span className={lastAgo > 30 ? 'text-orange-600' : 'text-muted'}> ({lastAgo === 0 ? 'النهارده' : `من ${lastAgo} يوم`})</span>}
            </Row>
            {s.by_event.map((e) => (
              <Row key={e.event} label={e.event}>
                {e.count} <span className="font-normal text-muted">في {e.days} يوم</span>
              </Row>
            ))}
          </dl>
        </>
      )}
    </Card>
  )
}

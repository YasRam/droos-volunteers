import { useQuery } from '@tanstack/react-query'
import { MessageCircle, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, Empty, PageHeader, Select, Spinner, Stat, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { addDays, cairoToday, fmtShort, useVolunteers, whatsappLink } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import type { MonthlyParticipation } from '@/lib/types'

type Tab = 'overview' | 'top' | 'responsible' | 'inactive' | 'birthdays'
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

export default function Stats() {
  const p = usePermissions()
  const [params, setParams] = useSearchParams()
  const tabs = [
    ...(p.staff || p.viewAll ? [{ value: 'overview' as Tab, label: 'نظرة عامة' }] : []),
    ...(p.can('stats.view') || p.leader ? [{ value: 'top' as Tab, label: 'الأكتر مشاركة' }] : []),
    ...(p.viewAll ? [{ value: 'responsible' as Tab, label: 'المسئولين والمشروع' }] : []),
    ...(p.viewAll ? [{ value: 'inactive' as Tab, label: 'مش بيشاركوا' }] : []),
    ...(p.viewAll || p.leader ? [{ value: 'birthdays' as Tab, label: 'أعياد الميلاد' }] : []),
  ]
  const tab = (tabs.find((t) => t.value === params.get('tab'))?.value ?? tabs[0]?.value) as Tab
  return (
    <>
      <PageHeader title="الإحصائيات" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'overview' && <Overview />}
      {tab === 'top' && <TopParticipants />}
      {tab === 'responsible' && <Responsible />}
      {tab === 'inactive' && <Inactive />}
      {tab === 'birthdays' && <Birthdays />}
    </>
  )
}

function Overview() {
  const p = usePermissions()
  const thisMonth = cairoToday().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const q = useQuery({
    queryKey: ['monthly'],
    queryFn: async () => {
      const { data, error } = await supabase.from('monthly_participation').select('*')
      if (error) throw error
      return data as MonthlyParticipation[]
    },
  })
  const byMonth = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of q.data ?? []) m.set(r.month, (m.get(r.month) ?? 0) + Number(r.participations))
    return [...m.entries()].sort().slice(-12).map(([k, v]) => ({ month: monthLabel(k), key: k, value: v }))
  }, [q.data])
  const inMonth = (q.data ?? []).filter((r) => r.month === month)
  const sumBy = (key: 'event' | 'committee') => {
    const m = new Map<string, number>()
    for (const r of inMonth) m.set(r[key], (m.get(r[key]) ?? 0) + Number(r.participations))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  }
  const total = inMonth.reduce((s, r) => s + Number(r.participations), 0)
  const prevKey = byMonth.at(-2)?.key
  const prev = byMonth.find((b) => b.key === prevKey)?.value

  if (q.isLoading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={`مشاركات ${monthLabel(month)}`} value={total} />
        {prev !== undefined && month === thisMonth && <Stat label="الشهر اللي فات" value={prev} tone="green" />}
      </div>
      <Card>
        <p className="mb-1 font-bold">المشاركات المقبولة كل شهر</p>
        <p className="mb-3 text-xs text-muted">اضغط على شهر عشان تشوف تفاصيله تحت</p>
        <div className="h-64" dir="ltr">
          <ResponsiveContainer>
            <BarChart data={byMonth} onClick={(e) => e?.activeLabel && setMonth(byMonth.find((b) => b.month === e.activeLabel)?.key ?? month)}>
              <CartesianGrid vertical={false} stroke="#e3e8ec" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'IBM Plex Sans Arabic' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
              <Tooltip formatter={(v) => [v, 'مشاركة']} labelStyle={{ fontFamily: 'IBM Plex Sans Arabic' }} />
              <Bar dataKey="value" fill="#00838f" radius={[6, 6, 0, 0]} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {p.viewAll && <NewVolunteers />}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">الشهر:</span>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} options={byMonth.map((b) => ({ value: b.key, label: b.month }))} className="w-40" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <HBars title="حسب الحدث" rows={sumBy('event')} color="#00acc1" />
        <HBars title="حسب اللجنة" rows={sumBy('committee')} color="#2e7d32" />
      </div>
    </div>
  )
}

/** How many volunteers registered each month, the last 12 months. */
function NewVolunteers() {
  const vols = useVolunteers()
  const data = useMemo(() => {
    const start = addDays(cairoToday().slice(0, 7) + '-01', -335).slice(0, 7)
    const m = new Map<string, number>()
    for (const v of vols.data ?? []) {
      const k = v.registered_at?.slice(0, 7)
      if (k && k >= start) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort().map(([k, value]) => ({ month: monthLabel(k), value }))
  }, [vols.data])
  if (!vols.data) return null
  return (
    <Card>
      <p className="mb-1 font-bold">المتطوعين الجداد كل شهر</p>
      <p className="mb-3 text-xs text-muted">حسب تاريخ التسجيل، آخر 12 شهر</p>
      <div className="h-56" dir="ltr">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke="#e3e8ec" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'IBM Plex Sans Arabic' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
            <Tooltip formatter={(v) => [v, 'متطوع جديد']} labelStyle={{ fontFamily: 'IBM Plex Sans Arabic' }} />
            <Bar dataKey="value" fill="#1e88e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function HBars({ title, rows, color }: { title: string; rows: { name: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <Card>
      <p className="mb-3 font-bold">{title}</p>
      {!rows.length ? (
        <p className="text-sm text-muted">مفيش مشاركات</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name} className="text-sm">
              <div className="mb-0.5 flex justify-between">
                <span>{r.name}</span>
                <span className="font-semibold">{r.value}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Responsible() {
  const vols = useVolunteers()
  const rows = (vols.data ?? [])
    .filter((v) => v.status === 'مسئول' || v.status === 'مشروع مسئول')
    .sort((a, b) => (b.stats?.this_month ?? 0) - (a.stats?.this_month ?? 0))
  if (vols.isLoading) return <Spinner />
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface text-muted">
          <tr>
            <th className="px-4 py-2 text-start">الاسم</th>
            <th className="px-2 py-2">الحالة</th>
            <th className="px-2 py-2">الشهر ده</th>
            <th className="px-2 py-2">اللي فات</th>
            <th className="px-2 py-2">الإجمالي</th>
            <th className="px-2 py-2">آخر مشاركة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((v) => (
            <tr key={v.id}>
              <td className="px-4 py-2">
                <Link to={`/volunteers/${v.id}`} className={v.status === 'مسئول' ? 'font-semibold text-purple-700' : 'font-semibold text-blue-700'}>
                  <Star className="me-1 inline size-3.5 fill-current" />
                  {v.full_name_ar}
                </Link>
              </td>
              <td className="px-2 py-2 text-center">
                <Badge tone={v.status === 'مسئول' ? 'purple' : 'blue'}>{v.status}</Badge>
              </td>
              <td className="px-2 py-2 text-center font-bold">{v.stats?.this_month ?? 0}</td>
              <td className="px-2 py-2 text-center">{v.stats?.last_month ?? 0}</td>
              <td className="px-2 py-2 text-center">{v.stats?.total ?? 0}</td>
              <td className="px-2 py-2 text-center text-xs text-muted">{fmtShort(v.stats?.last_participation)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function Inactive() {
  const q = useQuery({
    queryKey: ['inactive'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inactive_volunteers').select('*').order('last_participation', { ascending: true, nullsFirst: true })
      if (error) throw error
      return data as { id: string; code: string; full_name_ar: string; whatsapp: string | null; main_committee: string | null; last_participation: string | null }[]
    },
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="كل اللي تحت المتابعة شاركوا آخر 30 يوم" />
  return (
    <>
      <p className="mb-2 text-sm text-muted">{q.data.length} تحت المتابعة ومشاركوش آخر 30 يوم</p>
      <Card className="divide-y divide-line p-0">
        {q.data.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-3">
            <Link to={`/volunteers/${v.id}`} className="min-w-0 flex-1">
              <p className="truncate font-semibold">{v.full_name_ar}</p>
              <p className="text-xs text-muted">
                {v.main_committee ?? 'بدون لجنة'} · {v.last_participation ? `آخر مشاركة ${fmtShort(v.last_participation)}` : 'مفيش مشاركات خالص'}
              </p>
            </Link>
            {whatsappLink(v.whatsapp) && (
              <a href={whatsappLink(v.whatsapp, 'وحشتنا في نشاط دروس التقوية! 💙')!} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50">
                <MessageCircle className="size-5" />
              </a>
            )}
          </div>
        ))}
      </Card>
    </>
  )
}

function Birthdays() {
  const vols = useVolunteers()
  const [month, setMonth] = useState(String(Number(cairoToday().slice(5, 7))))
  const rows = (vols.data ?? [])
    .filter((v) => v.status !== 'خارج المتابعة' && v.birth_date && Number(v.birth_date.slice(5, 7)) === Number(month))
    .sort((a, b) => a.birth_date!.slice(8).localeCompare(b.birth_date!.slice(8)))
  return (
    <>
      <div className="mb-3 w-48">
        <Select value={month} onChange={(e) => setMonth(e.target.value)} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
      </div>
      {vols.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش أعياد ميلاد في الشهر ده" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-10 text-center text-lg font-bold text-pink-600">{Number(v.birth_date!.slice(8))}</span>
              <Link to={`/volunteers/${v.id}`} className="min-w-0 flex-1 truncate font-semibold">
                {v.full_name_ar}
              </Link>
              {whatsappLink(v.whatsapp ?? v.phone) && (
                <a href={whatsappLink(v.whatsapp ?? v.phone, `كل سنة وإنت طيب يا ${v.full_name_ar.split(' ')[0]} 🎉`)!} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50">
                  <MessageCircle className="size-5" />
                </a>
              )}
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

type TopRow = {
  volunteer_id: string
  code: string
  full_name_ar: string
  main_committee: string | null
  participations: number
  active_days: number
  active_weeks: number
  beneficiaries: number
  last_date: string | null
}

function periodRange(period: string): [string, string] {
  const today = cairoToday()
  const [y, m] = today.split('-').map(Number)
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1]
  if (period === 'this') return [first(y, m), today]
  if (period === 'last') return [first(prev[0], prev[1]), addDays(first(y, m), -1)]
  if (period === '3m') return [addDays(today, -90), today]
  if (period === 'year') return [`${y}-01-01`, today]
  return ['2000-01-01', today]
}

/** Most regular and most active volunteers in a period. */
function TopParticipants() {
  const [period, setPeriod] = useState('last')
  const [order, setOrder] = useState('days')
  const [committee, setCommittee] = useState('')
  const [from, to] = periodRange(period)
  const vols = useVolunteers()
  const committees = useMemo(() => [...new Set((vols.data ?? []).map((v) => v.main_committee).filter((c): c is string => Boolean(c)))].sort(), [vols.data])
  const q = useQuery({
    queryKey: ['top', from, to, order, committee],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('top_participants', { p_from: from, p_to: to, p_committee: committee || null, p_event: null, p_limit: 50, p_order: order })
      if (error) throw error
      return data as TopRow[]
    },
  })
  const max = Math.max(1, ...(q.data ?? []).map((r) => (order === 'days' ? r.active_days : order === 'weeks' ? r.active_weeks : r.participations)))
  return (
    <>
      <Card className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          options={[
            { value: 'this', label: 'الشهر ده' },
            { value: 'last', label: 'الشهر اللي فات' },
            { value: '3m', label: 'آخر 3 شهور' },
            { value: 'year', label: 'السنة دي' },
            { value: 'all', label: 'من الأول' },
          ]}
        />
        <Select
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          options={[
            { value: 'days', label: 'ترتيب بعدد الأيام' },
            { value: 'weeks', label: 'ترتيب بالانتظام (عدد الأسابيع)' },
            { value: 'participations', label: 'ترتيب بعدد المشاركات' },
          ]}
        />
        <Select value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder="كل اللجان" options={committees} />
      </Card>
      <p className="mb-2 text-xs text-muted">
        من {fmtShort(from)} لـ {fmtShort(to)} · المشاركات المقبولة بس. الانتظام = عدد الأسابيع المختلفة اللي شارك فيها.
      </p>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="مفيش مشاركات في الفترة دي" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {q.data.map((r, i) => {
            const val = order === 'days' ? r.active_days : order === 'weeks' ? r.active_weeks : r.participations
            return (
              <div key={r.volunteer_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`w-6 shrink-0 text-center font-bold ${i < 3 ? 'text-amber-600' : 'text-muted'}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link to={`/volunteers/${r.volunteer_id}`} className="block truncate font-semibold hover:text-brand-700">
                    {r.full_name_ar}
                  </Link>
                  <div className="mt-1 h-1.5 rounded-full bg-surface">
                    <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(val / max) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {r.main_committee ?? '—'} · {r.participations} مشاركة · {r.active_days} يوم · {r.active_weeks} أسبوع
                    {r.beneficiaries ? ` · ${r.beneficiaries} طالب` : ''}
                    {r.last_date ? ` · آخر مرة ${fmtShort(r.last_date)}` : ''}
                  </p>
                </div>
                <Badge tone="brand">{val}</Badge>
              </div>
            )
          })}
        </Card>
      )}
    </>
  )
}

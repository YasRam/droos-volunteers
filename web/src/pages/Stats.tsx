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

type Tab = 'overview' | 'lastMonth' | 'regular' | 'responsible' | 'inactive' | 'birthdays'
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

export default function Stats() {
  const p = usePermissions()
  const [params, setParams] = useSearchParams()
  const tabs = [
    ...(p.staff ? [{ value: 'overview' as Tab, label: 'نظرة عامة' }] : []),
    ...(p.full ? [{ value: 'lastMonth' as Tab, label: 'شاركوا الشهر اللي فات' }] : []),
    ...(p.full ? [{ value: 'regular' as Tab, label: 'الأكثر انتظامًا' }] : []),
    ...(p.full ? [{ value: 'responsible' as Tab, label: 'المسئولين والمشروع' }] : []),
    ...(p.full ? [{ value: 'inactive' as Tab, label: 'مش بيشاركوا' }] : []),
    ...(p.full || p.leader ? [{ value: 'birthdays' as Tab, label: 'أعياد الميلاد' }] : []),
  ]
  const tab = (tabs.find((t) => t.value === params.get('tab'))?.value ?? tabs[0]?.value) as Tab
  return (
    <>
      <PageHeader title="الإحصائيات" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'overview' && <Overview />}
      {tab === 'lastMonth' && <LastMonth />}
      {tab === 'regular' && <Regular />}
      {tab === 'responsible' && <Responsible />}
      {tab === 'inactive' && <Inactive />}
      {tab === 'birthdays' && <Birthdays />}
    </>
  )
}

function Overview() {
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
              <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'Cairo' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
              <Tooltip formatter={(v) => [v, 'مشاركة']} labelStyle={{ fontFamily: 'Cairo' }} />
              <Bar dataKey="value" fill="#00838f" radius={[6, 6, 0, 0]} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
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

interface DayRow {
  volunteer_id: string
  activity_date: string
  participations: number
}

/** Accepted participations per volunteer per day, between two dates (inclusive). */
function useDays(from: string, to: string) {
  return useQuery({
    queryKey: ['participation-days', from, to],
    queryFn: async () => {
      const out: DayRow[] = []
      for (let i = 0; ; i += 1000) {
        const { data, error } = await supabase
          .from('participation_days')
          .select('*')
          .gte('activity_date', from)
          .lte('activity_date', to)
          .order('activity_date')
          .order('volunteer_id')
          .range(i, i + 999)
        if (error) throw error
        out.push(...(data as DayRow[]))
        if (data.length < 1000) return out
      }
    },
  })
}

function Rank({ n }: { n: number }) {
  const medal = ['🥇', '🥈', '🥉'][n]
  return <span className="w-8 shrink-0 text-center text-sm font-bold text-muted">{medal ?? n + 1}</span>
}

/** Who took part last month, most days first. */
function LastMonth() {
  const today = cairoToday()
  const first = addDays(today.slice(0, 7) + '-01', -1).slice(0, 7) + '-01'
  const last = addDays(today.slice(0, 7) + '-01', -1)
  const vols = useVolunteers()
  const q = useDays(first, last)
  const names = useMemo(() => new Map((vols.data ?? []).map((v) => [v.id, v])), [vols.data])
  const rows = useMemo(() => {
    const m = new Map<string, { days: number; parts: number }>()
    for (const r of q.data ?? []) {
      const x = m.get(r.volunteer_id) ?? { days: 0, parts: 0 }
      x.days += 1
      x.parts += Number(r.participations)
      m.set(r.volunteer_id, x)
    }
    return [...m.entries()].map(([id, x]) => ({ id, ...x })).sort((a, b) => b.days - a.days || b.parts - a.parts)
  }, [q.data])
  if (q.isLoading || vols.isLoading) return <Spinner />
  if (!rows.length) return <Empty title={`مفيش مشاركات في ${monthLabel(first)}`} />
  return (
    <>
      <p className="mb-2 text-sm text-muted">
        {rows.length} متطوع شاركوا في {MONTHS[Number(first.slice(5, 7)) - 1]}، مترتبين بعدد الأيام
      </p>
      <Card className="divide-y divide-line p-0">
        {rows.map((r, i) => {
          const v = names.get(r.id)
          return (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <Rank n={i} />
              <Link to={`/volunteers/${r.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold">{v?.full_name_ar ?? '—'}</p>
                <p className="truncate text-xs text-muted">{v?.main_committee ?? 'بدون لجنة'}</p>
              </Link>
              <Badge tone="brand">{r.days} يوم</Badge>
              <Badge tone="green">{r.parts} مشاركة</Badge>
            </div>
          )
        })}
      </Card>
    </>
  )
}

/** Saturday-based week number, so a week is Saturday → Friday. */
const weekOf = (iso: string) => {
  const d = Math.floor(Date.parse(iso + 'T00:00:00Z') / 864e5)
  return d - ((d + 5) % 7)
}

/** The most regular: weeks with at least one participation, then days. */
function Regular() {
  const [weeks, setWeeks] = useState('12')
  const today = cairoToday()
  const from = addDays(today, -7 * Number(weeks) + 1)
  const vols = useVolunteers()
  const q = useDays(from, today)
  const names = useMemo(() => new Map((vols.data ?? []).map((v) => [v.id, v])), [vols.data])
  const total = Number(weeks)
  const rows = useMemo(() => {
    const m = new Map<string, { weeks: Set<number>; days: number; parts: number }>()
    for (const r of q.data ?? []) {
      const x = m.get(r.volunteer_id) ?? { weeks: new Set<number>(), days: 0, parts: 0 }
      x.weeks.add(weekOf(r.activity_date))
      x.days += 1
      x.parts += Number(r.participations)
      m.set(r.volunteer_id, x)
    }
    return [...m.entries()]
      .map(([id, x]) => ({ id, weeks: Math.min(x.weeks.size, total), days: x.days, parts: x.parts }))
      .sort((a, b) => b.weeks - a.weeks || b.days - a.days || b.parts - a.parts)
      .slice(0, 100)
  }, [q.data, total])
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">الفترة:</span>
        <Select
          value={weeks}
          onChange={(e) => setWeeks(e.target.value)}
          className="w-44"
          options={[
            { value: '4', label: 'آخر 4 أسابيع' },
            { value: '12', label: 'آخر 3 شهور' },
            { value: '26', label: 'آخر 6 شهور' },
            { value: '52', label: 'آخر سنة' },
          ]}
        />
      </div>
      <p className="mb-2 text-xs text-muted">الانتظام = عدد الأسابيع اللي شارك فيها ولو مرة، من {total} أسبوع. لو اتعادلوا بيتقدّم اللي أيامه أكتر.</p>
      {q.isLoading || vols.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش مشاركات في الفترة دي" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((r, i) => {
            const v = names.get(r.id)
            const pct = Math.round((r.weeks / total) * 100)
            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <Rank n={i} />
                <Link to={`/volunteers/${r.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{v?.full_name_ar ?? '—'}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      {r.weeks}/{total} أسبوع
                    </span>
                  </div>
                </Link>
                <Badge tone="brand">{r.days} يوم</Badge>
                <Badge tone="green">{r.parts} مشاركة</Badge>
              </div>
            )
          })}
        </Card>
      )}
    </>
  )
}

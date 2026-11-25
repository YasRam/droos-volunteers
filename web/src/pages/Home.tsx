import { isEn } from '../lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Cake, ChevronLeft, Hand, MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PushCard } from '@/components/PushToggle'
import { StagesCard } from '@/components/StagesCard'
import { Button, Card } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { addDays, cairoToday, fmtDate, fmtShort, useLookups, useSetting, useStatusOptions, useVolunteers, whatsappLink, type VolunteerWithStats } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { type MonthlyParticipation, type VolunteerStats } from '@/lib/types'
import { useJobs } from '@/lib/jobs'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

export default function Home() {
  const { me } = useAuth()
  const p = usePermissions()
  const today = cairoToday()
  const groupLink = useSetting('whatsapp_group_link')
  const seesVolunteers = p.viewAll || p.leader
  const vols = useVolunteers(seesVolunteers)

  const firstName = ((isEn && me?.full_name_en) || me?.full_name)?.split(' ')[0] ?? me?.email?.split('@')[0]
  const { jobOf } = useJobs()
  const role = p.volunteerId ? jobOf({ id: p.volunteerId, position: me?.position }) : (me?.role_name ?? '')

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">أهلاً {firstName} 👋</h1>
          <p className="text-sm text-muted">
            {fmtDate(today)} · <span className="font-semibold text-brand-700">{role}</span>
          </p>
        </div>
        <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="دروس التقوية" className="h-12 w-auto shrink-0 object-contain" />
        <img src={`${import.meta.env.BASE_URL}resala.png`} alt="رسالة" className="h-8 w-auto shrink-0 object-contain" />
      </div>

      <PushCard />

      {(p.volunteerId || p.canRegisterActivity) && (
        <Card className="bg-gradient-to-l from-brand-700 to-brand-500 text-white">
          <p className="font-bold">شاركت النهارده؟</p>
          <p className="text-sm opacity-90">
            {p.canRegisterActivity ? 'سجّل حضورك أو حضور أي حد من المتطوعين، والمشاركة بتتحسب على طول.' : 'سجّل حضورك، والإدارة هتوافق عليه.'}
          </p>
          <Link to="/check-in">
            <Button variant="secondary" size="lg" className="mt-3 w-full border-0 text-brand-800 sm:w-auto">
              <Hand className="size-5" /> تسجيل حضور
            </Button>
          </Link>
        </Card>
      )}

      {p.volunteerId && <StagesCard volunteerId={p.volunteerId} self />}
      {p.volunteerId && <MyNumbers volunteerId={p.volunteerId} />}
      {(p.staff || p.viewAll) && <TodayNumbers today={today} full={p.viewAll} canReview={p.canReview} />}
      {(p.leader || p.can('hr.view')) && <TestOverdue />}
      {seesVolunteers && <VolunteerNumbers vols={vols.data} full={p.viewAll} leader={!p.viewAll && p.leader} today={today} />}
      {seesVolunteers && <Birthdays vols={vols.data} today={today} />}

      <WhatsAppGroups general={groupLink.data ?? null} volunteerId={me?.volunteer_id ?? null} leaderOf={p.leader ? (me?.committees ?? []) : []} />
    </div>
  )
}

/** General group plus the groups of the person's own committees (and the ones they lead). */
function WhatsAppGroups({ general, volunteerId, leaderOf }: { general: string | null; volunteerId: string | null; leaderOf: string[] }) {
  const lookups = useLookups()
  const mine = useQuery({
    queryKey: ['my-committees', volunteerId],
    enabled: Boolean(volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteers').select('main_committee, sub_committee').eq('id', volunteerId!).maybeSingle()
      if (error) throw error
      return data as { main_committee: string | null; sub_committee: string | null } | null
    },
  })
  const team = useQuery({
    queryKey: ['team-group'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_group_link')
      if (error) throw error
      return (data as string | null) ?? null
    },
  })
  const names = [...new Set([mine.data?.main_committee, mine.data?.sub_committee, ...leaderOf].filter((c): c is string => Boolean(c)))]
  const groups = [
    ...(general ? [{ name: 'الجروب العام', link: general }] : []),
    ...(team.data ? [{ name: 'فريق العمل', link: team.data }] : []),
    ...names.flatMap((n) => {
      const link = lookups.data?.rows.find((r) => r.list === 'اللجنة' && r.value === n)?.link
      return link ? [{ name: `جروب ${n}`, link }] : []
    }),
  ]
  if (!groups.length) return null
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {groups.map((g) => (
        <a key={g.link} href={g.link} target="_blank" rel="noreferrer" className="block">
          <Button variant="secondary" className="w-full">
            <MessageCircle className="size-4 text-emerald-600" /> {g.name}
          </Button>
        </a>
      ))}
    </div>
  )
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <h2 className="font-bold">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

const TONES = {
  brand: 'text-brand-700',
  green: 'text-emerald-700',
  orange: 'text-orange-600',
  purple: 'text-purple-700',
  blue: 'text-blue-700',
  gray: 'text-gray-500',
  red: 'text-red-600',
} as const

function Metric({ label, value, hint, to, tone = 'brand' }: { label: string; value: ReactNode; hint?: string; to?: string; tone?: keyof typeof TONES }) {
  const body = (
    <Card className={clsx('h-full p-3', to && 'transition hover:border-brand-500')}>
      <p className={clsx('text-2xl font-bold', TONES[tone])}>{value ?? '—'}</p>
      <p className="text-sm font-semibold">{label}</p>
      {hint && <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p>}
    </Card>
  )
  return to ? (
    <Link to={to} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  )
}

function MyNumbers({ volunteerId }: { volunteerId: string }) {
  const q = useQuery({
    queryKey: ['my-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_stats').select('*').eq('volunteer_id', volunteerId).maybeSingle()
      if (error) throw error
      return data as VolunteerStats | null
    },
  })
  return (
    <Section
      title="مشاركاتك"
      hint={q.data?.last_participation ? `آخر مشاركة ليك: ${fmtShort(q.data.last_participation)}` : 'المشاركات المقبولة بس هي اللي بتتحسب'}
      action={
        <Link to="/me/activities" className="flex items-center text-sm font-semibold text-brand-700">
          كل أنشطتي <ChevronLeft className="size-4" />
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Metric label="الشهر ده" value={q.data?.this_month ?? 0} />
        <Metric label="الشهر اللي فات" value={q.data?.last_month ?? 0} tone="gray" />
        <Metric label="من أول ما بدأت" value={q.data?.total ?? 0} tone="green" />
      </div>
    </Section>
  )
}

function TodayNumbers({ today, full, canReview }: { today: string; full: boolean; canReview: boolean }) {
  const q = useQuery({
    queryKey: ['home-today', today],
    queryFn: async () => {
      const [rows, pending] = await Promise.all([
        supabase.from('participations').select('volunteer_id').eq('activity_date', today).eq('status', 'accepted'),
        supabase.from('participations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      if (rows.error) throw rows.error
      return { participations: rows.data.length, people: new Set(rows.data.map((r) => r.volunteer_id)).size, pending: pending.count ?? 0 }
    },
  })
  return (
    <Section title="النهارده" hint="المشاركات المسجلة بتاريخ النهارده">
      <div className="grid grid-cols-3 gap-3">
        <Metric label="مشاركة" value={q.data?.participations} hint="اتسجلت واتقبلت" tone="green" to={full ? '/followups' : undefined} />
        <Metric label="متطوع" value={q.data?.people} hint="شاركوا النهارده" />
        <Metric label="طلب مستني" value={q.data?.pending} hint="محتاج موافقة أو رفض" tone={q.data?.pending ? 'orange' : 'gray'} to={canReview ? '/requests' : undefined} />
      </div>
    </Section>
  )
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  'تحت المتابعة': 'green',
  'مشروع مسئول': 'blue',
  مسئول: 'purple',
  مدرب: 'brand',
  'خارج المتابعة': 'gray',
}
const STATUS_HINT: Record<string, string> = {
  'تحت المتابعة': 'متطوعين شغالين معانا',
  'مشروع مسئول': 'بيتجهزوا يبقوا مسئولين',
  مسئول: 'مسئولين في النشاط',
  مدرب: 'بيدربوا المتطوعين',
  'خارج المتابعة': 'مشاركوش 3 شهور أو أكتر',
}

function VolunteerNumbers({ vols, full, leader, today }: { vols?: VolunteerWithStats[]; full: boolean; leader: boolean; today: string }) {
  const opts = useStatusOptions()
  const month = useQuery({
    queryKey: ['monthly'],
    enabled: full,
    queryFn: async () => {
      const { data, error } = await supabase.from('monthly_participation').select('*')
      if (error) throw error
      return data as MonthlyParticipation[]
    },
  })
  const thisMonth = today.slice(0, 7)
  const lastMonth = addDays(thisMonth + '-01', -1).slice(0, 7)
  const sum = (m: string) => (month.data ?? []).filter((r) => r.month === m).reduce((s, r) => s + Number(r.participations), 0)
  const count = (status: string) => vols?.filter((v) => v.status === status).length
  const monthOf = (v: VolunteerWithStats) => v.registered_at?.slice(0, 7)
  const newThisMonth = vols?.filter((v) => monthOf(v) === thisMonth).length
  const newLastMonth = vols?.filter((v) => monthOf(v) === lastMonth).length
  const new30 = vols?.filter((v) => v.registered_at && v.registered_at.slice(0, 10) >= addDays(today, -30)).length
  const quiet = vols?.filter((v) => v.status !== 'خارج المتابعة' && (!v.stats?.last_participation || v.stats.last_participation < addDays(today, -30))).length

  return (
    <Section title={leader ? 'متطوعين لجنتك' : 'المتطوعين'} hint={vols ? `${vols.length} متطوع · اضغط على أي رقم عشان تشوف الأسماء` : undefined}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {opts.statuses.map((s) => (
          <Metric key={s} label={s} value={count(s)} hint={STATUS_HINT[s]} tone={STATUS_TONE[s]} to={`/volunteers?status=${encodeURIComponent(s)}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric
          label={`جداد ${MONTHS[Number(thisMonth.slice(5)) - 1]}`}
          value={newThisMonth}
          hint={vols ? `اتسجلوا الشهر ده · الشهر اللي فات: ${newLastMonth} · آخر 30 يوم: ${new30}` : undefined}
          tone="blue"
          to="/volunteers?new=30"
        />
        {full && <Metric label={`مشاركات ${MONTHS[Number(thisMonth.slice(5)) - 1]}`} value={month.data ? sum(thisMonth) : undefined} hint={month.data ? `الشهر اللي فات: ${sum(lastMonth)}` : undefined} tone="green" to="/stats" />}
        <Metric label="مشاركوش من شهر" value={quiet} hint="مش «خارج المتابعة»، ومالهمش مشاركة آخر 30 يوم" tone="orange" to="/volunteers?inactive=1" />
      </div>
    </Section>
  )
}

function Birthdays({ vols, today }: { vols?: VolunteerWithStats[]; today: string }) {
  const md = today.slice(5)
  const month = today.slice(5, 7)
  const list = (vols ?? [])
    .filter((v) => v.status !== 'خارج المتابعة' && v.birth_date?.slice(5, 7) === month)
    .sort((a, b) => a.birth_date!.slice(8).localeCompare(b.birth_date!.slice(8)))
  const todays = list.filter((v) => v.birth_date!.slice(5) === md)
  const rest = list.filter((v) => v.birth_date!.slice(5) > md)
  if (!vols) return null
  return (
    <Section
      title={`أعياد ميلاد ${MONTHS[Number(month) - 1]}`}
      hint="المتطوعين اللي مش خارج المتابعة"
      action={
        <Link to="/stats?tab=birthdays" className="flex items-center text-sm font-semibold text-brand-700">
          شهور تانية <ChevronLeft className="size-4" />
        </Link>
      }
    >
      <Card className="p-0">
        <div className="border-b border-line px-4 py-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-pink-600">
            <Cake className="size-4" /> النهارده
          </p>
          {todays.length ? todays.map((v) => <BirthdayRow key={v.id} v={v} />) : <p className="text-sm text-muted">مفيش أعياد ميلاد النهارده</p>}
        </div>
        <div className="px-4 py-3">
          <p className="mb-1 text-sm font-bold text-muted">باقي الشهر ({rest.length})</p>
          {rest.length ? rest.map((v) => <BirthdayRow key={v.id} v={v} />) : <p className="text-sm text-muted">مفيش</p>}
        </div>
      </Card>
    </Section>
  )
}

function BirthdayRow({ v }: { v: VolunteerWithStats }) {
  const wa = whatsappLink(v.whatsapp ?? v.phone, `كل سنة وإنت طيب يا ${v.full_name_ar.split(' ')[0]} 🎉`)
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-14 shrink-0 text-xs font-semibold text-pink-600">{fmtShort(v.birth_date)}</span>
      <Link to={`/volunteers/${v.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-brand-700">
        {v.full_name_ar}
      </Link>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label="تهنئة على واتساب">
          <MessageCircle className="size-4" />
        </a>
      )}
    </div>
  )
}

/** Volunteers 3 months or more in «اختبار»: the leader decides. */
function TestOverdue() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['test-overdue'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('test_overdue')
      if (error) throw error
      return data as { id: string; code: string; full_name_ar: string; committee: string | null; since: string }[]
    },
  })
  const accept = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('accept_volunteer', { p_volunteer: id })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('بقى «مقبول»')
      qc.invalidateQueries({ queryKey: ['test-overdue'] })
      qc.invalidateQueries({ queryKey: ['volunteer_hr'] })
    },
    onError: toastError,
  })
  const rows = q.data ?? []
  if (!rows.length) return null
  return (
    <Card className="border-orange-200 bg-orange-50">
      <p className="font-bold">عدّى عليهم 3 شهور أو أكتر في «اختبار» ({rows.length})</p>
      <p className="text-xs text-muted">محتاجين قرار. «مقبول» بتقبله على طول، أو افتح المتطوع لو محتاج تشوف ملفه الأول.</p>
      <ul className="mt-2 max-h-80 divide-y divide-orange-100 overflow-y-auto text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-1.5">
            <Link to={`/volunteers/${r.id}`} className="min-w-0 flex-1 hover:text-brand-700">
              <span className="block truncate font-semibold">{r.full_name_ar}</span>
              <span className="block text-xs text-muted">
                {r.committee ?? 'من غير لجنة'} · من {fmtDate(r.since)}
              </span>
            </Link>
            <Button size="sm" variant="secondary" loading={accept.isPending && accept.variables === r.id} onClick={() => accept.mutate(r.id)}>
              مقبول
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

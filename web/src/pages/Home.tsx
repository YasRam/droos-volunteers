import { useQuery } from '@tanstack/react-query'
import { Cake, ClipboardCheck, Hand, Inbox, UserX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, Stat } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { cairoToday, fmtShort, useSetting } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import type { VolunteerStats } from '@/lib/types'

export default function Home() {
  const { me } = useAuth()
  const p = usePermissions()
  const today = cairoToday()
  const groupLink = useSetting('whatsapp_group_link')

  const mine = useQuery({
    queryKey: ['my-stats'],
    enabled: Boolean(p.volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_stats').select('*').eq('volunteer_id', p.volunteerId!).maybeSingle()
      if (error) throw error
      return data as VolunteerStats | null
    },
  })

  const staffNumbers = useQuery({
    queryKey: ['home-staff', today],
    enabled: p.staff,
    queryFn: async () => {
      const [todayCount, pending, inactive] = await Promise.all([
        supabase.from('participations').select('id', { count: 'exact', head: true }).eq('activity_date', today).eq('status', 'accepted'),
        supabase.from('participations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        p.full
          ? supabase.from('inactive_volunteers').select('id', { count: 'exact', head: true })
          : Promise.resolve({ count: null, error: null }),
      ])
      return { today: todayCount.count ?? 0, pending: pending.count ?? 0, inactive: inactive.count }
    },
  })

  const birthdays = useQuery({
    queryKey: ['birthdays-today', today],
    enabled: p.full || p.leader,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('volunteers')
        .select('id, full_name_ar, birth_date')
        .neq('status', 'خارج المتابعة')
        .not('birth_date', 'is', null)
      if (error) throw error
      const md = today.slice(5)
      return (data as { id: string; full_name_ar: string; birth_date: string }[]).filter((v) => v.birth_date.slice(5) === md)
    },
  })

  const firstName = me?.email?.split('@')[0]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">أهلاً {firstName}</h1>
        <p className="text-sm text-muted">{fmtShort(today)}</p>
      </div>

      {p.volunteerId && (
        <Card className="bg-gradient-to-l from-brand-700 to-brand-500 text-white">
          <p className="text-sm opacity-90">شاركت معانا النهارده؟</p>
          <Link to="/check-in">
            <Button variant="secondary" size="lg" className="mt-3 w-full border-0 text-brand-800">
              <Hand className="size-5" /> حضرت النهارده
            </Button>
          </Link>
        </Card>
      )}

      {p.volunteerId && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="الشهر ده" value={mine.data?.this_month ?? '—'} />
          <Stat label="الشهر اللي فات" value={mine.data?.last_month ?? '—'} />
          <Stat label="الإجمالي" value={mine.data?.total ?? '—'} />
        </div>
      )}

      {p.staff && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="مشاركات النهارده" value={staffNumbers.data?.today ?? '—'} tone="green" />
          <Link to="/requests">
            <Stat label="طلبات مستنية" value={staffNumbers.data?.pending ?? '—'} tone="orange" />
          </Link>
          {p.full && (
            <Link to="/stats?tab=inactive">
              <Stat label="مشاركوش من شهر" value={staffNumbers.data?.inactive ?? '—'} tone="orange" />
            </Link>
          )}
        </div>
      )}

      {p.staff && (
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLink to="/register" icon={ClipboardCheck} title="تسجيل نشاط" text="لمتطوع أو مجموعة" />
          <QuickLink to="/requests" icon={Inbox} title="الطلبات" text="موافقة أو رفض" />
          {p.full && <QuickLink to="/stats?tab=inactive" icon={UserX} title="مش بيشاركوا" text="تحت المتابعة ومشاركوش آخر 30 يوم" />}
        </div>
      )}

      {birthdays.data && birthdays.data.length > 0 && (
        <Card>
          <p className="mb-2 flex items-center gap-2 font-bold">
            <Cake className="size-5 text-pink-500" /> عيد ميلاد النهارده
          </p>
          <ul className="space-y-1 text-sm">
            {birthdays.data.map((b) => (
              <li key={b.id}>
                <Link to={`/volunteers/${b.id}`} className="text-brand-700 hover:underline">
                  {b.full_name_ar}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {groupLink.data && (
        <a href={groupLink.data} target="_blank" rel="noreferrer">
          <Button variant="secondary" className="w-full">
            جروب الواتساب
          </Button>
        </a>
      )}
    </div>
  )
}

function QuickLink({ to, icon: Icon, title, text }: { to: string; icon: typeof Inbox; title: string; text: string }) {
  return (
    <Link to={to}>
      <Card className="flex items-center gap-3 transition hover:border-brand-500">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Icon className="size-5" />
        </span>
        <span>
          <span className="block font-bold">{title}</span>
          <span className="block text-xs text-muted">{text}</span>
        </span>
      </Card>
    </Link>
  )
}

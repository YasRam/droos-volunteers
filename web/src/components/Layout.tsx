import clsx from 'clsx'
import {
  Bell,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Hand,
  History,
  Home,
  Inbox,
  LogOut,
  FileBarChart,
  Tent,
  UserPlus,
  CalendarCheck,
  Menu,
  Settings,
  User,
  UserRound,
  Users,
  UsersRound,
  FileSpreadsheet,
  ShieldCheck,
  Network,
} from 'lucide-react'
import { Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { Spinner } from '@/components/ui'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, usePermissions } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/lib/types'
import { fmtDateTime } from '@/lib/data'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { LangSwitch } from '@/components/LangSwitch'
import { PasswordButton } from '@/components/PasswordModal'
import { PushSwitch } from './PushToggle'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  badge?: number
}

function usePendingCount(enabled: boolean) {
  return useQuery({
    queryKey: ['pending-count'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      // Everything waiting in «الطلبات»: attendance, t-shirts, certificates (each only if visible to this user)
      const counts = await Promise.all(
        ['participations', 'tshirt_requests', 'certificate_requests', 'registration_requests', 'class_absences'].map(async (t) => {
          const { count, error } = await supabase.from(t).select('id', { count: 'exact', head: true }).eq('status', 'pending')
          return error ? 0 : (count ?? 0)
        }),
      )
      return counts.reduce((a, b) => a + b, 0)
    },
  })
}

function useNotifications(email: string | null) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['notifications'],
    enabled: Boolean(email),
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data as Notification[]
    },
  })
  useEffect(() => {
    if (!email) return
    const channel = supabase
      .channel('my-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_email=eq.${email}` }, () =>
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [email, qc])
  return query
}

export default function Layout() {
  const { me, signOut } = useAuth()
  const p = usePermissions()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [moreOpen, setMoreOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const pending = usePendingCount(p.canReview || p.can('tshirts.manage') || p.can('certificates.review') || p.can('absences.review'))
  const notifications = useNotifications(me?.email ?? null)
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0

  useEffect(() => {
    setMoreOpen(false)
    setBellOpen(false)
  }, [location.pathname])

  const markRead = useMutation({
    mutationFn: async () => {
      const ids = notifications.data?.filter((n) => !n.read_at).map((n) => n.id) ?? []
      if (!ids.length) return
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const items = useMemo<NavItem[]>(() => {
    const list: NavItem[] = [{ to: '/', label: 'الرئيسية', icon: Home }]
    if (p.volunteerId || p.canRegisterActivity) list.push({ to: '/check-in', label: 'تسجيل حضور', icon: Hand })
    if (p.canReview || p.can('tshirts.manage') || p.can('certificates.review') || p.can('hr.view') || p.can('absences.review') || p.can('schedule.edit')) list.push({ to: '/requests', label: 'الطلبات', icon: Inbox, badge: pending.data })
    if (p.can('hr.view') || p.can('recruit.manage')) list.push({ to: '/recruit', label: 'الجداد', icon: UserPlus })
    if (p.can('camps.manage') || p.can('stats.view')) list.push({ to: '/camps', label: 'الكامبات', icon: Tent })
    if (p.canSeeVolunteers) list.push({ to: '/volunteers', label: 'المتطوعين', icon: Users })
    if (p.viewAll || p.leader) list.push({ to: '/tree', label: 'الهيكل', icon: Network })
    if (p.can('attendance.view_all') || p.can('attendance.register')) list.push({ to: '/followups', label: 'المتابعة اليومية', icon: ClipboardList })
    list.push({ to: '/schedule', label: 'جدول الحصص', icon: CalendarDays })
    if (p.volunteerId) list.push({ to: '/me/activities', label: 'أنشطتي', icon: UsersRound })
    if (p.volunteerId) list.push({ to: '/me', label: 'بياناتي', icon: UserRound })
    if (p.can('stats.view') || p.leader) list.push({ to: '/stats', label: 'الإحصائيات', icon: BarChart3 })
    if (p.can('stats.view')) list.push({ to: '/reports', label: 'التقارير', icon: FileBarChart })
    if (p.can('meetings.manage') || p.leader) list.push({ to: '/meetings', label: 'الاجتماعات', icon: CalendarCheck })
    if (p.can('roles.manage')) list.push({ to: '/permissions', label: 'الصلاحيات', icon: ShieldCheck })
    if (p.can('settings.manage')) list.push({ to: '/admin', label: 'الإعدادات', icon: Settings })
    else if (p.can('data.export') || p.can('backup.manage')) list.push({ to: '/admin?tab=data', label: 'البيانات', icon: FileSpreadsheet })
    if (p.can('log.view')) list.push({ to: '/log', label: 'السجل', icon: History })
    return list
  }, [p, pending.data])

  // Bottom bar: the four most used for this person, the rest under "المزيد"
  const bottom = items.slice(0, 4)
  const roleLabel = me?.position && me.position !== 'متطوع' ? me.position : p.leader ? 'ليدر لجنة' : me?.position ?? me?.role_name ?? 'متطوع'
  const displayName = me?.full_name || me?.email || ''

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh print:!hidden w-64 shrink-0 flex-col border-e border-line bg-white lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} className="size-9 object-contain" alt="" />
          <div>
            <p className="font-bold leading-tight">دروس التقوية</p>
            <p className="text-xs text-muted">فرع إسكندرية</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((it) => (
            <SideLink key={it.to} item={it} />
          ))}
        </nav>
        <div className="border-t border-line p-4">
          <p className="truncate text-sm font-semibold">{displayName}</p>
          <p className="text-xs text-muted">{roleLabel}</p>
          <div className="mt-2 flex items-center justify-between">
            <button onClick={signOut} className="flex items-center gap-1 text-sm text-red-600">
              <LogOut className="size-4" /> خروج
            </button>
            <PasswordButton email={me?.email} />
            <LangSwitch />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur">
          <div className="flex items-center gap-2 lg:hidden">
            <img src={`${import.meta.env.BASE_URL}logo-mark.png`} className="size-8 object-contain" alt="" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold">{displayName}</p>
              <p className="truncate text-[11px] text-muted">{roleLabel}</p>
            </div>
          </div>
          <div className="hidden min-w-0 lg:block">
            <span className="font-bold">{displayName}</span>
            {roleLabel && <span className="text-sm text-muted">{' · '}{roleLabel}</span>}
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setBellOpen((o) => !o)
                if (!bellOpen && unread) markRead.mutate()
              }}
              className="relative rounded-xl p-2 hover:bg-surface"
              aria-label="الإشعارات"
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -end-0.5 grid size-5 place-items-center rounded-full bg-orange-500 text-[11px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute end-0 top-11 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
                <p className="border-b border-line px-4 py-2 text-sm font-bold">الإشعارات</p>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.data?.length ? (
                    notifications.data.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => n.link && navigate(n.link)}
                        className={clsx('block w-full border-b border-line px-4 py-3 text-start hover:bg-surface', !n.read_at && 'bg-brand-50/50')}
                      >
                        <p className="text-sm font-semibold">{n.title}</p>
                        {n.body && <p className="text-xs text-muted">{n.body}</p>}
                        <p className="mt-0.5 text-[11px] text-muted">{fmtDateTime(n.created_at)}</p>
                      </button>
                    ))
                  ) : (
                    <p className="px-4 py-6 text-center text-sm text-muted">مفيش إشعارات</p>
                  )}
                </div>
                <PushSwitch />
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 lg:pb-10 print:max-w-none print:p-0">
          <PageErrorBoundary key={location.pathname}>
              <Suspense fallback={<Spinner />}>
                <Outlet />
              </Suspense>
            </PageErrorBoundary>
        </main>
      </div>

      {/* Bottom bar (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 print:hidden grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {bottom.map((it) => (
          <BottomLink key={it.to} item={it} />
        ))}
        <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
          <Menu className="size-5" />
          المزيد
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-surface p-3">
              <User className="size-5 text-muted" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <p className="text-xs text-muted">{roleLabel}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {items.slice(4).map((it) => (
                <NavLink key={it.to} to={it.to} className="flex flex-col items-center gap-1 rounded-xl p-3 text-center text-xs font-semibold hover:bg-surface">
                  <it.icon className="size-5 text-brand-700" />
                  {it.label}
                </NavLink>
              ))}
              <LangSwitch stacked />
              <PasswordButton stacked email={me?.email} />
              <button onClick={signOut} className="flex flex-col items-center gap-1 rounded-xl p-3 text-xs font-semibold text-red-600 hover:bg-red-50">
                <LogOut className="size-5" />
                خروج
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SideLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/' || item.to === '/me'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition',
          isActive ? 'bg-brand-50 text-brand-800' : 'text-muted hover:bg-surface hover:text-ink',
        )
      }
    >
      <item.icon className="size-5" />
      <span className="flex-1">{item.label}</span>
      {item.badge ? <span className="rounded-full bg-orange-500 px-2 text-xs text-white">{item.badge}</span> : null}
    </NavLink>
  )
}

function BottomLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/' || item.to === '/me'}
      className={({ isActive }) =>
        clsx('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-brand-700' : 'text-muted')
      }
    >
      <item.icon className="size-5" />
      {item.label}
      {item.badge ? (
        <span className="absolute top-1 end-[22%] rounded-full bg-orange-500 px-1.5 text-[10px] text-white">{item.badge}</span>
      ) : null}
    </NavLink>
  )
}

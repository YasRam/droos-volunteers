import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { isDevAuth, supabase } from './supabase'
import type { Permission } from './permissions'
import type { MyContext } from './types'

interface AuthState {
  session: Session | null
  ready: boolean
  me: MyContext | null
  /** signed in and the email belongs to a volunteer, staff member or committee leader */
  known: boolean
  /** my_context failed (network, waking up) — not the same as an unknown email */
  failed: boolean
  retry: () => void
  isLeader: boolean
  signIn: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(isDevAuth)
  const userId = useRef<string | null>(null)

  useEffect(() => {
    if (isDevAuth) return
    supabase.auth.getSession().then(({ data }) => {
      userId.current = data.session?.user.id ?? null
      setSession(data.session)
      setReady(true)
    })
    // Supabase fires events on every token refresh and when the tab comes back;
    // only a different person (or signing out) should drop the cached data.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      const id = s?.user.id ?? null
      if (id !== userId.current) {
        userId.current = id
        qc.clear()
      }
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  const signedIn = isDevAuth || Boolean(session)

  const meQuery = useQuery({
    queryKey: ['me', session?.user.id ?? 'dev'],
    enabled: ready && signedIn,
    staleTime: 5 * 60_000,
    retry: 4,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_context')
      if (error) throw error
      return data as MyContext
    },
  })

  const me = meQuery.data ?? null
  const isLeader = (me?.committees.length ?? 0) > 0
  const known = Boolean(me && (me.role || me.volunteer_id || isLeader))

  const value: AuthState = {
    session,
    ready: ready && (!signedIn || !meQuery.isLoading),
    me,
    known,
    failed: meQuery.isError && !meQuery.data,
    retry: () => void meQuery.refetch(),
    isLeader,
    signIn: async () => {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { prompt: 'select_account' } },
      })
    },
    signInWithPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error) throw new Error(/invalid/i.test(error.message) ? 'الإيميل أو كلمة السر غلط' : error.message)
    },
    signOut: async () => {
      await supabase.auth.signOut()
      qc.clear()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/** What the signed-in person may do, in one place for the screens. */
export function usePermissions() {
  const { me, isLeader } = useAuth()
  const perms = new Set<string>(me?.permissions ?? [])
  const can = (p: Permission) => perms.has(p)
  const viewAll = can('volunteers.view_all')
  return {
    can,
    /** may add, edit and delete volunteers */
    full: can('volunteers.edit'),
    /** reads the whole picture (every volunteer and participation) */
    viewAll,
    /** registers attendance for others */
    staff: can('attendance.register'),
    /** registers only within the last 7 days */
    organizer: can('attendance.register') && !can('attendance.any_date'),
    leader: isLeader,
    volunteerId: me?.volunteer_id ?? null,
    canSeeVolunteers: viewAll || isLeader || can('directory.view'),
    canRegisterActivity: can('attendance.register'),
    canReview: can('attendance.review'),
    canEditSchedule: can('schedule.edit'),
    canManage: can('settings.manage') || can('roles.manage'),
  }
}

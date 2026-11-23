import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { isDevAuth, supabase } from './supabase'
import { ROLE_LABEL, type MyContext } from './types'

interface AuthState {
  session: Session | null
  ready: boolean
  me: MyContext | null
  /** signed in and the email belongs to a volunteer, staff member or committee leader */
  known: boolean
  isLeader: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(isDevAuth)

  useEffect(() => {
    if (isDevAuth) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      qc.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  const signedIn = isDevAuth || Boolean(session)

  const meQuery = useQuery({
    queryKey: ['me', session?.user.id ?? 'dev'],
    enabled: ready && signedIn,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_context')
      if (error) throw error
      return data as MyContext
    },
  })

  const me = meQuery.data ?? null
  const isLeader = (me?.committees.length ?? 0) > 0
  const known = Boolean(me && (me.is_staff || me.volunteer_id || isLeader))

  const value: AuthState = {
    session,
    ready: ready && (!signedIn || !meQuery.isLoading),
    me,
    known,
    isLeader,
    signIn: async () => {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, queryParams: { prompt: 'select_account' } },
      })
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

/** «HR + تنظيم»، or the position, or «متطوع». */
export function useRoleLabel() {
  const { me, isLeader } = useAuth()
  const roles = (me?.roles ?? (me?.role ? [me.role] : [])).map((r) => ROLE_LABEL[r])
  if (isLeader) roles.push('ليدر لجنة')
  if (roles.length) return roles.join(' + ')
  return me?.position ?? 'متطوع'
}

/** What the signed-in person may do, in one place for the screens. */
export function usePermissions() {
  const { me, isLeader } = useAuth()
  const full = Boolean(me?.is_full)
  const staff = Boolean(me?.is_staff)
  return {
    full,
    staff,
    organizer: Boolean(me?.is_organizer),
    leader: isLeader,
    volunteerId: me?.volunteer_id ?? null,
    canSeeVolunteers: full || isLeader || staff,
    canRegisterActivity: staff,
    canReview: staff,
    canEditSchedule: full,
    canManage: full,
  }
}

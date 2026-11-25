import { lazy as reactLazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { isChunkError, PageErrorBoundary, reloadOnce } from '@/components/PageErrorBoundary'

/** lazy() that loads the new version when an old page file is gone. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazy = <T extends ComponentType<any>>(load: () => Promise<{ default: T }>) =>
  reactLazy(() =>
    load().catch((e) => {
      if (isChunkError(e)) reloadOnce()
      throw e
    }),
  )
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from '@/components/Layout'
import { Spinner } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import Login from '@/pages/Login'
import NotRegistered, { Inactive, Offline } from '@/pages/NotRegistered'
import Home from '@/pages/Home'

const MyActivities = lazy(() => import('@/pages/MyActivities'))
const MyProfile = lazy(() => import('@/pages/MyProfile'))
const Volunteers = lazy(() => import('@/pages/Volunteers'))
const VolunteerDetail = lazy(() => import('@/pages/VolunteerDetail'))
const RegisterActivity = lazy(() => import('@/pages/RegisterActivity'))
const FollowUps = lazy(() => import('@/pages/FollowUps'))
const Requests = lazy(() => import('@/pages/Requests'))
const Camps = lazy(() => import('@/pages/Camps'))
const Recruit = lazy(() => import('@/pages/Recruit'))
const Schedule = lazy(() => import('@/pages/Schedule'))
const Stats = lazy(() => import('@/pages/Stats'))
const Reports = lazy(() => import('@/pages/Reports'))
const Meetings = lazy(() => import('@/pages/Meetings'))
const Admin = lazy(() => import('@/pages/Admin'))
const Permissions = lazy(() => import('@/pages/Permissions'))
const Tree = lazy(() => import('@/pages/Tree'))
const AuditLog = lazy(() => import('@/pages/AuditLog'))
const Join = lazy(() => import('@/pages/Join'))

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const { ready, session, known, failed, retry, inactive } = useAuth()
  const p = usePermissions()
  const devAuth = import.meta.env.DEV && Boolean(import.meta.env.VITE_DEV_ACCESS_TOKEN)
  const { pathname } = useLocation()

  // The join form is public: no sign-in
  if (pathname === '/join')
    return (
      <Suspense fallback={<Spinner />}>
        <Join />
      </Suspense>
    )
  if (!ready) return <Spinner label="لحظة..." />
  if (!session && !devAuth) return <Login />
  if (failed) return <Offline onRetry={retry} />
  if (!known) return <NotRegistered />
  if (inactive) return <Inactive />

  return (
    <PageErrorBoundary>
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="me" element={<Guard allow={Boolean(p.volunteerId)}><MyProfile /></Guard>} />
          <Route path="me/activities" element={<Guard allow={Boolean(p.volunteerId)}><MyActivities /></Guard>} />
          <Route path="volunteers" element={<Guard allow={p.canSeeVolunteers}><Volunteers /></Guard>} />
          <Route path="volunteers/:id" element={<Guard allow={p.viewAll || p.leader}><VolunteerDetail /></Guard>} />
          <Route path="check-in" element={<Guard allow={Boolean(p.volunteerId) || p.canRegisterActivity}><RegisterActivity /></Guard>} />
          <Route path="register" element={<Navigate to="/check-in" replace />} />
          <Route path="followups" element={<Guard allow={p.can('attendance.view_all') || p.can('attendance.register')}><FollowUps /></Guard>} />
          <Route path="requests/*" element={<Guard allow={p.canReview || p.can('stages.manage') || p.can('certificates.review') || p.can('hr.view') || p.can('schedule.edit')}><Requests /></Guard>} />
          <Route path="recruit" element={<Guard allow={p.can('hr.view')}><Recruit /></Guard>} />
          <Route path="camps" element={<Guard allow={p.can('stages.manage') || p.can('stats.view')}><Camps /></Guard>} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="stats" element={<Guard allow={p.can('stats.view') || p.leader}><Stats /></Guard>} />
          <Route path="reports" element={<Guard allow={p.can('stats.view')}><Reports /></Guard>} />
          <Route path="meetings" element={<Guard allow={p.can('attendance.register') || p.leader}><Meetings /></Guard>} />
          <Route path="tree" element={<Guard allow={p.viewAll || p.leader}><Tree /></Guard>} />
          <Route path="data" element={<Navigate to="/admin?tab=data" replace />} />
          <Route path="certificates" element={<Navigate to="/requests?tab=certificates" replace />} />
          <Route path="permissions" element={<Guard allow={p.can('roles.manage')}><Permissions /></Guard>} />
          <Route path="admin" element={<Guard allow={p.can('settings.manage') || p.can('data.export') || p.can('backup.manage') || p.can('stages.manage')}><Admin /></Guard>} />
          <Route path="log" element={<Guard allow={p.can('log.view')}><AuditLog /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
    </PageErrorBoundary>
  )
}

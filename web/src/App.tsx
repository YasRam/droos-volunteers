import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import { Spinner } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import Login from '@/pages/Login'
import NotRegistered from '@/pages/NotRegistered'
import Home from '@/pages/Home'

const MyActivities = lazy(() => import('@/pages/MyActivities'))
const MyProfile = lazy(() => import('@/pages/MyProfile'))
const Volunteers = lazy(() => import('@/pages/Volunteers'))
const VolunteerDetail = lazy(() => import('@/pages/VolunteerDetail'))
const RegisterActivity = lazy(() => import('@/pages/RegisterActivity'))
const FollowUps = lazy(() => import('@/pages/FollowUps'))
const Requests = lazy(() => import('@/pages/Requests'))
const Schedule = lazy(() => import('@/pages/Schedule'))
const Stats = lazy(() => import('@/pages/Stats'))
const Admin = lazy(() => import('@/pages/Admin'))
const Permissions = lazy(() => import('@/pages/Permissions'))
const Certificates = lazy(() => import('@/pages/Certificates'))
const Tree = lazy(() => import('@/pages/Tree'))
const AuditLog = lazy(() => import('@/pages/AuditLog'))

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const { ready, session, known } = useAuth()
  const p = usePermissions()
  const devAuth = import.meta.env.DEV && Boolean(import.meta.env.VITE_DEV_ACCESS_TOKEN)

  if (!ready) return <Spinner label="لحظة..." />
  if (!session && !devAuth) return <Login />
  if (!known) return <NotRegistered />

  return (
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
          <Route path="requests/*" element={<Guard allow={p.canReview}><Requests /></Guard>} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="stats" element={<Guard allow={p.can('stats.view') || p.leader}><Stats /></Guard>} />
          <Route path="tree" element={<Guard allow={p.viewAll || p.leader}><Tree /></Guard>} />
          <Route path="data" element={<Navigate to="/admin?tab=data" replace />} />
          <Route path="certificates" element={<Guard allow={p.can('certificates.review')}><Certificates /></Guard>} />
          <Route path="permissions" element={<Guard allow={p.can('roles.manage')}><Permissions /></Guard>} />
          <Route path="admin" element={<Guard allow={p.can('settings.manage') || p.can('data.export') || p.can('backup.manage')}><Admin /></Guard>} />
          <Route path="log" element={<Guard allow={p.can('log.view')}><AuditLog /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

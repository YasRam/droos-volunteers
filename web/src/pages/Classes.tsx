import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AbsenceRequests } from '@/components/ClassAbsence'
import { PageHeader, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'

const DayView = lazy(() => import('./students/Classes').then((m) => ({ default: m.DayView })))
const Schedule = lazy(() => import('./Schedule'))
const SlotRequests = lazy(() => import('./students/StudentRequests').then((m) => ({ default: m.SlotRequests })))

type Tab = 'today' | 'week' | 'requests'

/**
 * الحصص: one class for volunteers and students.
 *   النهارده  the dated classes: attendance, substitute, excuse, cancel / postpone
 *   الجدول    the weekly classes: time, teachers, who attends, from / to
 *   الطلبات   teachers' excuses and cancel / postpone / pause requests
 */
export default function Classes() {
  const p = usePermissions()
  const [params, setParams] = useSearchParams()
  const reviews = p.can('absences.review') || p.can('schedule.edit') || p.can('students.review')
  const tabs = [
    { value: 'today' as Tab, label: 'النهارده' },
    { value: 'week' as Tab, label: 'الجدول الأسبوعي' },
    ...(reviews ? [{ value: 'requests' as Tab, label: 'الطلبات' }] : []),
  ]
  // old links: /schedule?absence=… opens the week; /classes?date=… opens that day
  const asked = (params.get('tab') as Tab) || (params.get('absence') ? 'week' : 'today')
  const tab = tabs.some((t) => t.value === asked) ? asked : 'today'
  return (
    <>
      <PageHeader title="الحصص" subtitle="الحصة الواحدة للمتطوعين والطلاب: أي تغيير فيها بيوصل للاتنين." />
      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(t) => {
          const next = new URLSearchParams(params)
          next.set('tab', t)
          setParams(next, { replace: true })
        }}
      />
      <Suspense fallback={<Spinner />}>
        {tab === 'today' && <DayView />}
        {tab === 'week' && <Schedule embedded />}
        {tab === 'requests' && (
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 font-bold">اعتذارات المدرسين</h2>
              <AbsenceRequests />
            </section>
            <section>
              <h2 className="mb-2 font-bold">إلغاء وتأجيل وإيقاف</h2>
              <SlotRequests />
            </section>
          </div>
        )}
      </Suspense>
    </>
  )
}

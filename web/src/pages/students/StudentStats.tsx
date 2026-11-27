import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Empty, PageHeader, Spinner, Stat } from '@/components/ui'
import { sdb, useCurrentTerm, useGrades, useMarks, useStudents } from '@/lib/students'

interface Att { student_id: string; mark: string; session: { on_date: string; takes_attendance: boolean; status: string } }

export default function StudentStats() {
  const term = useCurrentTerm()
  const students = useStudents()
  const grades = useGrades()
  const marks = useMarks()
  const q = useQuery({
    queryKey: ['students', 'stats', term.data?.id],
    enabled: Boolean(term.data),
    queryFn: async () => {
      const [att, apps, groups] = await Promise.all([
        sdb().from('attendance').select('student_id, mark, session:class_sessions!inner(on_date, takes_attendance, status)')
          .gte('session.on_date', term.data!.starts_on).lte('session.on_date', term.data!.ends_on),
        sdb().from('applications').select('status').eq('term_id', term.data!.id),
        sdb().from('group_members').select('group_id, group:groups!inner(name, term_id)').eq('group.term_id', term.data!.id),
      ])
      for (const r of [att, apps, groups]) if (r.error) throw r.error
      return {
        att: (att.data ?? []) as unknown as Att[],
        apps: (apps.data ?? []) as { status: string }[],
        groups: (groups.data ?? []) as unknown as { group_id: string; group: { name: string } }[],
      }
    },
  })

  const s = useMemo(() => {
    if (!q.data || !students.data || !marks.data) return null
    const present = new Set(marks.data.filter((m) => m.is_present).map((m) => m.code))
    const absent = new Set(marks.data.filter((m) => m.counts_absence).map((m) => m.code))
    const gradeOf = new Map(students.data.filter((x) => x.enrollment).map((x) => [x.id, x.enrollment!.grade]))
    const counted = q.data.att.filter((a) => a.session.takes_attendance && a.session.status !== 'اتلغت')
    const rate = (rows: Att[]) => {
      const p = rows.filter((a) => present.has(a.mark)).length
      const ab = rows.filter((a) => absent.has(a.mark)).length
      return p + ab ? Math.round((p / (p + ab)) * 100) : null
    }
    const byGrade = (grades.data ?? []).map((g) => ({ grade: g, value: rate(counted.filter((a) => gradeOf.get(a.student_id) === g)) })).filter((x) => x.value !== null)
    const enrolled = students.data.filter((x) => x.enrollment)
    const status = (st: string) => enrolled.filter((x) => x.enrollment!.status === st).length
    const groupSizes = Object.values(q.data.groups.reduce<Record<string, { name: string; n: number }>>((acc, m) => {
      acc[m.group_id] = { name: m.group.name, n: (acc[m.group_id]?.n ?? 0) + 1 }
      return acc
    }, {})).sort((a, b) => b.n - a.n)
    return {
      enrolled: enrolled.length,
      active: status('نشط'),
      warned: status('تحذير'),
      dismissed: status('مفصول'),
      waiting: q.data.apps.filter((a) => !['مقبول', 'مرفوض', 'بلاك ليست'].includes(a.status)).length,
      rate: rate(counted),
      byGrade,
      topAbsent: [...enrolled].sort((a, b) => b.absences - a.absences).filter((x) => x.absences > 0).slice(0, 10),
      groupSizes,
    }
  }, [q.data, students.data, marks.data, grades.data])

  if (!term.isLoading && !term.data) return <Empty title="مفيش ترم حالي" />
  if (q.isLoading || students.isLoading || !s) return <Spinner />
  return (
    <>
      <PageHeader title="إحصائيات الطلاب" subtitle={term.data?.name} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="مقيدين في الترم" value={s.enrolled} />
        <Stat label="نشط" value={s.active} tone="green" />
        <Stat label="تحذير غياب" value={s.warned} tone="orange" />
        <Stat label="مفصول" value={s.dismissed} tone="orange" />
        <Stat label="طلبات التحاق مستنية" value={s.waiting} />
        <Stat label="نسبة الحضور" value={s.rate === null ? '—' : `${s.rate}%`} tone="green" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-bold">نسبة الحضور لكل سنة</h2>
          <p className="mb-2 text-xs text-muted">حاضر من (حاضر + غائب) في الحصص اللي بيتاخد عليها غياب، الترم ده</p>
          {!s.byGrade.length ? <p className="text-sm text-muted">لسه مفيش حضور متسجل.</p> : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer>
                <BarChart data={s.byGrade}>
                  <CartesianGrid vertical={false} stroke="#eee" />
                  <XAxis dataKey="grade" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={40} />
                  <Tooltip formatter={(v) => [`${v}%`, 'الحضور']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="value" fill="#00838f" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">الأكتر غياب</h2>
          {!s.topAbsent.length ? <p className="text-sm text-muted">مفيش غياب.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {s.topAbsent.map((x) => (
                  <tr key={x.id} className="border-t border-line first:border-0">
                    <td className="py-1.5"><Link to={`/students/${x.id}`} className="hover:underline">{x.full_name}</Link></td>
                    <td className="py-1.5 text-muted">{x.enrollment?.grade}</td>
                    <td className="py-1.5 text-end font-bold">{x.absences}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">المجموعات</h2>
          {!s.groupSizes.length ? <p className="text-sm text-muted">مفيش مجموعات.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {s.groupSizes.map((g) => (
                  <tr key={g.name} className="border-t border-line first:border-0">
                    <td className="py-1.5">{g.name}</td>
                    <td className="py-1.5 text-end font-bold">{g.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}

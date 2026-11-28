import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { FeedbackDue } from '@/pages/Stats'
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
  const years = useQuery({
    queryKey: ['students', 'stats-years'],
    queryFn: async () => {
      const [terms, enr] = await Promise.all([
        sdb().from('terms').select('id, name, starts_on').order('starts_on'),
        sdb().from('enrollments').select('term_id, grade, status').limit(20000),
      ])
      if (terms.error) throw terms.error
      if (enr.error) throw enr.error
      const rows = (enr.data ?? []) as { term_id: string; grade: string; status: string }[]
      return ((terms.data ?? []) as { id: string; name: string; starts_on: string }[]).map((t) => {
        const list = rows.filter((e) => e.term_id === t.id)
        const byGrade: Record<string, number> = {}
        for (const e of list) byGrade[e.grade] = (byGrade[e.grade] ?? 0) + 1
        return { id: t.id, name: t.name, total: list.length, dismissed: list.filter((e) => e.status === 'مفصول').length, byGrade }
      })
    },
  })
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
        <Card className="lg:col-span-2 overflow-x-auto">
          <h2 className="mb-2 font-bold">عدد الطلاب كل ترم</h2>
          {!years.data?.length ? <p className="text-sm text-muted">مفيش ترمات.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="p-1.5 text-start">الترم</th>
                  <th className="p-1.5 text-start">المجموع</th>
                  {(grades.data ?? []).map((g) => <th key={g} className="p-1.5 text-start">{g}</th>)}
                  <th className="p-1.5 text-start">اتفصل</th>
                </tr>
              </thead>
              <tbody>
                {years.data.map((y) => (
                  <tr key={y.id} className="border-t border-line">
                    <td className="p-1.5 font-semibold">{y.name}</td>
                    <td className="p-1.5 font-bold">{y.total}</td>
                    {(grades.data ?? []).map((g) => <td key={g} className="p-1.5">{y.byGrade[g] ?? '—'}</td>)}
                    <td className="p-1.5">{y.dismissed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <ExpiringIds compact />
        <div>
          <h2 className="mb-2 font-bold">طلاب محتاجين فيد باك</h2>
          <FeedbackDue kind="student" />
        </div>
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

interface Expiring { student_id: string; student_name: string; who: string; person: string | null; valid_until: string; days_left: number }

/** Guardians' / parents' ID cards that ended or end within 3 months (students in this term). */
export function ExpiringIds({ compact = false }: { compact?: boolean }) {
  const q = useQuery({
    queryKey: ['students', 'expiring-ids'],
    queryFn: async () => {
      const { data, error } = await sdb().rpc('expiring_ids', { p_within: 90 })
      if (error) throw error
      return data as Expiring[]
    },
  })
  const list = q.data ?? []
  const body = q.isLoading ? <Spinner /> : !list.length ? <p className="text-sm text-muted">مفيش بطايق هتنتهي خلال 3 شهور.</p> : (
    <table className="w-full text-sm">
      <tbody>
        {(compact ? list.slice(0, 8) : list).map((x, i) => (
          <tr key={i} className="border-t border-line first:border-0">
            <td className="py-1.5"><Link to={`/students/${x.student_id}`} className="hover:underline">{x.student_name}</Link></td>
            <td className="py-1.5 text-muted">{x.who}{x.person ? ` · ${x.person}` : ''}</td>
            <td className={`py-1.5 text-end font-semibold ${x.days_left < 0 ? 'text-red-700' : x.days_left <= 30 ? 'text-orange-700' : ''}`}>
              {x.days_left < 0 ? `انتهت من ${-x.days_left} يوم` : x.days_left === 0 ? 'بتنتهي النهارده' : `فاضل ${x.days_left} يوم`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  if (compact)
    return (
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">بطايق قربت تخلص ({list.length})</h2>
          {list.length > 8 && <Link to="/students/ids" className="text-sm font-semibold text-brand-700">الكل</Link>}
        </div>
        {body}
      </Card>
    )
  return (
    <>
      <PageHeader title="بطايق قربت تخلص" subtitle="بطاقة ولي الأمر أو الأب أو الأم اللي انتهت أو هتنتهي خلال 3 شهور. ولي الأمر بيوصله إشعار يبعت البطاقة الجديدة." />
      <Card>{body}</Card>
    </>
  )
}

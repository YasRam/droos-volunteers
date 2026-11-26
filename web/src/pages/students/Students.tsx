import clsx from 'clsx'
import { Filter, Plus, Search, Upload } from 'lucide-react'
import { lazy, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { ageFrom } from '@/lib/data'
import { ENROLLMENT_STATUSES, ENROLLMENT_TONE, useCurrentTerm, useGrades, useGroups, useStudents } from '@/lib/students'
import { useQuery } from '@tanstack/react-query'
import { sdb } from '@/lib/students'

const StudentForm = lazy(() => import('./StudentForm'))
const StudentDetail = lazy(() => import('./StudentDetail'))
const Admissions = lazy(() => import('./Admissions'))
const Groups = lazy(() => import('./Groups'))
const Classes = lazy(() => import('./Classes'))
const StudentRequests = lazy(() => import('./StudentRequests'))
const StudentStats = lazy(() => import('./StudentStats'))
const StudentImport = lazy(() => import('./StudentImport'))

/** Who may open the students part at all: تنظيم and up, or a volunteer who teaches. */
export function useStudentAccess() {
  const p = usePermissions()
  const all = p.can('students.view_all')
  return {
    all,
    edit: p.can('students.edit'),
    attendance: p.can('students.attendance'),
    flags: p.can('students.flags'),
    review: p.can('students.review'),
    contacts: p.can('students.view_contacts'),
    sensitive: p.can('students.view_sensitive'),
    teacher: Boolean(p.volunteerId),
  }
}

function StudentsNav() {
  const a = useStudentAccess()
  const links = [
    { to: '/students', label: 'الطلاب', end: true, show: true },
    { to: '/students/classes', label: 'الحصص والحضور', show: true },
    { to: '/students/admissions', label: 'القبول', show: a.all },
    { to: '/students/groups', label: 'المجموعات', show: a.all },
    { to: '/students/requests', label: 'الطلبات', show: a.review },
    { to: '/students/stats', label: 'الإحصائيات', show: a.all },
  ].filter((l) => l.show)
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-line">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) =>
            clsx('flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-semibold transition', isActive ? 'bg-brand-700 text-white' : 'text-muted hover:bg-surface')
          }
        >
          {l.label}
        </NavLink>
      ))}
    </div>
  )
}

export default function StudentsSection() {
  const a = useStudentAccess()
  return (
    <>
      <StudentsNav />
      <Routes>
        <Route index element={<StudentList />} />
        <Route path="new" element={a.edit ? <StudentForm /> : <Navigate to="/students" replace />} />
        <Route path="classes" element={<Classes />} />
        <Route path="admissions" element={a.all ? <Admissions /> : <Navigate to="/students" replace />} />
        <Route path="groups" element={a.all ? <Groups /> : <Navigate to="/students" replace />} />
        <Route path="requests" element={a.review ? <StudentRequests /> : <Navigate to="/students" replace />} />
        <Route path="import" element={a.edit && a.sensitive ? <StudentImport /> : <Navigate to="/students" replace />} />
        <Route path="stats" element={a.all ? <StudentStats /> : <Navigate to="/students" replace />} />
        <Route path=":id/edit" element={a.edit ? <StudentForm /> : <Navigate to="/students" replace />} />
        <Route path=":id" element={<StudentDetail />} />
        <Route path="*" element={<Navigate to="/students" replace />} />
      </Routes>
    </>
  )
}

interface Filters { grade: string; status: string; group: string; gender: string }
const EMPTY: Filters = { grade: '', status: '', group: '', gender: '' }

function StudentList() {
  const a = useStudentAccess()
  const navigate = useNavigate()
  const term = useCurrentTerm()
  const students = useStudents()
  const grades = useGrades()
  const groups = useGroups(term.data?.id)
  const members = useQuery({
    queryKey: ['students', 'group-members', term.data?.id],
    enabled: Boolean(term.data?.id),
    queryFn: async () => {
      const { data, error } = await sdb().from('group_members').select('group_id, student_id')
      if (error) throw error
      return data as { group_id: string; student_id: string }[]
    },
  })
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const active = Object.values(filters).filter(Boolean).length

  const rows = useMemo(() => {
    const s = search.trim()
    const inGroup = filters.group ? new Set((members.data ?? []).filter((m) => m.group_id === filters.group).map((m) => m.student_id)) : null
    return (students.data ?? []).filter((r) => {
      if (s && !(r.full_name.includes(s) || r.carnet_no?.includes(s))) return false
      if (filters.grade && r.enrollment?.grade !== filters.grade) return false
      if (filters.status && (r.enrollment?.status ?? 'مش مقيد') !== filters.status) return false
      if (filters.gender && r.gender !== filters.gender) return false
      if (inGroup && !inGroup.has(r.id)) return false
      return true
    })
  }, [students.data, members.data, search, filters])

  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }))

  return (
    <>
      <PageHeader
        title="الطلاب"
        subtitle={
          students.data
            ? `بيظهر ${rows.length} من ${students.data.length}${term.data ? ` · ${term.data.name}` : ''}`
            : undefined
        }
        actions={
          a.edit && (
            <div className="flex gap-2">
              {a.sensitive && (
                <Button variant="secondary" onClick={() => navigate('/students/import')}>
                  <Upload className="size-4" /> رفع شيت
                </Button>
              )}
              <Button onClick={() => navigate('/students/new')}>
                <Plus className="size-4" /> طالب جديد
              </Button>
            </div>
          )
        }
      />
      {!term.isLoading && !term.data && (
        <Card className="mb-3 text-sm text-orange-700">مفيش ترم حالي. {a.edit ? 'اعمل ترم من «القبول».' : 'كلّم التنظيم.'}</Card>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-3 top-2.5 size-5 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو رقم الكارنيه" className="ps-10" />
        </div>
        <Button variant={active ? 'primary' : 'secondary'} onClick={() => setShowFilters((x) => !x)}>
          <Filter className="size-4" /> فلاتر{active ? ` (${active})` : ''}
        </Button>
      </div>
      {showFilters && (
        <Card className="mb-3 grid gap-3 sm:grid-cols-4">
          <Field label="السنة">
            <Select value={filters.grade} onChange={(e) => set('grade', e.target.value)} options={grades.data ?? []} placeholder="الكل" />
          </Field>
          <Field label="الحالة">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)} options={[...ENROLLMENT_STATUSES, 'مش مقيد']} placeholder="الكل" />
          </Field>
          <Field label="المجموعة">
            <Select value={filters.group} onChange={(e) => set('group', e.target.value)} options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))} placeholder="الكل" />
          </Field>
          <Field label="النوع">
            <Select value={filters.gender} onChange={(e) => set('gender', e.target.value)} options={['ذكر', 'أنثى']} placeholder="الكل" />
          </Field>
          {active > 0 && (
            <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
              امسح الفلاتر
            </Button>
          )}
        </Card>
      )}
      {students.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش طلاب">{a.all ? 'ضيف طالب أو غيّر الفلاتر.' : 'مفيش طلاب في حصصك لسه.'}</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-start">السنة</th>
                <th className="p-2 text-start">الحالة</th>
                <th className="p-2 text-start">الغياب</th>
                <th className="hidden p-2 text-start sm:table-cell">السن</th>
                <th className="hidden p-2 text-start md:table-cell">المدرسة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/students/${r.id}`)} className="cursor-pointer border-t border-line hover:bg-surface">
                  <td className="p-2 font-semibold">{r.full_name}</td>
                  <td className="p-2">{r.enrollment?.grade ?? '—'}</td>
                  <td className="p-2">
                    {r.enrollment ? <Badge tone={ENROLLMENT_TONE[r.enrollment.status]}>{r.enrollment.status}</Badge> : <Badge>مش مقيد</Badge>}
                  </td>
                  <td className={clsx('p-2', r.absences >= 3 && 'font-bold text-orange-700')}>{r.absences}</td>
                  <td className="hidden p-2 sm:table-cell">{ageFrom(r.birth_date) ?? '—'}</td>
                  <td className="hidden p-2 md:table-cell">{r.school ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

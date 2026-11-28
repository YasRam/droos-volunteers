import clsx from 'clsx'
import { Cake, Filter, Plus, Search, Upload } from 'lucide-react'
import { lazy, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { ageFrom } from '@/lib/data'
import { daysToBirthday, ENROLLMENT_STATUSES, ENROLLMENT_TONE, useCurrentTerm, useGrades, useGroups, useStudents } from '@/lib/students'
import { useQuery } from '@tanstack/react-query'
import { sdb } from '@/lib/students'

const StudentForm = lazy(() => import('./StudentForm'))
const StudentDetail = lazy(() => import('./StudentDetail'))
const Admissions = lazy(() => import('./Admissions'))
const Groups = lazy(() => import('./Groups'))
const StudentRequests = lazy(() => import('./StudentRequests'))
const StudentStats = lazy(() => import('./StudentStats'))
const StudentImport = lazy(() => import('./StudentImport'))
const ExpiringIdsPage = lazy(() => import('./StudentStats').then((m) => ({ default: () => m.ExpiringIds({}) })))
const StudentRulesPage = lazy(() => import('@/components/StudentRules').then((m) => ({ default: m.StudentRulesPage })))

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

export default function StudentsSection() {
  const a = useStudentAccess()
  return (
    <>
      <Routes>
        <Route index element={<StudentList />} />
        <Route path="new" element={a.edit ? <StudentForm /> : <Navigate to="/students" replace />} />
        <Route path="classes" element={<Navigate to="/classes" replace />} />
        <Route path="admissions" element={a.all ? <Admissions /> : <Navigate to="/students" replace />} />
        <Route path="groups" element={a.all ? <Groups /> : <Navigate to="/students" replace />} />
        <Route path="requests" element={a.review ? <StudentRequests /> : <Navigate to="/students" replace />} />
        <Route path="import" element={a.edit && a.sensitive ? <StudentImport /> : <Navigate to="/students" replace />} />
        <Route path="rules" element={a.all ? <StudentRulesPage /> : <Navigate to="/students" replace />} />
        <Route path="ids" element={a.all ? <ExpiringIdsPage /> : <Navigate to="/students" replace />} />
        <Route path="stats" element={a.all ? <StudentStats /> : <Navigate to="/students" replace />} />
        <Route path=":id/edit" element={a.edit ? <StudentForm /> : <Navigate to="/students" replace />} />
        <Route path=":id" element={<StudentDetail />} />
        <Route path="*" element={<Navigate to="/students" replace />} />
      </Routes>
    </>
  )
}

interface Filters { grade: string; status: string; group: string; gender: string; shift: string; school: string; minAbsences: string }
const EMPTY: Filters = { grade: '', status: '', group: '', gender: '', shift: '', school: '', minAbsences: '' }
type SortKey = 'name' | 'grade' | 'status' | 'absences' | 'age' | 'school'

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
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const gradeOrder = useMemo(() => new Map((grades.data ?? []).map((g, i) => [g, i])), [grades.data])
  const active = Object.values(filters).filter(Boolean).length

  const rows = useMemo(() => {
    const s = search.trim()
    const inGroup = filters.group ? new Set((members.data ?? []).filter((m) => m.group_id === filters.group).map((m) => m.student_id)) : null
    const filtered = (students.data ?? []).filter((r) => {
      if (s && !(r.full_name.includes(s) || r.carnet_no?.includes(s))) return false
      if (filters.grade && r.enrollment?.grade !== filters.grade) return false
      if (filters.status && (r.enrollment?.status ?? 'مش مقيد') !== filters.status) return false
      if (filters.gender && r.gender !== filters.gender) return false
      if (inGroup && !inGroup.has(r.id)) return false
      if (filters.shift && r.school_shift !== filters.shift) return false
      if (filters.school && !(r.school ?? '').includes(filters.school.trim())) return false
      if (filters.minAbsences && r.absences < Number(filters.minAbsences)) return false
      return true
    })
    const val = (r: (typeof list)[number]): string | number => {
      switch (sort.key) {
        case 'grade': return gradeOrder.get(r.enrollment?.grade ?? '') ?? 999
        case 'status': return r.enrollment?.status ?? 'ي'
        case 'absences': return r.absences
        case 'age': return r.birth_date ? -Date.parse(r.birth_date) : Number.MAX_SAFE_INTEGER
        case 'school': return r.school ?? 'ي'
        default: return r.full_name
      }
    }
    const list = filtered
    return [...list].sort((x, y) => {
      const a1 = val(x), b1 = val(y)
      const c = typeof a1 === 'number' && typeof b1 === 'number' ? a1 - b1 : String(a1).localeCompare(String(b1), 'ar')
      return (sort.desc ? -c : c) || x.full_name.localeCompare(y.full_name, 'ar')
    })
  }, [students.data, members.data, search, filters, sort, gradeOrder])
  const head = (key: SortKey, label: string, cls = '') => (
    <th className={clsx('p-2 text-start', cls)}>
      <button type="button" className="font-semibold hover:text-ink" onClick={() => setSort((x) => ({ key, desc: x.key === key ? !x.desc : key === 'absences' }))}>
        {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

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
          <Field label="الفترة">
            <Select value={filters.shift} onChange={(e) => set('shift', e.target.value)} options={['صباحي', 'مسائي']} placeholder="الكل" />
          </Field>
          <Field label="المدرسة">
            <Input value={filters.school} onChange={(e) => set('school', e.target.value)} placeholder="جزء من الاسم" />
          </Field>
          <Field label="غياب الترم على الأقل">
            <Input type="number" min={0} value={filters.minAbsences} onChange={(e) => set('minAbsences', e.target.value)} />
          </Field>
          {active > 0 && (
            <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
              امسح الفلاتر
            </Button>
          )}
        </Card>
      )}
      <Birthdays list={students.data ?? []} />
      {students.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش طلاب">{a.all ? 'ضيف طالب أو غيّر الفلاتر.' : 'مفيش طلاب في حصصك لسه.'}</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                {head('name', 'الاسم')}
                {head('grade', 'السنة')}
                {head('status', 'الحالة')}
                {head('absences', 'الغياب')}
                {head('age', 'السن', 'hidden sm:table-cell')}
                {head('school', 'المدرسة', 'hidden md:table-cell')}
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

/** Students (this term) whose birthday is in the coming two weeks. */
function Birthdays({ list }: { list: { id: string; full_name: string; birth_date: string | null; enrollment?: { grade: string } | null }[] }) {
  const [open, setOpen] = useState(false)
  const soon = list
    .filter((s) => s.enrollment)
    .map((s) => ({ ...s, days: daysToBirthday(s.birth_date) }))
    .filter((s): s is typeof s & { days: number } => s.days !== null && s.days <= 14)
    .sort((a, b) => a.days - b.days)
  if (!soon.length) return null
  const today = soon.filter((s) => s.days === 0)
  return (
    <Card className="mb-3 bg-pink-50 ring-pink-200">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-start" onClick={() => setOpen(!open)}>
        <Cake className="size-5 text-pink-600" />
        <span className="font-bold">أعياد ميلاد الطلاب</span>
        <span className="text-sm text-muted">
          {today.length ? `النهارده: ${today.map((s) => s.full_name.split(' ')[0]).join('، ')} · ` : ''}
          {soon.length} خلال أسبوعين
        </span>
        <span className="ms-auto text-xs text-brand-700">{open ? 'إخفاء' : 'عرض'}</span>
      </button>
      {open && (
        <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {soon.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm">
              <Link to={`/students/${s.id}`} className="truncate font-semibold hover:underline">{s.full_name}</Link>
              <span className="shrink-0 text-xs text-muted">
                {s.enrollment?.grade} · {s.days === 0 ? 'النهارده 🎂' : s.days === 1 ? 'بكرة' : `بعد ${s.days} يوم`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

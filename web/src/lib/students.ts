import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Everything about students lives in the «students» schema. */
export const sdb = () => supabase.schema('students')

export type EnrollmentStatus = 'نشط' | 'تحذير' | 'مفصول' | 'منقطع' | 'اتنقل'
export const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['نشط', 'تحذير', 'مفصول', 'منقطع', 'اتنقل']
export const APPLICATION_STATUSES = ['انتظار', 'لم يمتحن', 'انتظار التصحيح', 'إعادة امتحان', 'مقبول', 'مرفوض', 'بلاك ليست'] as const
export const PAPERS = ['ناقص', 'التحقق من الورق', 'تم'] as const
export const GROUP_KINDS = ['تأسيس', 'ولاد', 'بنات', 'ورشة', 'أخرى']
export const RELATIONS = ['أب', 'أم', 'عم', 'خال', 'جد', 'جدة', 'أخ', 'أخت', 'أخرى']

export interface Term { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }
export interface Student {
  id: string
  full_name: string
  gender: string | null
  birth_date: string | null
  school: string | null
  school_shift: string | null
  carnet_no: string | null
  guardian_id: string | null
  notes: string | null
  created_at: string
}
export interface Enrollment { id: string; student_id: string; term_id: string; grade: string; status: EnrollmentStatus; status_note: string | null; status_at: string }
export interface Application {
  id: string
  student_id: string
  term_id: string
  grade: string
  is_new: boolean
  status: (typeof APPLICATION_STATUSES)[number]
  papers: (typeof PAPERS)[number]
  carnet_given: boolean
  notes: string | null
  created_at: string
}
export interface Group { id: string; term_id: string; name: string; kind: string; notes: string | null; grade: string | null }
export interface ClassSession {
  id: string
  slot_id: string | null
  on_date: string
  starts_at: string
  ends_at: string
  subject: string
  kind: 'حصة' | 'امتحان'
  takes_attendance: boolean
  status: 'متوقعة' | 'اتعملت' | 'اتلغت' | 'اتأجلت'
  moved_to: string | null
  teacher_ids: string[]
  substitute_id: string | null
  max_score: number | null
  attendance_at: string | null
  present_count: number | null
  notes: string | null
  needs_substitute?: boolean
}
export interface Mark { code: string; description: string | null; is_present: boolean; counts_absence: boolean; is_violation: boolean; sort_order: number }
export interface Audience { id: string; slot_id: string | null; session_id: string | null; target: 'all' | 'grade' | 'group' | 'student'; grade: string | null; group_id: string | null; student_id: string | null }
export interface Flag { id: string; student_id: string; kind: 'استدعاء' | 'فصل مؤقت'; reason: string; from_date: string; to_date: string | null; guardian_came_on: string | null; lifted_at: string | null; created_at: string }
export interface Leave { id: string; student_id: string; from_date: string; to_date: string; reason: string | null }
export interface Note { id: string; student_id: string; body: string; for_guardian: boolean; created_by: string | null; created_at: string }
export interface AttendanceRow { session_id: string; student_id: string; mark: string; note: string | null }
export interface RosterRow { student_id: string; full_name: string; grade: string | null; mark: string | null; note: string | null; suggested: string | null; call_in: boolean; score: number | null }

/** A student row with what the lists show. */
export interface StudentRow extends Student {
  enrollment: Enrollment | null
  absences: number
}

async function all<T>(q: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q()
  if (error) throw error
  return data as T
}

export function useTerms() {
  return useQuery({
    queryKey: ['students', 'terms'],
    staleTime: 10 * 60_000,
    queryFn: () => all<Term[]>(() => sdb().from('terms').select('*').order('starts_on', { ascending: false })),
  })
}
export function useCurrentTerm() {
  const t = useTerms()
  return { ...t, data: t.data?.find((x) => x.is_current) ?? null }
}

export function useGrades() {
  return useQuery({
    queryKey: ['students', 'grades'],
    staleTime: 30 * 60_000,
    queryFn: async () => (await all<{ code: string }[]>(() => sdb().from('grades').select('code').eq('is_active', true).order('sort_order'))).map((g) => g.code),
  })
}

export function useMarks() {
  return useQuery({
    queryKey: ['students', 'marks'],
    staleTime: 30 * 60_000,
    queryFn: () => all<Mark[]>(() => sdb().from('attendance_marks').select('*').eq('is_active', true).order('sort_order')),
  })
}

export function useGroups(termId?: string | null) {
  return useQuery({
    queryKey: ['students', 'groups', termId],
    enabled: Boolean(termId),
    queryFn: () => all<Group[]>(() => sdb().from('groups').select('*').eq('term_id', termId!).order('name')),
  })
}

/** Every student this person may see, with this term's enrollment and absence count. */
export function useStudents() {
  const term = useCurrentTerm()
  return useQuery({
    queryKey: ['students', 'list', term.data?.id],
    enabled: !term.isLoading,
    queryFn: async () => {
      const [students, enrollments, absences] = await Promise.all([
        all<Student[]>(() => sdb().from('students').select('*').order('full_name')),
        term.data ? all<Enrollment[]>(() => sdb().from('enrollments').select('*').eq('term_id', term.data!.id)) : Promise.resolve([]),
        term.data ? termAbsences(term.data) : Promise.resolve(new Map<string, number>()),
      ])
      const byStudent = new Map(enrollments.map((e) => [e.student_id, e]))
      return students.map((s) => ({ ...s, enrollment: byStudent.get(s.id) ?? null, absences: absences.get(s.id) ?? 0 })) as StudentRow[]
    },
  })
}

/** Absences per student in a term (marks that count, in classes that take attendance). */
async function termAbsences(term: Term) {
  const marks = await all<Mark[]>(() => sdb().from('attendance_marks').select('*'))
  const counting = marks.filter((m) => m.counts_absence).map((m) => m.code)
  const rows = await all<{ student_id: string; session: { on_date: string; takes_attendance: boolean; status: string } | null }[]>(() =>
    sdb()
      .from('attendance')
      .select('student_id, session:class_sessions!inner(on_date, takes_attendance, status)')
      .in('mark', counting.length ? counting : ['—'])
      .gte('session.on_date', term.starts_on)
      .lte('session.on_date', term.ends_on),
  )
  const out = new Map<string, number>()
  for (const r of rows) {
    if (!r.session?.takes_attendance || r.session.status === 'اتلغت') continue
    out.set(r.student_id, (out.get(r.student_id) ?? 0) + 1)
  }
  return out
}

export const ENROLLMENT_TONE: Record<EnrollmentStatus, 'green' | 'orange' | 'red' | 'gray' | 'blue'> = {
  نشط: 'green',
  تحذير: 'orange',
  مفصول: 'red',
  منقطع: 'gray',
  اتنقل: 'blue',
}

/** Birth date and gender from an Egyptian national ID (null when it doesn't look right). */
export function fromNationalId(nid: string): { birth_date: string; gender: 'ذكر' | 'أنثى' } | null {
  if (!/^[23]\d{13}$/.test(nid)) return null
  const year = (nid[0] === '3' ? 2000 : 1900) + Number(nid.slice(1, 3))
  const month = Number(nid.slice(3, 5))
  const day = Number(nid.slice(5, 7))
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return { birth_date: d.toISOString().slice(0, 10), gender: Number(nid[12]) % 2 === 1 ? 'ذكر' : 'أنثى' }
}

/** «محمد أحمد علي» → «أحمد علي»: the father's name from the student's. */
export const fatherFromStudentName = (name: string) => name.trim().split(/\s+/).slice(1).join(' ')

export const PHONE_RE = /^01[0125]\d{8}$/
/** A landline: 0 + 8 digits (03xxxxxxx). No WhatsApp. */
export const LANDLINE_RE = /^0[2-9]\d{7}$/
/** «1001492240» / «+20 100 149 2240» → «01001492240». */
export function normalizePhone(raw: string) {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('20') && d.length === 12) d = d.slice(2)
  if (d.length === 10 && d.startsWith('1')) d = '0' + d
  if (d.length === 8 && /^[2-9]/.test(d)) d = '0' + d
  return d
}

/** True when the signed-in volunteer teaches a weekly class (so they see their own students). */
export function useTeaches(volunteerId: string | null) {
  return useQuery({
    queryKey: ['students', 'teaches', volunteerId],
    enabled: Boolean(volunteerId),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('schedule_slots')
        .select('id', { count: 'exact', head: true })
        .or(`volunteer_id.eq.${volunteerId},co_teachers.cs.{${volunteerId}}`)
      if (error) throw error
      return (count ?? 0) > 0
    },
  })
}

export interface StudentRule {
  id: string
  body: string
  version: number
}

/** The rules guardians agree to (students.rules). */
export function useStudentRules() {
  return useQuery({
    queryKey: ['student-rules'],
    queryFn: async () => {
      const { data, error } = await sdb().from('rules').select('id, body, version, sort_order').eq('is_active', true).order('sort_order')
      if (error) throw error
      return data as StudentRule[]
    },
  })
}


/** Days until the next birthday (0 = today), from a YYYY-MM-DD birth date. */
export function daysToBirthday(birth: string | null | undefined, from = new Date()): number | null {
  if (!birth) return null
  const [, m, d] = birth.split('-').map(Number)
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let next = new Date(base.getFullYear(), m - 1, d)
  if (next < base) next = new Date(base.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - base.getTime()) / 86400_000)
}

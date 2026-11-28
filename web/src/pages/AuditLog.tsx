import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from '@/components/ui'
import { fmtDateTime, fmtShort, fmtTime } from '@/lib/data'
import { PERMISSION_LABEL, type Permission } from '@/lib/permissions'
import { supabase } from '@/lib/supabase'
import { REQUEST_LABEL, type AuditRow, type RequestStatus } from '@/lib/types'

type Row = Record<string, unknown>

/** Each section of the log and the tables it covers. */
const SECTIONS: { key: string; label: string; tables: string[] }[] = [
  { key: 'vol', label: 'بيانات المتطوعين', tables: ['volunteers', 'volunteer_private', 'volunteer_hr', 'profile_requests', 'registration_requests'] },
  { key: 'fb', label: 'الفيد باك', tables: ['volunteer_feedback', 'feedback'] },
  { key: 'acts', label: 'المشاركات والاجتماعات', tables: ['participations', 'group_activities', 'meetings', 'meeting_photos'] },
  { key: 'classes', label: 'الحصص', tables: ['schedule_slots', 'class_sessions', 'audiences', 'class_absences', 'slot_requests', 'schedule_pauses'] },
  { key: 'stu', label: 'بيانات الطلاب', tables: ['students', 'student_private', 'phones', 'guardians', 'care_notes', 'family_finance', 'change_requests'] },
  { key: 'adm', label: 'القبول والمجموعات', tables: ['applications', 'enrollments', 'terms', 'groups', 'group_members', 'whatsapp_groups'] },
  { key: 'att', label: 'الغياب والسلوك', tables: ['attendance', 'exam_results', 'flags', 'leaves', 'notes', 'dismissal_requests'] },
  { key: 'perm', label: 'الصلاحيات', tables: ['staff_roles', 'roles', 'committee_leaders'] },
  { key: 'req', label: 'الطلبات', tables: ['certificate_requests', 'tshirt_requests', 'camp_registrations'] },
  { key: 'set', label: 'الإعدادات', tables: ['lookups', 'stages', 'camps', 'activity_rules', 'rules', 'backup'] },
]
const AREAS: Record<string, string> = {
  volunteers: 'بيانات المتطوعين', volunteer_private: 'الرقم القومي', volunteer_hr: 'المقابلة', participations: 'المشاركات',
  group_activities: 'نشاط جماعي', schedule_slots: 'الحصص الأسبوعية', staff_roles: 'الصلاحيات', roles: 'أنواع الصلاحيات',
  committee_leaders: 'ليدر اللجان', lookups: 'القوائم', certificate_requests: 'شهادات التطوع', backup: 'النسخ الاحتياطية',
  meetings: 'الاجتماعات', profile_requests: 'طلبات تعديل البيانات', volunteer_feedback: 'فيد باك متطوع', feedback: 'فيد باك طالب',
  students: 'الطلاب', student_private: 'بيانات الطالب الحساسة', phones: 'أرقام ولي الأمر', guardians: 'أولياء الأمور',
  care_notes: 'ملاحظات للتنظيم', family_finance: 'دخل الأسرة', applications: 'طلبات الالتحاق', enrollments: 'التقييد',
  groups: 'المجموعات', group_members: 'أعضاء المجموعات', attendance: 'الغياب', exam_results: 'الدرجات', flags: 'إجراءات',
  leaves: 'الإجازات', class_sessions: 'الحصص بالتاريخ', audiences: 'الحصة لمين', class_absences: 'اعتذارات المدرسين',
  slot_requests: 'طلبات الحصص', schedule_pauses: 'إيقاف الحصص', dismissal_requests: 'طلبات الفصل', terms: 'الترمات',
}

const FIELD: Record<string, string> = {
  full_name_ar: 'الاسم',
  full_name_en: 'الاسم بالإنجليزي',
  phone: 'التليفون',
  whatsapp: 'الواتساب',
  email: 'الإيميل',
  qualification: 'المؤهل',
  job: 'الشغل',
  area: 'المنطقة',
  availability_notes: 'المواعيد المتاحة',
  referral_source: 'عرفنا منين',
  birth_date: 'تاريخ الميلاد',
  gender: 'النوع',
  status: 'الحالة',
  position: 'الوظيفة',
  main_committee: 'اللجنة الأساسية',
  sub_committee: 'اللجنة الفرعية',
  contacted: 'اتواصلنا معاه',
  passed_committee_test: 'عدّى اختبار اللجنة',
  joined_group: 'دخل الجروب',
  is_active: 'نشط',
  bought_tshirt: 'اشترى التيشيرت',
  attended_minicamp: 'حضر الكامب',
  minicamp_date: 'تاريخ الكامب',
  national_id: 'الرقم القومي',
  acceptance: 'درجة القبول',
  interview_date: 'تاريخ المقابلة',
  interviewer: 'القائم على المقابلة',
  hr_notes: 'ملاحظات HR',
  activity_date: 'التاريخ',
  event: 'الحدث',
  subject: 'نوع الحدث',
  grade: 'السنة',
  place: 'المكان',
  beneficiaries: 'عدد الطلاب',
  notes: 'ملاحظات',
  day: 'اليوم',
  starts_at: 'من',
  ends_at: 'إلى',
  teacher_name: 'المدرس',
  name: 'الاسم',
  description: 'الوصف',
  committee: 'اللجنة',
  role: 'الصلاحية',
  purpose: 'الغرض',
  review_note: 'ملاحظة الرد',
  facebook: 'الفيسبوك',
  study_year: 'السنة الدراسية',
  follower_id: 'المتابع',
  follower_trainee_id: 'متابع تحت التدريب',
  follow_head_id: 'هيد المتابعة',
  follow_notes_1: 'ملاحظات 1',
  follow_notes_2: 'ملاحظات 2',
  follow_notes_3: 'ملاحظات 3',
  out_reason: 'سبب الخروج',
  meeting_date: 'تاريخ الاجتماع',
  head_role: 'دور الهيد',
  meeting_type: 'نوع الاجتماع',
  goal: 'الهدف',
  achievements: 'الإنجازات',
  minutes_link: 'لينك المحضر',
  attendees_extra: 'حاضرين تانيين',
}
const SKIP = new Set([
  'id', 'updated_at', 'updated_by', 'created_at', 'created_by', 'reviewed_at', 'reviewed_by', 'status_changed_at', 'requested_at',
  'volunteer_id', 'group_activity_id', 'legacy_code', 'code', 'registered_at', 'method', 'sort_order', 'permissions', 'key',
  'is_builtin', 'requested_national_id', 'id_card_path', 'link', 'form', 'report_column', 'meeting_id', 'head_id',
])

function show(v: unknown, key?: string): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا'
  if (key === 'status' && typeof v === 'string' && v in REQUEST_LABEL) return REQUEST_LABEL[v as RequestStatus]
  if (key === 'starts_at' || key === 'ends_at') return fmtTime(String(v))
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtShort(v)
  return String(v)
}

function changes(a: Row | null, b: Row | null) {
  if (!a || !b) return []
  return Object.keys({ ...a, ...b })
    .filter((k) => !SKIP.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ key: k, label: FIELD[k] ?? k, from: show(a[k], k), to: show(b[k], k) }))
}

const activity = (r: Row | null) => (r ? [show(r.activity_date), r.event, r.subject, r.grade].filter((x) => x && x !== '—').join(' · ') : '')
const slot = (r: Row | null) => (r ? [r.day, show(r.starts_at, 'starts_at'), r.subject, r.grade].filter(Boolean).join(' · ') : '')

/** One plain sentence: what was done, to whom. */
function sentence(r: AuditRow): string {
  const o = r.old_row
  const n = r.new_row
  const who = r.target_name ?? ''
  switch (r.table_name) {
    case 'volunteers':
      return r.action === 'INSERT' ? `ضاف متطوع جديد: ${who}` : r.action === 'DELETE' ? `مسح المتطوع ${who}` : `عدّل بيانات ${who}`
    case 'volunteer_private':
      return `غيّر الرقم القومي بتاع ${who}`
    case 'volunteer_hr':
      return r.action === 'INSERT' ? `بدأ ملف المقابلة لـ ${who}` : `عدّل بيانات المقابلة بتاعة ${who}`
    case 'participations':
      if (r.action === 'INSERT') return `${n?.status === 'pending' ? 'طلب تسجيل' : 'سجّل'} حضور ${who}: ${activity(n)}`
      if (r.action === 'DELETE') return `مسح مشاركة ${who}: ${activity(o)}`
      if (o?.status !== n?.status && n?.status !== 'pending') return `${n?.status === 'accepted' ? 'وافق على' : 'رفض'} حضور ${who}: ${activity(n)}`
      return `عدّل مشاركة ${who}: ${activity(n)}`
    case 'group_activities':
      return `سجّل نشاط جماعي: ${activity(n ?? o)}`
    case 'schedule_slots':
      return r.action === 'INSERT' ? `ضاف حصة: ${slot(n)}` : r.action === 'DELETE' ? `مسح حصة: ${slot(o)}` : `عدّل حصة: ${slot(n)}`
    case 'staff_roles':
      return r.action === 'DELETE' ? `شال صلاحية «${o?.role}» من ${o?.full_name}` : r.action === 'INSERT' ? `ادّى ${n?.full_name} صلاحية «${n?.role}»` : `عدّل صلاحية ${n?.full_name}`
    case 'committee_leaders':
      return r.action === 'DELETE' ? `شال ${o?.full_name} من ليدر ${o?.committee}` : `خلّى ${n?.full_name} ليدر لجنة ${n?.committee}`
    case 'roles':
      return r.action === 'INSERT' ? `عمل نوع صلاحية جديد «${n?.name}»` : r.action === 'DELETE' ? `مسح نوع الصلاحية «${o?.name}»` : `عدّل نوع الصلاحية «${n?.name}»`
    case 'lookups':
      return r.action === 'DELETE'
        ? `مسح «${o?.value}» من قايمة ${o?.list} (البيانات القديمة زي ما هي)`
        : `غيّر «${o?.value}» لـ «${n?.value}» في قايمة ${n?.list}${Number(n?.rows_updated) ? ` وحدّث ${n?.rows_updated} سجل` : ''}`
    case 'certificate_requests':
      return r.action === 'INSERT' ? `${who} طلب شهادة تطوع` : `رد على طلب شهادة ${who}: ${show(n?.status, 'status')}`
    case 'meetings':
      return r.action === 'INSERT' ? `سجّل اجتماع ${n?.committee} يوم ${show(n?.meeting_date)}` : r.action === 'DELETE' ? `مسح اجتماع ${o?.committee} يوم ${show(o?.meeting_date)}` : `عدّل اجتماع ${n?.committee}`
    case 'students':
      return r.action === 'INSERT' ? `ضاف طالب: ${who}` : r.action === 'DELETE' ? `مسح الطالب ${who}` : `عدّل بيانات الطالب ${who}`
    case 'attendance':
      return `سجّل «${String(n?.mark ?? o?.mark ?? '')}» للطالب ${who}`
    case 'applications':
      return r.action === 'INSERT' ? `طلب التحاق لـ ${who}` : `غيّر طلب التحاق ${who}: ${show(n?.status)}`
    case 'enrollments':
      return r.action === 'INSERT' ? `قيّد ${who} في ${String(n?.grade ?? '')}` : `غيّر تقييد ${who}${n?.status !== o?.status ? `: ${show(n?.status)}` : ''}`
    case 'volunteer_feedback':
    case 'feedback':
      return r.action === 'DELETE' ? `مسح فيد باك عن ${who}` : `كتب فيد باك عن ${who}`
    case 'class_sessions':
      return r.action === 'INSERT' ? `اتعملت حصة ${String(n?.subject ?? '')} يوم ${show(n?.on_date)}` : `عدّل حصة ${String(n?.subject ?? o?.subject ?? '')} يوم ${show((n ?? o)?.on_date)}${n?.status !== o?.status ? `: ${show(n?.status)}` : ''}`
    case 'backup':
      return `استرجع نسخة احتياطية متاخدة ${n?.exported_at ? fmtDateTime(String(n.exported_at)) : ''} (كل البيانات اترجعت لحالتها وقتها)`
    default:
      return `${r.action} في ${r.table_name}`
  }
}

function PermissionChanges({ r }: { r: AuditRow }) {
  if (r.table_name !== 'roles' || r.action !== 'UPDATE') return null
  const a = new Set((r.old_row?.permissions as string[]) ?? [])
  const b = new Set((r.new_row?.permissions as string[]) ?? [])
  const added = [...b].filter((x) => !a.has(x))
  const removed = [...a].filter((x) => !b.has(x))
  if (!added.length && !removed.length) return null
  const label = (k: string) => PERMISSION_LABEL[k as Permission] ?? k
  return (
    <ul className="mt-1.5 space-y-0.5 rounded-lg bg-surface px-3 py-2 text-xs">
      {added.map((k) => (
        <li key={k} className="text-emerald-700">
          + {label(k)}
        </li>
      ))}
      {removed.map((k) => (
        <li key={k} className="text-red-600">
          − {label(k)}
        </li>
      ))}
    </ul>
  )
}

const PAGE = 60
const TONE = { INSERT: 'green', UPDATE: 'blue', DELETE: 'red' } as const
const VERB = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'مسح' } as const

export default function AuditLog() {
  const [area, setArea] = useState('')
  const [actor, setActor] = useState('')
  const [search, setSearch] = useState('')
  const actors = useQuery({
    queryKey: ['audit-actors'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('audit_actors')
      if (error) throw error
      return (data as { actor_email: string; actor_name: string }[])
        .map((r) => ({ value: r.actor_email, label: r.actor_name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar'))
    },
  })
  const q = useInfiniteQuery({
    queryKey: ['audit', area, actor],
    initialPageParam: 0,
    getNextPageParam: (last: AuditRow[], all) => (last.length === PAGE ? all.length * PAGE : undefined),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('audit_feed', {
        p_tables: area ? (SECTIONS.find((x) => x.key === area)?.tables ?? null) : null,
        p_actor: actor || null,
        p_offset: pageParam,
        p_limit: PAGE,
      })
      if (error) throw error
      return data as AuditRow[]
    },
  })
  const rows = useMemo(() => {
    const all = q.data?.pages.flat() ?? []
    const s = search.trim()
    return s ? all.filter((r) => (r.target_name ?? '').includes(s) || (r.actor_name ?? '').includes(s)) : all
  }, [q.data, search])

  return (
    <>
      <PageHeader title="السجل" subtitle="كل تغيير في السيستم: مين عمله، وعمل إيه، وإيه اللي اتغير" />
      <Card className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select value={area} onChange={(e) => setArea(e.target.value)} placeholder="كل الأقسام" options={SECTIONS.map((x) => ({ value: x.key, label: x.label }))} />
        <Select value={actor} onChange={(e) => setActor(e.target.value)} placeholder="كل الناس" options={actors.data ?? []} />
        <div className="relative">
          <Search className="absolute start-3 top-2.5 size-5 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم" className="ps-10" />
        </div>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش تغييرات" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => {
            const diff = r.action === 'UPDATE' && !['lookups', 'roles'].includes(r.table_name) ? changes(r.old_row, r.new_row) : []
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <Badge tone={TONE[r.action]}>{VERB[r.action]}</Badge>
                  <span>{AREAS[r.table_name] ?? r.table_name}</span>
                  <span>· {fmtDateTime(r.at)}</span>
                </div>
                <p className="mt-1 text-sm">
                  <span className={clsx('font-bold', r.actor_name === 'السيستم' ? 'text-muted' : 'text-brand-800')}>{r.actor_name ?? '—'}</span> {sentence(r)}
                  {r.target_student_id && (
                    <Link to={`/students/${r.target_student_id}`} className="ms-1 text-xs text-brand-700">
                      (الملف)
                    </Link>
                  )}
                  {r.target_volunteer_id && (
                    <>
                      {' '}
                      <VolunteerName id={r.target_volunteer_id} className="text-xs text-brand-700">
                        (الملف)
                      </VolunteerName>
                    </>
                  )}
                </p>
                {diff.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 rounded-lg bg-surface px-3 py-2 text-xs">
                    {diff.map((d) => (
                      <li key={d.key} className="flex flex-wrap items-center gap-1">
                        <span className="font-semibold">{d.label}:</span>
                        <span className="text-red-600 line-through decoration-red-300">{d.from}</span>
                        <ArrowLeft className="size-3 text-muted" />
                        <span className="font-semibold text-emerald-700">{d.to}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <PermissionChanges r={r} />
              </div>
            )
          })}
        </Card>
      )}
      {q.hasNextPage && !search && (
        <div className="mt-3 text-center">
          <Button variant="secondary" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            أقدم
          </Button>
        </div>
      )}
    </>
  )
}

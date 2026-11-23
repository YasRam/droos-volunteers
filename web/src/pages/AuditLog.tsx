import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from '@/components/ui'
import { fmtDate, fmtDateTime, useVolunteers } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { REQUEST_LABEL, ROLE_LABEL, type AppRole, type AuditRow, type CommitteeLeader, type RequestStatus, type StaffRole } from '@/lib/types'

const TABLES: Record<string, string> = {
  volunteers: 'بيانات المتطوع',
  volunteer_private: 'الرقم القومي',
  volunteer_hr: 'بيانات المقابلة',
  participations: 'المشاركات',
  group_activities: 'نشاط جماعي',
  schedule_slots: 'جدول الحصص',
  staff_roles: 'الصلاحيات',
  committee_leaders: 'ليدر اللجان',
}
const ACTIONS = { INSERT: { label: 'إضافة', tone: 'green' }, UPDATE: { label: 'تعديل', tone: 'blue' }, DELETE: { label: 'مسح', tone: 'red' } } as const
const VERB = { INSERT: 'ضاف', UPDATE: 'عدّل', DELETE: 'مسح' } as const
const SKIP = new Set(['id', 'volunteer_id', 'updated_at', 'updated_by', 'created_at', 'created_by', 'reviewed_at', 'reviewed_by', 'registered_at', 'code', 'legacy_code', 'group_activity_id', 'status_changed_at'])

const FIELDS: Record<string, string> = {
  full_name_ar: 'الاسم',
  full_name_en: 'الاسم بالإنجليزي',
  phone: 'الهاتف',
  whatsapp: 'الواتساب',
  email: 'الإيميل',
  qualification: 'المؤهل',
  job: 'الوظيفة (الشغل)',
  area: 'المنطقة',
  availability_notes: 'المواعيد والملاحظات',
  referral_source: 'عرف النشاط منين',
  birth_date: 'تاريخ الميلاد',
  gender: 'النوع',
  status: 'الحالة',
  position: 'الوظيفة في النشاط',
  main_committee: 'اللجنة الأساسية',
  sub_committee: 'اللجنة الفرعية',
  contacted: 'تم التواصل',
  passed_committee_test: 'اختبار اللجنة',
  joined_group: 'دخل الجروب',
  is_active: 'المشاركات الفعالة',
  bought_tshirt: 'اشترى التيشيرت',
  attended_minicamp: 'حضر الكامب / الميني كامب',
  minicamp_date: 'موعد الكامب',
  national_id: 'الرقم القومي',
  acceptance: 'درجة القبول',
  interview_date: 'تاريخ المقابلة',
  interviewer: 'القائم على المقابلة',
  hr_notes: 'ملاحظات HR',
  activity_date: 'التاريخ',
  event: 'الحدث',
  subject: 'نوع الحدث / المادة',
  place: 'المكان',
  grade: 'السنة',
  beneficiaries: 'عدد الطلاب',
  notes: 'ملاحظات',
  method: 'طريقة التسجيل',
  role: 'الصلاحية',
  committee: 'اللجنة',
  day: 'اليوم',
  teacher_name: 'المدرس',
  starts_at: 'من',
  ends_at: 'إلى',
}

type Row = Record<string, unknown>

function show(key: string, v: unknown, table: string): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'أيوه' : 'لأ'
  if (key === 'role') return ROLE_LABEL[v as AppRole] ?? String(v)
  if (key === 'status' && table === 'participations') return REQUEST_LABEL[v as RequestStatus] ?? String(v)
  if (key === 'method') return v === 'group' ? 'جماعي' : 'فردي'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v)
  return String(v)
}

/** Fields that changed, in Arabic: «الهاتف: 010… ← 011…». */
function changes(r: AuditRow): { label: string; from?: string; to: string }[] {
  const t = r.table_name
  if (r.action === 'UPDATE' && r.old_row && r.new_row) {
    return Object.keys(r.new_row)
      .filter((k) => !SKIP.has(k) && JSON.stringify(r.new_row![k]) !== JSON.stringify(r.old_row![k]))
      .map((k) => ({ label: FIELDS[k] ?? k, from: show(k, r.old_row![k], t), to: show(k, r.new_row![k], t) }))
  }
  const row = (r.new_row ?? r.old_row ?? {}) as Row
  return Object.keys(row)
    .filter((k) => !SKIP.has(k) && row[k] !== null && row[k] !== '' && row[k] !== false && FIELDS[k])
    .map((k) => ({ label: FIELDS[k], to: show(k, row[k], t) }))
}

export default function AuditLog() {
  const [table, setTable] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(200)
  const vols = useVolunteers()
  const people = useQuery({
    queryKey: ['tree-people'],
    queryFn: async () => {
      const [staff, leaders] = await Promise.all([supabase.from('staff_roles').select('*'), supabase.from('committee_leaders').select('*')])
      if (staff.error) throw staff.error
      if (leaders.error) throw leaders.error
      return { staff: staff.data as StaffRole[], leaders: leaders.data as CommitteeLeader[] }
    },
  })
  const q = useQuery({
    queryKey: ['audit', table, limit],
    queryFn: async () => {
      let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)
      if (table) query = query.eq('table_name', table)
      const { data, error } = await query
      if (error) throw error
      return data as AuditRow[]
    },
  })

  /** email → the volunteer's name, or the name given with the permission */
  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of people.data?.leaders ?? []) m.set(l.email.toLowerCase(), l.full_name)
    for (const s of people.data?.staff ?? []) m.set(s.email.toLowerCase(), s.full_name)
    for (const v of vols.data ?? []) if (v.email) m.set(v.email.toLowerCase(), v.full_name_ar)
    return (email: string | null) => (!email || email === 'system' ? 'السيستم' : (m.get(email.toLowerCase()) ?? email))
  }, [people.data, vols.data])
  const volName = useMemo(() => new Map((vols.data ?? []).map((v) => [v.id, v.full_name_ar])), [vols.data])

  const describe = (r: AuditRow) => {
    const row = (r.new_row ?? r.old_row ?? {}) as Row
    const vName = String(row.full_name_ar ?? volName.get(String(row.volunteer_id ?? r.record_id)) ?? 'متطوع')
    const verb = VERB[r.action]
    switch (r.table_name) {
      case 'volunteers':
        return r.action === 'INSERT' ? `ضاف متطوع جديد: ${vName}` : r.action === 'DELETE' ? `مسح المتطوع ${vName}` : `عدّل بيانات ${vName}`
      case 'volunteer_private':
        return `${verb} الرقم القومي لـ ${vName}`
      case 'volunteer_hr':
        return `${verb} بيانات المقابلة لـ ${vName}`
      case 'participations': {
        const what = `${row.event ?? ''} يوم ${show('activity_date', row.activity_date, '')}`
        if (r.action === 'UPDATE' && r.old_row?.status !== r.new_row?.status && r.new_row?.status !== 'pending')
          return `${r.new_row?.status === 'accepted' ? 'قبل' : 'رفض'} طلب حضور ${vName}: ${what}`
        return r.action === 'INSERT' ? `سجّل مشاركة لـ ${vName}: ${what}` : `${verb} مشاركة ${vName}: ${what}`
      }
      case 'group_activities':
        return `${verb} نشاط جماعي: ${row.event ?? ''} يوم ${show('activity_date', row.activity_date, '')}`
      case 'schedule_slots':
        return `${verb} حصة في الجدول: ${row.day ?? ''} ${row.subject ?? ''} ${row.grade ?? ''}`
      case 'staff_roles': {
        const who = nameOf(String(row.email ?? ''))
        const role = ROLE_LABEL[row.role as AppRole] ?? row.role
        return r.action === 'INSERT' ? `ادّى صلاحية «${role}» لـ ${who}` : r.action === 'DELETE' ? `شال صلاحية «${role}» من ${who}` : `عدّل صلاحية ${who}`
      }
      case 'committee_leaders': {
        const who = nameOf(String(row.email ?? ''))
        return r.action === 'INSERT' ? `خلّى ${who} ليدر لجنة ${row.committee}` : r.action === 'DELETE' ? `شال ${who} من ليدر لجنة ${row.committee}` : `عدّل ليدر لجنة ${row.committee}`
      }
      default:
        return `${verb} في ${TABLES[r.table_name] ?? r.table_name}`
    }
  }

  const s = search.trim()
  const rows = (q.data ?? []).filter((r) => !s || nameOf(r.actor_email).includes(s) || describe(r).includes(s))

  return (
    <>
      <PageHeader title="السجل" subtitle="مين عمل إيه، وإيه اللي اتغيّر بالظبط" />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-3 top-2.5 size-5 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر باسم اللي عمل التغيير أو المتطوع" className="ps-10" />
        </div>
        <div className="w-52">
          <Select value={table} onChange={(e) => setTable(e.target.value)} placeholder="كل التغييرات" options={Object.entries(TABLES).map(([value, label]) => ({ value, label }))} />
        </div>
      </div>
      {q.isLoading || vols.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش تغييرات" />
      ) : (
        <>
          <Card className="divide-y divide-line p-0">
            {rows.map((r) => {
              const list = changes(r)
              return (
                <div key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ACTIONS[r.action].tone}>{ACTIONS[r.action].label}</Badge>
                    <span className="font-bold">{nameOf(r.actor_email)}</span>
                    <span>{describe(r)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {fmtDateTime(r.at)} · {TABLES[r.table_name] ?? r.table_name}
                  </p>
                  {list.length > 0 && (
                    <ul className="mt-2 space-y-1 rounded-xl bg-surface px-3 py-2 text-xs">
                      {list.map((c) => (
                        <li key={c.label} className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{c.label}:</span>
                          {c.from !== undefined && (
                            <>
                              <span className="text-red-700 line-through decoration-red-300">{c.from}</span>
                              <ArrowLeft className="size-3.5 text-muted" />
                            </>
                          )}
                          <span className="text-emerald-700">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </Card>
          {q.data && q.data.length >= limit && (
            <div className="mt-3 text-center">
              <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                اعرض أقدم
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

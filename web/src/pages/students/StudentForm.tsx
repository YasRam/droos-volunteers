import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { toastError } from '@/lib/errors'
import {
  LANDLINE_RE,
  PHONE_RE,
  RELATIONS,
  fatherFromStudentName,
  fromNationalId,
  normalizePhone,
  sdb,
  useCurrentTerm,
  useGrades,
  type Student,
} from '@/lib/students'
import { useStudentAccess } from './Students'

const NID_RE = /^[23]\d{13}$/

type GuardianKind = 'father' | 'mother' | 'other'
interface Guardian {
  id: string
  full_name: string
  relation: string
  national_id: string | null
  id_valid_until: string | null
  job: string | null
  phone: string | null
  custody_document: string | null
}
interface Phone { number: string; label: string; is_whatsapp: boolean; is_main_whatsapp: boolean }
interface Form {
  full_name: string
  national_id: string
  grade: string
  is_new: boolean
  school: string
  school_shift: string
  carnet_no: string
  address: string
  phones: Phone[]
  father_name: string
  father_national_id: string
  father_id_valid_until: string
  father_job: string
  mother_name: string
  mother_national_id: string
  mother_id_valid_until: string
  mother_job: string
  father_phone: string
  mother_phone: string
  /** who is the guardian: the father (default), the mother (educational guardianship) or someone else */
  g_kind: GuardianKind
  g_name: string
  g_relation: string
  g_national_id: string
  g_phone: string
  g_valid_until: string
  g_job: string
  g_document: string
  kids_under_5: string
  kids_5_to_10: string
  boys_over_10: string
  girls_over_10: string
  family_income: string
  family_support: string
  health_notes: string
  important_notes: string
  notes: string
}
const BLANK: Form = {
  full_name: '', national_id: '', grade: '', is_new: true, school: '', school_shift: 'صباحي', carnet_no: '', address: '',
  phones: [{ number: '', label: '', is_whatsapp: true, is_main_whatsapp: true }],
  father_name: '', father_national_id: '', father_id_valid_until: '', father_job: '',
  mother_name: '', mother_national_id: '', mother_id_valid_until: '', mother_job: '',
  father_phone: '', mother_phone: '',
  g_kind: 'father', g_name: '', g_relation: 'أم', g_national_id: '', g_phone: '', g_valid_until: '', g_job: '', g_document: '',
  kids_under_5: '', kids_5_to_10: '', boys_over_10: '', girls_over_10: '',
  family_income: '', family_support: '', health_notes: '', important_notes: '', notes: '',
}

const t = (v: string) => v.trim() || null
const n = (v: string) => (v.trim() === '' ? null : Number(v))

function check(f: Form, isNew: boolean): string | null {
  if (!t(f.full_name) || f.full_name.trim().split(/\s+/).length < 3) return 'اكتب اسم الطالب ثلاثي على الأقل'
  if (isNew) {
    if (!NID_RE.test(f.national_id)) return 'الرقم القومي للطالب لازم 14 رقم ويبدأ بـ 2 أو 3'
    if (!fromNationalId(f.national_id)) return 'الرقم القومي للطالب فيه تاريخ ميلاد غلط'
    if (!f.grade) return 'اختار السنة الدراسية'
    if (!t(f.address)) return 'اكتب العنوان'
    if (!t(f.school)) return 'اكتب اسم المدرسة'
    if (!t(f.mother_name)) return 'اكتب اسم الأم'
  }
  for (const [label, v] of [['الأب', f.father_national_id], ['الأم', f.mother_national_id], ['ولي الأمر', f.g_kind === 'other' ? f.g_national_id : '']] as const) {
    if (v && !NID_RE.test(v)) return `الرقم القومي لـ${label} لازم 14 رقم ويبدأ بـ 2 أو 3`
  }
  if (f.father_national_id && f.father_national_id === f.mother_national_id) return 'الرقم القومي للأم نفس رقم الأب'
  if (f.mother_national_id && fromNationalId(f.mother_national_id)?.gender === 'ذكر') return 'الرقم القومي للأم رقم راجل'
  if (f.father_national_id && fromNationalId(f.father_national_id)?.gender === 'أنثى') return 'الرقم القومي للأب رقم ست'
  const phones = f.phones.filter((p) => p.number.trim())
  if (isNew && !phones.length) return 'اكتب رقم تليفون واحد على الأقل'
  for (const p of phones) {
    const num = normalizePhone(p.number)
    if (!PHONE_RE.test(num) && !LANDLINE_RE.test(num)) return `رقم التليفون «${p.number}» مش صح: الموبايل 11 رقم يبدأ بـ 01، والأرضي 9 أرقام يبدأ بـ 0`
  }
  if (new Set(phones.map((p) => normalizePhone(p.number))).size !== phones.length) return 'فيه رقم تليفون متكرر'
  if (!PHONE_RE.test(normalizePhone(f.g_phone))) return 'اكتب رقم ولي الأمر (11 رقم يبدأ بـ 01). ده رقم التواصل الأساسي'
  for (const [label, v] of [['الأب', f.father_phone], ['الأم', f.mother_phone]] as const)
    if (v.trim() && !PHONE_RE.test(normalizePhone(v))) return `رقم ${label} مش صح`
  if (f.g_kind === 'mother' && !t(f.mother_name)) return 'اكتب اسم الأم'
  if (f.g_kind !== 'father' && !t(f.g_document)) return 'اكتب الورقة اللي اتأكدنا منها (الولاية التعليمية أو الحضانة)'
  if (f.g_kind === 'other' && !t(f.g_name)) return 'اكتب اسم ولي الأمر'
  return null
}

export default function StudentForm() {
  const { id } = useParams()
  const isNew = !id
  const a = useStudentAccess()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const term = useCurrentTerm()
  const grades = useGrades()
  const [f, setF] = useState<Form>(BLANK)
  const [fatherTouched, setFatherTouched] = useState(false)
  const canFinance = usePermissions().can('students.finance')

  const existing = useQuery({
    queryKey: ['students', 'edit', id],
    enabled: !isNew,
    queryFn: async () => {
      const [s, priv, phones, g, care, fin] = await Promise.all([
        sdb().from('students').select('*').eq('id', id!).single(),
        sdb().from('student_private').select('*').eq('student_id', id!).maybeSingle(),
        sdb().from('phones').select('*').eq('student_id', id!).order('sort_order'),
        sdb().from('students').select('guardian:guardians(*)').eq('id', id!).maybeSingle(),
        sdb().from('care_notes').select('body').eq('student_id', id!).maybeSingle(),
        sdb().from('family_finance').select('family_income, family_support').eq('student_id', id!).maybeSingle(),
      ])
      if (s.error) throw s.error
      const guardian = ((g.data as { guardian: Guardian | null } | null)?.guardian ?? null) as Guardian | null
      return {
        s: s.data as Student,
        priv: { ...((priv.data ?? {}) as Record<string, unknown>), ...((fin.data ?? {}) as Record<string, unknown>) } as Record<string, unknown> | null,
        phones: (phones.data ?? []) as Phone[],
        guardian,
        care: (care.data as { body: string } | null)?.body ?? '',
      }
    },
  })
  useEffect(() => {
    if (!existing.data) return
    const { s, priv, phones, guardian: g, care } = existing.data
    const str = (k: string) => (priv?.[k] == null ? '' : String(priv[k]))
    const kind: GuardianKind = !g || g.relation === 'أب' ? 'father' : g.relation === 'أم' && (!g.national_id || g.national_id === str('mother_national_id')) ? 'mother' : 'other'
    setF({
      ...BLANK,
      full_name: s.full_name, school: s.school ?? '', school_shift: s.school_shift ?? 'صباحي', carnet_no: s.carnet_no ?? '',
      national_id: str('national_id'), address: str('address'),
      father_name: str('father_name'), father_national_id: str('father_national_id'), father_id_valid_until: str('father_id_valid_until'), father_job: str('father_job'),
      mother_name: str('mother_name'), mother_national_id: str('mother_national_id'), mother_id_valid_until: str('mother_id_valid_until'), mother_job: str('mother_job'),
      kids_under_5: str('kids_under_5'), kids_5_to_10: str('kids_5_to_10'), boys_over_10: str('boys_over_10'), girls_over_10: str('girls_over_10'),
      family_income: str('family_income'), family_support: str('family_support'), health_notes: str('health_notes'), important_notes: str('important_notes'),
      phones: phones.length ? phones.map((p) => ({ number: p.number, label: p.label ?? '', is_whatsapp: p.is_whatsapp, is_main_whatsapp: p.is_main_whatsapp })) : BLANK.phones,
      notes: care,
      father_phone: str('father_phone'), mother_phone: str('mother_phone'),
      g_kind: kind,
      g_phone: g?.phone ?? '',
      g_document: g?.custody_document ?? '',
      ...(kind === 'other' && g
        ? { g_name: g.full_name, g_relation: g.relation, g_national_id: g.national_id ?? '', g_valid_until: g.id_valid_until ?? '', g_job: g.job ?? '' }
        : {}),
    })
    setFatherTouched(true)
  }, [existing.data])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const onName = (v: string) => setF((x) => ({ ...x, full_name: v, father_name: fatherTouched ? x.father_name : fatherFromStudentName(v) }))

  const dupe = useQuery({
    queryKey: ['students', 'nid', f.national_id],
    enabled: isNew && NID_RE.test(f.national_id),
    queryFn: async () => {
      const { data, error } = await sdb().rpc('student_by_national_id', { p_nid: f.national_id })
      if (error) throw error
      return ((data ?? []) as { id: string; full_name: string }[])[0] ?? null
    },
  })
  const guardianNid = f.g_kind === 'other' ? f.g_national_id : f.g_kind === 'mother' ? f.mother_national_id : f.father_national_id
  const sibling = useQuery({
    queryKey: ['students', 'guardian-nid', guardianNid],
    enabled: NID_RE.test(guardianNid),
    queryFn: async () => {
      const { data, error } = await sdb().rpc('guardian_by_national_id', { p_nid: guardianNid })
      if (error) throw error
      return ((data ?? []) as { id: string; full_name: string; relation: string; children: string[] }[])[0] ?? null
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const err = check(f, isNew)
      if (err) throw { message: err }
      if (isNew && dupe.data) throw { message: `الطالب ده متسجل قبل كده: ${dupe.data.full_name}` }
      if (isNew && !term.data) throw { message: 'مفيش ترم حالي. اعمل ترم من «القبول» الأول.' }
      const phones = f.phones
        .filter((p) => p.number.trim())
        .map((p, i) => {
          const number = normalizePhone(p.number)
          const mobile = PHONE_RE.test(number)
          return { number, label: t(p.label), is_whatsapp: mobile && p.is_whatsapp, is_main_whatsapp: mobile && p.is_whatsapp && p.is_main_whatsapp, sort_order: i }
        })
      // exactly one main WhatsApp when there is any WhatsApp number
      if (phones.some((p) => p.is_whatsapp) && !phones.some((p) => p.is_main_whatsapp)) phones.find((p) => p.is_whatsapp)!.is_main_whatsapp = true

      // the guardian: the father, the mother (educational guardianship) or someone else.
      // Brothers/sisters share one guardian (same national ID); his phone is the main contact.
      const g =
        f.g_kind === 'father'
          ? { full_name: t(f.father_name) ?? fatherFromStudentName(f.full_name), relation: 'أب', national_id: t(f.father_national_id), id_valid_until: t(f.father_id_valid_until), job: t(f.father_job), custody_document: null }
          : f.g_kind === 'mother'
            ? { full_name: f.mother_name.trim(), relation: 'أم', national_id: t(f.mother_national_id), id_valid_until: t(f.mother_id_valid_until), job: t(f.mother_job), custody_document: t(f.g_document) }
            : { full_name: f.g_name.trim(), relation: f.g_relation, national_id: t(f.g_national_id), id_valid_until: t(f.g_valid_until), job: t(f.g_job), custody_document: t(f.g_document) }
      const guardianRow = { ...g, phone: normalizePhone(f.g_phone) }
      const current = existing.data?.guardian ?? null
      const sameKind = current && (current.relation === 'أب') === (f.g_kind === 'father') && (current.relation === 'أم') === (f.g_kind === 'mother')
      let guardianId: string | null = sibling.data?.id ?? (sameKind && (!current.national_id || !g.national_id || current.national_id === g.national_id) ? current.id : null)
      if (guardianId) {
        const { error } = await sdb().from('guardians').update(guardianRow).eq('id', guardianId)
        if (error) throw error
      } else {
        guardianId = crypto.randomUUID()
        const { error } = await sdb().from('guardians').insert({ id: guardianId, ...guardianRow })
        if (error) throw error
      }

      const student = { full_name: f.full_name.trim(), school: t(f.school), school_shift: f.school_shift || null, carnet_no: t(f.carnet_no) }
      const sid = id ?? crypto.randomUUID()
      if (isNew) {
        const { error } = await sdb().from('students').insert({ id: sid, ...student, guardian_id: guardianId })
        if (error) throw error
      } else {
        const { error } = await sdb().from('students').update({ ...student, guardian_id: guardianId }).eq('id', sid)
        if (error) throw error
      }

      const priv = {
        address: t(f.address),
        father_name: t(f.father_name), father_national_id: t(f.father_national_id), father_id_valid_until: t(f.father_id_valid_until), father_job: t(f.father_job),
        mother_name: t(f.mother_name), mother_national_id: t(f.mother_national_id), mother_id_valid_until: t(f.mother_id_valid_until), mother_job: t(f.mother_job),
        father_phone: t(normalizePhone(f.father_phone)), mother_phone: t(normalizePhone(f.mother_phone)),
        kids_under_5: n(f.kids_under_5), kids_5_to_10: n(f.kids_5_to_10), boys_over_10: n(f.boys_over_10), girls_over_10: n(f.girls_over_10),
        health_notes: t(f.health_notes), important_notes: t(f.important_notes),
      }
      if (isNew) {
        const { error } = await sdb().from('student_private').insert({ student_id: sid, national_id: f.national_id, ...priv })
        if (error) throw error
      } else if (a.sensitive) {
        const { error } = await sdb().from('student_private').update({ ...priv, national_id: t(f.national_id) }).eq('student_id', sid)
        if (error) throw error
      }

      if (canFinance) {
        const { error } = await sdb().from('family_finance').upsert({ student_id: sid, family_income: t(f.family_income), family_support: t(f.family_support) })
        if (error) throw error
      }
      if (t(f.notes)) {
        const { error } = await sdb().from('care_notes').upsert({ student_id: sid, body: f.notes.trim() })
        if (error) throw error
      } else if (!isNew) {
        const { error } = await sdb().from('care_notes').delete().eq('student_id', sid)
        if (error) throw error
      }

      if (isNew || a.contacts) {
        if (!isNew) {
          const { error } = await sdb().from('phones').delete().eq('student_id', sid)
          if (error) throw error
        }
        if (phones.length) {
          const { error } = await sdb().from('phones').insert(phones.map((p) => ({ ...p, student_id: sid })))
          if (error) throw error
        }
      }

      if (isNew) {
        const { error } = await sdb().from('applications').insert({ student_id: sid, term_id: term.data!.id, grade: f.grade, is_new: f.is_new })
        if (error) throw error
      }
      return sid
    },
    onSuccess: (sid) => {
      toast.success(isNew ? 'الطالب اتضاف، وطلب الالتحاق مستني في «القبول»' : 'اتحفظ')
      qc.invalidateQueries({ queryKey: ['students'] })
      navigate(`/students/${sid}`)
    },
    onError: toastError,
  })

  if (!isNew && existing.isLoading) return <Spinner />
  const showPrivate = isNew || a.sensitive
  const showContacts = isNew || a.contacts
  const nidInfo = fromNationalId(f.national_id)

  return (
    <>
      <PageHeader title={isNew ? 'طالب جديد' : `تعديل ${f.full_name}`} subtitle={isNew ? 'بعد الحفظ بيبقى طلب التحاق في «القبول» بحالة «انتظار».' : undefined} />
      <div className="max-w-3xl space-y-4">
        <Section title="الطالب">
          <Field label="اسم الطالب رباعي">
            <Input value={f.full_name} onChange={(e) => onName(e.target.value)} />
          </Field>
          {showPrivate && (
            <Field label="الرقم القومي للطالب" hint={nidInfo ? `${nidInfo.gender} · مواليد ${nidInfo.birth_date}` : undefined}>
              <Input dir="ltr" inputMode="numeric" maxLength={14} value={f.national_id} onChange={(e) => set('national_id', e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          {dupe.data && (
            <p className="text-sm text-red-700">
              الرقم ده متسجل لـ <Link className="underline" to={`/students/${dupe.data.id}`}>{dupe.data.full_name}</Link>
            </p>
          )}
          {isNew && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="السنة الدراسية">
                <Select value={f.grade} onChange={(e) => set('grade', e.target.value)} options={grades.data ?? []} placeholder="اختار" />
              </Field>
              <Field label="حالة الطالب">
                <Select value={f.is_new ? 'مستجد' : 'مقيد'} onChange={(e) => set('is_new', e.target.value === 'مستجد')} options={['مستجد', 'مقيد']} />
              </Field>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="اسم المدرسة">
              <Input value={f.school} onChange={(e) => set('school', e.target.value)} />
            </Field>
            <Field label="مواعيد المدرسة">
              <Select value={f.school_shift} onChange={(e) => set('school_shift', e.target.value)} options={['صباحي', 'مسائي']} />
            </Field>
            <Field label="رقم الكارنيه">
              <Input dir="ltr" value={f.carnet_no} onChange={(e) => set('carnet_no', e.target.value)} />
            </Field>
          </div>
        </Section>

        {showContacts && (
          <Section title="التواصل">
            {showPrivate && (
              <Field label="العنوان" hint="عنوان ولي الأمر اللي الطالب عايش معاه">
                <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
            )}
            <p className="text-sm font-semibold">أرقام ولي الأمر</p>
            <p className="text-xs text-muted">رقم ولي الأمر الأساسي بيتكتب تحت في «ولي الأمر». هنا أي أرقام تانية: الأرضي (9 أرقام يبدأ بـ 0، ملهوش واتساب) أو موبايلات.</p>
            {f.phones.map((p, i) => {
              const num = normalizePhone(p.number)
              const landline = LANDLINE_RE.test(num)
              const upd = (patch: Partial<Phone>) => set('phones', f.phones.map((x, j) => (j === i ? { ...x, ...patch } : patch.is_main_whatsapp ? { ...x, is_main_whatsapp: false } : x)))
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-2">
                  <Input dir="ltr" inputMode="tel" className="w-40" placeholder="01xxxxxxxxx أو 03xxxxxxx" value={p.number} onChange={(e) => upd({ number: e.target.value })} />
                  <Input className="w-32" placeholder="رقم مين" value={p.label} onChange={(e) => upd({ label: e.target.value })} />
                  {landline ? (
                    <span className="text-xs text-muted">أرضي</span>
                  ) : (
                    <>
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" checked={p.is_whatsapp} onChange={(e) => upd({ is_whatsapp: e.target.checked, ...(e.target.checked ? {} : { is_main_whatsapp: false }) })} />
                        عليه واتساب
                      </label>
                      {p.is_whatsapp && (
                        <label className="flex items-center gap-1 text-sm">
                          <input type="radio" name="main-wa" checked={p.is_main_whatsapp} onChange={() => upd({ is_main_whatsapp: true })} />
                          الأساسي للواتساب
                        </label>
                      )}
                    </>
                  )}
                  {f.phones.length > 1 && (
                    <button type="button" className="text-red-600" onClick={() => set('phones', f.phones.filter((_, j) => j !== i))} aria-label="شيل">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              )
            })}
            <Button variant="ghost" size="sm" onClick={() => set('phones', [...f.phones, { number: '', label: '', is_whatsapp: false, is_main_whatsapp: false }])}>
              <Plus className="size-4" /> رقم تاني
            </Button>
          </Section>
        )}

        {showPrivate && (
          <>
            <Section title="الأب">
              <Field label="اسم الأب" hint="بيتملى لوحده من اسم الطالب">
                <Input value={f.father_name} onChange={(e) => { setFatherTouched(true); set('father_name', e.target.value) }} />
              </Field>
              <ParentFields f={f} set={set} p="father" />
            </Section>
            <Section title="الأم">
              <Field label="اسم الأم">
                <Input value={f.mother_name} onChange={(e) => set('mother_name', e.target.value)} />
              </Field>
              <ParentFields f={f} set={set} p="mother" />
            </Section>
          </>
        )}

        {showPrivate && (
          <Section title="ولي الأمر">
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['father', 'الأب', 'الطبيعي'],
                  ['mother', 'الأم', 'معاها ولاية تعليمية'],
                  ['other', 'حد تاني', 'الولاد عايشين مع حد تاني'],
                ] as const
              ).map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set('g_kind', k)}
                  className={`rounded-xl p-3 text-start ring-1 ${f.g_kind === k ? 'bg-brand-50 ring-brand-400' : 'bg-white ring-line'}`}
                >
                  <p className="font-semibold">{label}</p>
                  <p className="text-xs text-muted">{hint}</p>
                </button>
              ))}
            </div>
            <Field label="رقم ولي الأمر" hint="ده رقم التواصل الأساسي، وبيه ولي الأمر بيدخل صفحة الأسرة">
              <Input dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" value={f.g_phone} onChange={(e) => set('g_phone', e.target.value)} />
            </Field>
            {f.g_kind === 'other' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="اسم ولي الأمر">
                  <Input value={f.g_name} onChange={(e) => set('g_name', e.target.value)} />
                </Field>
                <Field label="صلة القرابة">
                  <Select value={f.g_relation} onChange={(e) => set('g_relation', e.target.value)} options={RELATIONS.filter((r) => r !== 'أب' && r !== 'أم')} />
                </Field>
                <Field label="الرقم القومي">
                  <Input dir="ltr" inputMode="numeric" maxLength={14} value={f.g_national_id} onChange={(e) => set('g_national_id', e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Field label="البطاقة سارية حتى">
                  <Input type="date" value={f.g_valid_until} onChange={(e) => set('g_valid_until', e.target.value)} />
                </Field>
                <Field label="الوظيفة">
                  <Input value={f.g_job} onChange={(e) => set('g_job', e.target.value)} />
                </Field>
              </div>
            )}
            {f.g_kind !== 'father' && (
              <Field label={f.g_kind === 'mother' ? 'ورقة الولاية التعليمية' : 'الورقة اللي اتأكدنا منها'} hint="نوعها ورقمها أو لينكها">
                <Input value={f.g_document} onChange={(e) => set('g_document', e.target.value)} />
              </Field>
            )}
            {f.g_kind !== 'other' && <p className="text-xs text-muted">بيانات ولي الأمر (الاسم والرقم القومي والبطاقة) بتتاخد من بيانات {f.g_kind === 'father' ? 'الأب' : 'الأم'} فوق.</p>}
            {sibling.data && sibling.data.id !== existing.data?.guardian?.id && (
              <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
                ولي الأمر ده متسجل قبل كده ({sibling.data.full_name}) مع: {sibling.data.children.join('، ')}. الطالب هيتربط بنفس ولي الأمر.
              </p>
            )}
          </Section>
        )}

        {showPrivate && (
          <Section title="الأسرة">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="أبناء أقل من 5 سنين"><Input type="number" min={0} max={20} value={f.kids_under_5} onChange={(e) => set('kids_under_5', e.target.value)} /></Field>
              <Field label="أبناء من 5 لـ 10"><Input type="number" min={0} max={20} value={f.kids_5_to_10} onChange={(e) => set('kids_5_to_10', e.target.value)} /></Field>
              <Field label="ولاد أكبر من 10"><Input type="number" min={0} max={20} value={f.boys_over_10} onChange={(e) => set('boys_over_10', e.target.value)} /></Field>
              <Field label="بنات أكبر من 10"><Input type="number" min={0} max={20} value={f.girls_over_10} onChange={(e) => set('girls_over_10', e.target.value)} /></Field>
            </div>
            <p className="text-xs text-muted">
              عدد أفراد الأسرة: {[f.kids_under_5, f.kids_5_to_10, f.boys_over_10, f.girls_over_10].reduce((s, x) => s + (Number(x) || 0), 0) + 2} (مع الأب والأم)
            </p>
            {canFinance && <div className="grid gap-3 sm:grid-cols-2">
              <Field label="دخل الأسرة"><Input value={f.family_income} onChange={(e) => set('family_income', e.target.value)} /></Field>
              <Field label="الدعم اللي بياخدوه" hint="تكافل وكرامة، معاش، …"><Input value={f.family_support} onChange={(e) => set('family_support', e.target.value)} /></Field>
            </div>}
            <Field label="ملاحظات صحية"><Input value={f.health_notes} onChange={(e) => set('health_notes', e.target.value)} /></Field>
            <Field label="ملاحظات هامة"><Textarea rows={3} value={f.important_notes} onChange={(e) => set('important_notes', e.target.value)} /></Field>
            <p className="text-xs text-muted">الجزء ده بيظهر بعد كده لصاحب صلاحية «البيانات الحساسة» بس.</p>
          </Section>
        )}

        <Section title="ملاحظات للتنظيم بس">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="مثلاً: مينفعش يروح لوحده · محدش يستلمه غير أبوه · ليه حالة خاصة نتعامل معاه برفق" />
          <p className="text-xs text-muted">بتظهر للتنظيم والمدرس مع اسم الطالب، ومبتظهرش لولي الأمر ولا الطالب.</p>
        </Section>

        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>رجوع</Button>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">{title}</h2>
      {children}
    </Card>
  )
}

function ParentFields({ f, set, p }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; p: 'father' | 'mother' }) {
  const phone = `${p}_phone` as const
  const nid = `${p}_national_id` as const
  const valid = `${p}_id_valid_until` as const
  const job = `${p}_job` as const
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="الموبايل" hint="مش إجباري">
        <Input dir="ltr" inputMode="tel" value={f[phone]} onChange={(e) => set(phone, e.target.value)} />
      </Field>
      <Field label="الرقم القومي">
        <Input dir="ltr" inputMode="numeric" maxLength={14} value={f[nid]} onChange={(e) => set(nid, e.target.value.replace(/\D/g, ''))} />
      </Field>
      <Field label="البطاقة سارية حتى" hint="سيبها فاضية لو مش موجودة">
        <Input type="date" value={f[valid]} onChange={(e) => set(valid, e.target.value)} />
      </Field>
      <Field label="الوظيفة">
        <Input value={f[job]} onChange={(e) => set(job, e.target.value)} />
      </Field>
    </div>
  )
}

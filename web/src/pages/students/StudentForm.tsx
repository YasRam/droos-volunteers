import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, Toggle } from '@/components/ui'
import { toastError } from '@/lib/errors'
import {
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

interface Phone { number: string; label: string; is_whatsapp: boolean }
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
  custodian: boolean
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
  phones: [{ number: '', label: 'البيت', is_whatsapp: true }],
  father_name: '', father_national_id: '', father_id_valid_until: '', father_job: '',
  mother_name: '', mother_national_id: '', mother_id_valid_until: '', mother_job: '',
  custodian: false, g_name: '', g_relation: 'أم', g_national_id: '', g_phone: '', g_valid_until: '', g_job: '', g_document: '',
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
  for (const [label, v] of [['الأب', f.father_national_id], ['الأم', f.mother_national_id], ['ولي الأمر', f.custodian ? f.g_national_id : '']] as const) {
    if (v && !NID_RE.test(v)) return `الرقم القومي لـ${label} لازم 14 رقم ويبدأ بـ 2 أو 3`
  }
  if (f.father_national_id && f.father_national_id === f.mother_national_id) return 'الرقم القومي للأم نفس رقم الأب'
  if (f.mother_national_id && fromNationalId(f.mother_national_id)?.gender === 'ذكر') return 'الرقم القومي للأم رقم راجل'
  if (f.father_national_id && fromNationalId(f.father_national_id)?.gender === 'أنثى') return 'الرقم القومي للأب رقم ست'
  const phones = f.phones.filter((p) => p.number.trim())
  if (isNew && !phones.length) return 'اكتب رقم تليفون واحد على الأقل'
  for (const p of phones) if (!PHONE_RE.test(normalizePhone(p.number))) return `رقم التليفون «${p.number}» مش صح (11 رقم يبدأ بـ 01)`
  if (new Set(phones.map((p) => normalizePhone(p.number))).size !== phones.length) return 'فيه رقم تليفون متكرر'
  if (f.custodian) {
    if (!t(f.g_name)) return 'اكتب اسم ولي الأمر'
    if (f.g_phone && !PHONE_RE.test(normalizePhone(f.g_phone))) return 'رقم ولي الأمر مش صح'
  }
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

  const existing = useQuery({
    queryKey: ['students', 'edit', id],
    enabled: !isNew,
    queryFn: async () => {
      const [s, priv, phones] = await Promise.all([
        sdb().from('students').select('*').eq('id', id!).single(),
        sdb().from('student_private').select('*').eq('student_id', id!).maybeSingle(),
        sdb().from('phones').select('*').eq('student_id', id!).order('sort_order'),
      ])
      if (s.error) throw s.error
      return { s: s.data as Student, priv: (priv.data ?? null) as Record<string, unknown> | null, phones: (phones.data ?? []) as Phone[] }
    },
  })
  useEffect(() => {
    if (!existing.data) return
    const { s, priv, phones } = existing.data
    const str = (k: string) => (priv?.[k] == null ? '' : String(priv[k]))
    setF({
      ...BLANK,
      full_name: s.full_name, school: s.school ?? '', school_shift: s.school_shift ?? 'صباحي', carnet_no: s.carnet_no ?? '', notes: s.notes ?? '',
      national_id: str('national_id'), address: str('address'),
      father_name: str('father_name'), father_national_id: str('father_national_id'), father_id_valid_until: str('father_id_valid_until'), father_job: str('father_job'),
      mother_name: str('mother_name'), mother_national_id: str('mother_national_id'), mother_id_valid_until: str('mother_id_valid_until'), mother_job: str('mother_job'),
      kids_under_5: str('kids_under_5'), kids_5_to_10: str('kids_5_to_10'), boys_over_10: str('boys_over_10'), girls_over_10: str('girls_over_10'),
      family_income: str('family_income'), family_support: str('family_support'), health_notes: str('health_notes'), important_notes: str('important_notes'),
      phones: phones.length ? phones.map((p) => ({ number: p.number, label: p.label ?? '', is_whatsapp: p.is_whatsapp })) : BLANK.phones,
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
  const guardianNid = f.custodian ? f.g_national_id : f.father_national_id
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
      const phones = f.phones.filter((p) => p.number.trim()).map((p, i) => ({ number: normalizePhone(p.number), label: t(p.label), is_whatsapp: p.is_whatsapp, sort_order: i }))

      // the guardian: an existing one with the same national ID (brothers/sisters), or a new one
      let guardianId: string | null = sibling.data?.id ?? null
      if (isNew && !guardianId) {
        const g = f.custodian
          ? { full_name: f.g_name.trim(), relation: f.g_relation, national_id: t(f.g_national_id), id_valid_until: t(f.g_valid_until), job: t(f.g_job), phone: t(normalizePhone(f.g_phone)), custody_document: t(f.g_document) }
          : { full_name: t(f.father_name) ?? fatherFromStudentName(f.full_name), relation: 'أب', national_id: t(f.father_national_id), id_valid_until: t(f.father_id_valid_until), job: t(f.father_job), phone: phones[0]?.number ?? null }
        const gid = crypto.randomUUID()
        const { error } = await sdb().from('guardians').insert({ id: gid, ...g })
        if (error) throw error
        guardianId = gid
      }

      const student = { full_name: f.full_name.trim(), school: t(f.school), school_shift: f.school_shift || null, carnet_no: t(f.carnet_no), notes: t(f.notes) }
      const sid = id ?? crypto.randomUUID()
      if (isNew) {
        const { error } = await sdb().from('students').insert({ id: sid, ...student, guardian_id: guardianId })
        if (error) throw error
      } else {
        const { error } = await sdb().from('students').update(student).eq('id', sid)
        if (error) throw error
      }

      const priv = {
        address: t(f.address),
        father_name: t(f.father_name), father_national_id: t(f.father_national_id), father_id_valid_until: t(f.father_id_valid_until), father_job: t(f.father_job),
        mother_name: t(f.mother_name), mother_national_id: t(f.mother_national_id), mother_id_valid_until: t(f.mother_id_valid_until), mother_job: t(f.mother_job),
        kids_under_5: n(f.kids_under_5), kids_5_to_10: n(f.kids_5_to_10), boys_over_10: n(f.boys_over_10), girls_over_10: n(f.girls_over_10),
        family_income: t(f.family_income), family_support: t(f.family_support), health_notes: t(f.health_notes), important_notes: t(f.important_notes),
      }
      if (isNew) {
        const { error } = await sdb().from('student_private').insert({ student_id: sid, national_id: f.national_id, ...priv })
        if (error) throw error
      } else if (a.sensitive) {
        const { error } = await sdb().from('student_private').update({ ...priv, national_id: t(f.national_id) }).eq('student_id', sid)
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
              <Field label="العنوان">
                <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
            )}
            <p className="text-sm font-semibold">أرقام التليفون</p>
            {f.phones.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input dir="ltr" inputMode="tel" className="w-40" placeholder="01xxxxxxxxx" value={p.number}
                  onChange={(e) => set('phones', f.phones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                <Input className="w-32" placeholder="رقم مين" value={p.label}
                  onChange={(e) => set('phones', f.phones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={p.is_whatsapp} onChange={(e) => set('phones', f.phones.map((x, j) => (j === i ? { ...x, is_whatsapp: e.target.checked } : x)))} />
                  واتساب
                </label>
                {f.phones.length > 1 && (
                  <button type="button" className="text-red-600" onClick={() => set('phones', f.phones.filter((_, j) => j !== i))} aria-label="شيل">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => set('phones', [...f.phones, { number: '', label: '', is_whatsapp: false }])}>
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

        {isNew && (
          <Section title="ولي الأمر">
            <Toggle checked={f.custodian} onChange={(v) => set('custodian', v)} label="ولي الأمر مش الأب (الولاية التعليمية لحد تاني بورقة)" />
            {f.custodian && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="اسم ولي الأمر">
                    <Input value={f.g_name} onChange={(e) => set('g_name', e.target.value)} />
                  </Field>
                  <Field label="صلة القرابة">
                    <Select value={f.g_relation} onChange={(e) => set('g_relation', e.target.value)} options={RELATIONS.filter((r) => r !== 'أب')} />
                  </Field>
                  <Field label="الرقم القومي">
                    <Input dir="ltr" inputMode="numeric" maxLength={14} value={f.g_national_id} onChange={(e) => set('g_national_id', e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field label="الموبايل">
                    <Input dir="ltr" inputMode="tel" value={f.g_phone} onChange={(e) => set('g_phone', e.target.value)} />
                  </Field>
                  <Field label="البطاقة سارية حتى">
                    <Input type="date" value={f.g_valid_until} onChange={(e) => set('g_valid_until', e.target.value)} />
                  </Field>
                  <Field label="الوظيفة">
                    <Input value={f.g_job} onChange={(e) => set('g_job', e.target.value)} />
                  </Field>
                </div>
                <Field label="الورقة اللي اتأكدنا منها" hint="نوعها ورقمها أو لينكها">
                  <Input value={f.g_document} onChange={(e) => set('g_document', e.target.value)} />
                </Field>
              </>
            )}
            {sibling.data && (
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="دخل الأسرة"><Input value={f.family_income} onChange={(e) => set('family_income', e.target.value)} /></Field>
              <Field label="الدعم اللي بياخدوه" hint="تكافل وكرامة، معاش، …"><Input value={f.family_support} onChange={(e) => set('family_support', e.target.value)} /></Field>
            </div>
            <Field label="ملاحظات صحية"><Input value={f.health_notes} onChange={(e) => set('health_notes', e.target.value)} /></Field>
            <Field label="ملاحظات هامة"><Textarea rows={3} value={f.important_notes} onChange={(e) => set('important_notes', e.target.value)} /></Field>
            <p className="text-xs text-muted">الجزء ده بيظهر بعد كده لصاحب صلاحية «البيانات الحساسة» بس.</p>
          </Section>
        )}

        <Section title="ملاحظات للتنظيم">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
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
  const nid = `${p}_national_id` as const
  const valid = `${p}_id_valid_until` as const
  const job = `${p}_job` as const
  return (
    <div className="grid gap-3 sm:grid-cols-3">
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

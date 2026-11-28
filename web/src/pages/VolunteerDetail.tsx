import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MessageCircle, Phone, Printer, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, RequestBadge, Select, Spinner, StatusBadge, Tabs, Toggle } from '@/components/ui'
import { VolunteerFacts } from '@/components/VolunteerFacts'
import { StagesCard } from '@/components/StagesCard'
import { RecruitHistory, useRecruitLog } from '@/pages/Recruit'
import { ContactLinks } from '@/components/VolunteerLink'
import { useAuth, usePermissions } from '@/lib/auth'
import { ageFrom, fmtShort, useLookups, useStatusOptions, whatsappLink, withCurrent } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { accountCall, tempPassword } from '@/lib/account'
import { type Participation, type Volunteer, type VolunteerHr } from '@/lib/types'
import { NationalIdCard, PersonalFields, personalDefaults, personalSchema, toPersonalPayload, type PersonalValues } from './MyProfile'
import { useJobs } from '@/lib/jobs'
import { FeedbackCard } from '@/components/Feedback'

type Tab = 'data' | 'status' | 'interview' | 'journey' | 'feedback' | 'activities'

export default function VolunteerDetail() {
  const { jobOf } = useJobs()
  const { id } = useParams<{ id: string }>()
  const p = usePermissions()
  const { me } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('data')

  const q = useQuery({
    queryKey: ['volunteer', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteers').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as Volunteer | null
    },
  })
  const v = q.data
  const leadsThis = Boolean(v && me?.committees.some((c) => c === v.main_committee || c === v.sub_committee))
  const canEditCommittee = p.full || leadsThis

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('volunteers').delete().eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('المتطوع اتمسح')
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      navigate('/volunteers')
    },
    onError: toastError,
  })

  if (q.isLoading) return <Spinner />
  if (!v) return <Empty title="المتطوع ده مش موجود أو مش مسموح لك تشوفه" />

  const wa = whatsappLink(v.whatsapp ?? v.phone)
  const age = ageFrom(v.birth_date)
  const self = v.id === p.volunteerId
  const seesFeedback = !self && (p.can('volunteers.edit') || p.can('hr.edit') || p.can('hr.notes') || leadsThis)
  const tabs: { value: Tab; label: string }[] = [
    { value: 'data', label: 'البيانات' },
    { value: 'status', label: 'الحالة واللجنة' },
    ...(p.can('hr.view') ? [{ value: 'interview' as Tab, label: 'المقابلة' }] : []),
    { value: 'journey', label: 'رحلة التطوع' },
    ...(seesFeedback ? [{ value: 'feedback' as Tab, label: 'الفيد باك' }] : []),
    { value: 'activities', label: 'المشاركات' },
  ]

  return (
    <>
      <Link to="/volunteers" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-700">
        <ArrowRight className="size-4" /> المتطوعين
      </Link>
      <PageHeader
        title={v.full_name_ar}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={v.status} />
            <Badge tone="brand">{jobOf(v)}</Badge>
            <span className="ltr">{v.code}</span>
            {v.main_committee && <span>· {v.main_committee}</span>}
            {age !== null && <span>· {age} سنة</span>}
          </span>
        }
        actions={
          <>
            {(p.can('hr.view') || p.can('volunteers.edit')) && (
              <Link to={`/volunteers/${v.id}/form`}>
                <Button variant="secondary">
                  <Printer className="size-4" /> الاستمارة
                </Button>
              </Link>
            )}
            {v.phone && (
              <a href={`tel:${v.phone}`}>
                <Button variant="secondary">
                  <Phone className="size-4" /> اتصال
                </Button>
              </a>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer">
                <Button variant="success">
                  <MessageCircle className="size-4" /> واتساب
                </Button>
              </a>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'data' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {p.full ? <EditPersonal v={v} /> : <ReadPersonal v={v} />}
          </div>
          <div className="space-y-4">
            <VolunteerFacts v={v} />
            {p.can('national_id.view') && <NationalIdCard volunteerId={v.id} canEdit={p.can('national_id.edit')} />}
            {p.can('accounts.password') && <TempPasswordCard volunteerId={v.id} name={v.full_name_ar} email={v.email} phone={v.whatsapp || v.phone} />}
            {p.full && (
              <Button
                variant="ghost"
                className="w-full text-red-600"
                loading={remove.isPending}
                onClick={() => confirm(`مسح ${v.full_name_ar} وكل مشاركاته؟ مفيش رجوع.`) && remove.mutate()}
              >
                <Trash2 className="size-4" /> مسح المتطوع
              </Button>
            )}
          </div>
        </div>
      )}
      {tab === 'status' && <StatusCommittee v={v} />}
      {tab === 'interview' && (
        <div className="space-y-4">
          <Interview v={v} />
          <RecruitCard volunteerId={v.id} />
        </div>
      )}
      {tab === 'journey' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Committee v={v} editable={canEditCommittee} />
          <StagesCard volunteerId={v.id} self={false} />
        </div>
      )}
      {tab === 'feedback' && <FeedbackCard volunteerId={v.id} />}
      {tab === 'activities' && <Activities volunteerId={v.id} />}
    </>
  )
}

function ReadPersonal({ v }: { v: Volunteer }) {
  const rows: [string, ReactNode][] = [
    ['الاسم بالإنجليزي', v.full_name_en],
    ['الهاتف', v.phone && <ContactLinks phone={v.phone} />],
    ['الواتساب', (v.whatsapp || v.phone) && <ContactLinks whatsapp={v.whatsapp || v.phone} phone={null} />],
    ['الإيميل', v.email],
    ['المؤهل', v.qualification],
    ['الوظيفة', v.job],
    ['المنطقة', v.area],
    ['المواعيد والملاحظات', v.availability_notes],
    ['عرف النشاط منين', v.referral_source],
  ]
  return (
    <Card>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="font-semibold">{val || '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function EditPersonal({ v }: { v: Volunteer }) {
  const qc = useQueryClient()
  const form = useForm<PersonalValues>({ resolver: zodResolver(personalSchema), values: personalDefaults(v) })
  const save = useMutation({
    mutationFn: async (vals: PersonalValues) => {
      const { error } = await supabase.from('volunteers').update(toPersonalPayload(vals)).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      qc.invalidateQueries({ queryKey: ['volunteer', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  return (
    <Card>
      <form onSubmit={form.handleSubmit((vals) => save.mutate(vals))} className="space-y-5">
        <PersonalFields form={form} />
        <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
          حفظ
        </Button>
      </form>
    </Card>
  )
}

/** Status and committees (volunteers.edit). The exit reason only when the status is «خارج المتابعة». */
function StatusCommittee({ v }: { v: Volunteer }) {
  const opts = useStatusOptions()
  const qc = useQueryClient()
  const p = usePermissions()
  const lookups = useLookups()
  const canEdit = p.can('volunteers.edit')
  const [f, setF] = useState({ status: v.status as string, main_committee: v.main_committee ?? '', sub_committee: v.sub_committee ?? '', out_reason: v.out_reason ?? '' })
  const out = f.status === 'خارج المتابعة'
  const save = useMutation({
    mutationFn: async () => {
      if (out && !f.out_reason.trim()) throw { message: 'اكتب سبب الخروج من المتابعة' }
      const { error } = await supabase
        .from('volunteers')
        .update({ status: f.status, main_committee: f.main_committee || null, sub_committee: f.sub_committee || null, out_reason: out ? f.out_reason.trim() : null })
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      qc.invalidateQueries({ queryKey: ['volunteer', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  const committees = lookups.data?.list('اللجنة') ?? []
  return (
    <Card>
      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="حالة المتطوع">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={withCurrent(opts.statuses, v.status)} />
        </Field>
        <Field label="اللجنة الأساسية">
          <Select value={f.main_committee} onChange={(e) => setF({ ...f, main_committee: e.target.value })} placeholder="—" options={withCurrent(committees, v.main_committee)} />
        </Field>
        <Field label="اللجنة الفرعية">
          <Select value={f.sub_committee} onChange={(e) => setF({ ...f, sub_committee: e.target.value })} placeholder="—" options={withCurrent(committees, v.sub_committee)} />
        </Field>
        {out && (
          <div className="sm:col-span-3">
            <Field label="سبب الخروج من المتابعة" hint="أي سبب. لو السيستم طلّعه لوحده بيتكتب «عدم المشاركة لمدة 3 شهور»">
              <Input value={f.out_reason} onChange={(e) => setF({ ...f, out_reason: e.target.value })} list="out-reasons" />
              <datalist id="out-reasons">{(lookups.data?.list('سبب الخروج') ?? []).map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
          </div>
        )}
      </fieldset>
      {canEdit ? (
        <Button className="mt-4" onClick={() => save.mutate()} loading={save.isPending}>
          حفظ
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted">عرض بس. التعديل محتاج صلاحية تعديل المتطوعين.</p>
      )}
    </Card>
  )
}

/** The interview (hr.*): result, date and who did it (a volunteer with the HR permission). */
function Interview({ v }: { v: Volunteer }) {
  const opts = useStatusOptions()
  const qc = useQueryClient()
  const p = usePermissions()
  const canEditHr = p.can('hr.edit')
  const hr = useQuery({
    queryKey: ['hr', v.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_hr_read').select('*').eq('volunteer_id', v.id).maybeSingle()
      if (error) throw error
      return data as VolunteerHr | null
    },
  })
  const interviewers = useQuery({
    queryKey: ['interviewers'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('interviewers')
      if (error) throw error
      return data as { id: string; full_name_ar: string }[]
    },
  })
  const [f, setF] = useState<{ acceptance: string; interview_date: string; interviewer_id: string } | null>(null)
  const cur = f ?? { acceptance: hr.data?.acceptance ?? '', interview_date: hr.data?.interview_date ?? '', interviewer_id: hr.data?.interviewer_id ?? '' }
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('volunteer_hr')
        .update({ acceptance: cur.acceptance || null, interview_date: cur.interview_date || null, interviewer_id: cur.interviewer_id || null, interviewer: null })
        .eq('volunteer_id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      setF(null)
      qc.invalidateQueries({ queryKey: ['hr', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteer_hr'] })
    },
    onError: toastError,
  })
  if (hr.isLoading) return <Spinner />
  const people = interviewers.data ?? []
  const options = [
    ...people.map((x) => ({ value: x.id, label: x.full_name_ar })),
    ...(cur.interviewer_id && !people.some((x) => x.id === cur.interviewer_id) ? [{ value: cur.interviewer_id, label: 'متطوع (مبقاش معاه صلاحية)' }] : []),
  ]
  return (
    <Card>
      <fieldset disabled={!canEditHr} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="درجة القبول" hint={hr.data?.status_changed_at ? `آخر تغيير ${fmtShort(hr.data.status_changed_at)}` : undefined}>
          <Select value={cur.acceptance} onChange={(e) => setF({ ...cur, acceptance: e.target.value })} placeholder="—" options={withCurrent(opts.acceptance, hr.data?.acceptance)} />
        </Field>
        <Field label="تاريخ المقابلة">
          <Input type="date" value={cur.interview_date} onChange={(e) => setF({ ...cur, interview_date: e.target.value })} />
        </Field>
        <Field label="القائم على المقابلة" hint="متطوع معاه صلاحية الـ HR">
          <Select value={cur.interviewer_id} onChange={(e) => setF({ ...cur, interviewer_id: e.target.value })} placeholder="—" options={options} />
          {!cur.interviewer_id && hr.data?.interviewer && <p className="mt-1 text-xs text-muted">مكتوب قبل كده: {hr.data.interviewer}</p>}
        </Field>
      </fieldset>
      <p className="mt-3 text-xs text-muted">ملاحظات المقابلة بتتكتب في «الفيد باك» (نوعها «مقابلة»)، وهي أول فيد باك عن المتطوع.</p>
      {canEditHr && (
        <Button className="mt-3" onClick={() => save.mutate()} loading={save.isPending} disabled={!f}>
          حفظ
        </Button>
      )}
    </Card>
  )
}

const CAMP_FLAGS = [
  ['attended_minicamp', 'minicamp_date', 'الميني كامب'],
  ['attended_camp', 'camp_date', 'الكامب'],
  ['attended_graduation', 'graduation_date', 'حفلة التخرج'],
] as const

function Committee({ v, editable }: { v: Volunteer; editable: boolean }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: async (patch: Partial<Volunteer>) => {
      const { error } = await supabase.from('volunteers').update(patch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['volunteer', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  const flags: [keyof Volunteer, string][] = [
    ['contacted', 'تم التواصل'],
    ['passed_committee_test', 'اختبار اللجنة الأساسية'],
    ['joined_group', 'دخل الجروب (المتطوع بيعلّمها بنفسه كمان)'],
    ['is_active', 'المشاركات الفعالة'],
    ['bought_tshirt', 'اشترى التيشيرت'],
  ]
  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {flags.map(([key, label]) => (
          <Toggle key={key} label={label} checked={Boolean(v[key])} disabled={!editable || save.isPending} onChange={(val) => save.mutate({ [key]: val })} />
        ))}
      </div>
      {CAMP_FLAGS.map(([flag, dateKey, label]) => (
        <div key={flag} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
          <Toggle
            label={`حضر ${label}`}
            checked={Boolean(v[flag])}
            disabled={!editable || save.isPending}
            onChange={(val) => save.mutate({ [flag]: val, [dateKey]: val ? (v[dateKey] ?? new Date().toISOString().slice(0, 10)) : null })}
          />
          {v[flag] && (
            <Input
              type="date"
              aria-label={`تاريخ ${label}`}
              defaultValue={(v[dateKey] as string | null) ?? ''}
              disabled={!editable}
              onBlur={(e) => e.target.value !== v[dateKey] && save.mutate({ [dateKey]: e.target.value || null })}
            />
          )}
        </div>
      ))}
      {!editable && <p className="text-xs text-muted">بيانات اللجنة يعدّلها ليدر اللجنة أو الـ HR.</p>}
    </Card>
  )
}

function Activities({ volunteerId }: { volunteerId: string }) {
  const q = useQuery({
    queryKey: ['volunteer-activities', volunteerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('participations').select('*').eq('volunteer_id', volunteerId).order('activity_date', { ascending: false })
      if (error) throw error
      return data as Participation[]
    },
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="مفيش مشاركات" />
  return (
    <Card className="divide-y divide-line p-0">
      {q.data.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="font-semibold">
              {p.event}
              {p.subject && <span className="text-muted"> · {p.subject}</span>}
              {p.grade && <span className="text-muted"> · {p.grade}</span>}
            </p>
            <p className="text-xs text-muted">
              {fmtShort(p.activity_date)}
              {p.place && ` · ${p.place}`}
              {p.method === 'group' && ' · نشاط جماعي'}
            </p>
          </div>
          <RequestBadge status={p.status} />
        </div>
      ))}
    </Card>
  )
}

/** Calls and interviews over time, so a second interview shows the earlier result. */
function RecruitCard({ volunteerId }: { volunteerId: string }) {
  const log = useRecruitLog()
  const rows = log.data?.get(volunteerId) ?? []
  if (!rows.length) return null
  return (
    <Card>
      <p className="font-bold text-brand-800">تاريخ التواصل والانترفيو</p>
      <RecruitHistory logs={rows} />
    </Card>
  )
}

/** HR makes a temporary password for someone who can't sign in with Google, and sends it on WhatsApp. */
function TempPasswordCard({ volunteerId, name, email, phone }: { volunteerId: string; name: string; email: string | null; phone: string | null }) {
  const [pw, setPw] = useState<string | null>(null)
  const make = useMutation({
    mutationFn: async () => {
      const password = tempPassword()
      await accountCall({ action: 'set_password', volunteer_id: volunteerId, password }, true)
      return password
    },
    onSuccess: (password) => setPw(password),
    onError: toastError,
  })
  const site = `${location.origin}${import.meta.env.BASE_URL}`
  const msg = pw ? `أهلاً ${name.split(' ')[0]} 👋\nتقدر تدخل موقع النشاط من ${site}\nالإيميل: ${email}\nكلمة السر: ${pw}\nغيّرها من «كلمة السر» في القايمة بعد ما تدخل.` : ''
  const wa = phone ? `https://wa.me/2${phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}` : null
  return (
    <Card>
      <p className="font-bold">الدخول من غير جوجل</p>
      {!email ? (
        <p className="mt-1 text-sm text-muted">ضيف إيميل للمتطوع الأول.</p>
      ) : pw ? (
        <div className="mt-2 space-y-2 text-sm">
          <p>
            كلمة السر المؤقتة: <span className="ltr rounded bg-surface px-2 py-0.5 font-mono font-bold">{pw}</span>
          </p>
          <p className="text-xs text-muted">مش هتظهر تاني. ابعتهاله دلوقتي.</p>
          <div className="flex gap-2">
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-3 py-1.5 font-semibold text-white">
                ابعتها واتساب
              </a>
            )}
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(msg).then(() => toast.success('اتنسخت'))}>
              نسخ الرسالة
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="mb-2 text-sm text-muted">لو مش عارف يدخل بجوجل: اعمله كلمة سر مؤقتة وابعتهاله، ويدخل بالإيميل وكلمة السر.</p>
          <Button size="sm" variant="secondary" loading={make.isPending} onClick={() => make.mutate()}>
            اعمل كلمة سر مؤقتة
          </Button>
        </div>
      )}
    </Card>
  )
}

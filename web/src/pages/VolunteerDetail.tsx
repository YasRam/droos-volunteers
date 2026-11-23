import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MessageCircle, Phone, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Empty, Field, Input, PageHeader, RequestBadge, Select, Spinner, StatusBadge, Tabs, Textarea, Toggle } from '@/components/ui'
import { ContactLinks } from '@/components/VolunteerLink'
import { useAuth, usePermissions } from '@/lib/auth'
import { ageFrom, fmtDate, fmtShort, useLookups, whatsappLink } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ACCEPTANCE, STATUSES, type Participation, type Volunteer, type VolunteerHr } from '@/lib/types'
import { NationalIdCard, PersonalFields, personalDefaults, personalSchema, toPersonalPayload, type PersonalValues } from './MyProfile'

type Tab = 'data' | 'interview' | 'committee' | 'activities'

export default function VolunteerDetail() {
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
  const tabs: { value: Tab; label: string }[] = [
    { value: 'data', label: 'البيانات' },
    ...(p.viewAll ? [{ value: 'interview' as Tab, label: 'المقابلة' }] : []),
    { value: 'committee', label: 'اللجنة' },
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
            <span className="ltr">{v.code}</span>
            {v.main_committee && <span>· {v.main_committee}</span>}
            {age !== null && <span>· {age} سنة</span>}
          </span>
        }
        actions={
          <>
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
            {p.viewAll && <NationalIdCard volunteerId={v.id} canEditDirectly={p.full} readOnly={!p.full} />}
            <Card className="text-sm">
              <p>تاريخ الميلاد: {fmtDate(v.birth_date)}</p>
              <p className="mt-1">النوع: {v.gender ?? '—'}</p>
              <p className="mt-1">اتسجل: {fmtDate(v.registered_at)}</p>
              {v.updated_by && <p className="mt-1 text-xs text-muted">آخر تعديل: {v.updated_by}</p>}
            </Card>
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
      {tab === 'interview' && p.viewAll && <Interview v={v} readOnly={!p.full} />}
      {tab === 'committee' && <Committee v={v} editable={canEditCommittee} />}
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

function Interview({ v, readOnly }: { v: Volunteer; readOnly: boolean }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const hr = useQuery({
    queryKey: ['hr', v.id],
    queryFn: async () => {
      const { data, error } = await supabase.from(readOnly ? 'volunteer_hr_read' : 'volunteer_hr').select('*').eq('volunteer_id', v.id).maybeSingle()
      if (error) throw error
      return data as VolunteerHr | null
    },
  })
  const form = useForm({
    values: {
      status: v.status,
      main_committee: v.main_committee ?? '',
      sub_committee: v.sub_committee ?? '',
      acceptance: hr.data?.acceptance ?? '',
      interview_date: hr.data?.interview_date ?? '',
      interviewer: hr.data?.interviewer ?? '',
      hr_notes: hr.data?.hr_notes ?? '',
    },
  })
  const save = useMutation({
    mutationFn: async (f: Parameters<Parameters<typeof form.handleSubmit>[0]>[0]) => {
      const a = await supabase
        .from('volunteers')
        .update({ status: f.status, main_committee: f.main_committee || null, sub_committee: f.sub_committee || null })
        .eq('id', v.id)
      if (a.error) throw a.error
      const b = await supabase
        .from('volunteer_hr')
        .update({
          acceptance: f.acceptance || null,
          interview_date: f.interview_date || null,
          interviewer: f.interviewer || null,
          hr_notes: f.hr_notes || null,
        })
        .eq('volunteer_id', v.id)
      if (b.error) throw b.error
    },
    onSuccess: () => {
      toast.success('بيانات المقابلة اتحفظت')
      qc.invalidateQueries({ queryKey: ['volunteer', v.id] })
      qc.invalidateQueries({ queryKey: ['hr', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  if (hr.isLoading) return <Spinner />
  const committees = lookups.data?.list('اللجنة') ?? []
  return (
    <Card>
      {readOnly && <p className="mb-3 text-xs text-muted">عرض بس. التعديل للأدمن وليدر النشاط والـ HR، وملاحظات الـ HR مش ظاهرة لصلاحية الإدارة.</p>}
      <form onSubmit={form.handleSubmit((f) => save.mutate(f))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <fieldset disabled={readOnly} className="contents">
        <Field label="حالة المتطوع">
          <Select {...form.register('status')} options={STATUSES} />
        </Field>
        <Field label="درجة القبول" hint={hr.data?.status_changed_at ? `آخر تغيير ${fmtShort(hr.data.status_changed_at)}` : undefined}>
          <Select {...form.register('acceptance')} placeholder="—" options={ACCEPTANCE} />
        </Field>
        <Field label="اللجنة الأساسية">
          <Select {...form.register('main_committee')} placeholder="—" options={committees} />
        </Field>
        <Field label="اللجنة الفرعية">
          <Select {...form.register('sub_committee')} placeholder="—" options={committees} />
        </Field>
        <Field label="تاريخ المقابلة">
          <Input type="date" {...form.register('interview_date')} />
        </Field>
        <Field label="القائم على المقابلة">
          <Input {...form.register('interviewer')} list="interviewers" />
          <datalist id="interviewers">
            {lookups.data?.list('القائم على المقابلة').map((n) => <option key={n} value={n} />)}
          </datalist>
        </Field>
        {!readOnly && (
          <div className="sm:col-span-2">
            <Field label="ملاحظات HR">
              <Textarea {...form.register('hr_notes')} />
            </Field>
          </div>
        )}
        </fieldset>
        {!readOnly && (
          <div className="sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              حفظ
            </Button>
          </div>
        )}
      </form>
    </Card>
  )
}

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
    ['joined_group', 'دخل الجروب'],
    ['is_active', 'المشاركات الفعالة'],
    ['bought_tshirt', 'اشترى التيشيرت'],
  ]
  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {flags.map(([key, label]) => (
          <Toggle key={key} label={label} checked={Boolean(v[key])} disabled={!editable || save.isPending} onChange={(val) => save.mutate({ [key]: val })} />
        ))}
        <Toggle
          label="حضر الميني كامب"
          checked={v.attended_minicamp}
          disabled={!editable || save.isPending}
          onChange={(val) => save.mutate({ attended_minicamp: val, minicamp_date: val ? (v.minicamp_date ?? new Date().toISOString().slice(0, 10)) : null })}
        />
      </div>
      {v.attended_minicamp && (
        <Field label="موعد الميني كامب">
          <Input type="date" defaultValue={v.minicamp_date ?? ''} disabled={!editable} onBlur={(e) => e.target.value !== v.minicamp_date && save.mutate({ minicamp_date: e.target.value || null })} />
        </Field>
      )}
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

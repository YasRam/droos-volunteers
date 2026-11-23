import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MessageCircle, Phone, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, RequestBadge, Select, Spinner, StatusBadge, Tabs, Textarea, Toggle } from '@/components/ui'
import { ContactLinks } from '@/components/VolunteerLink'
import { useAuth, usePermissions } from '@/lib/auth'
import { ageFrom, cairoToday, fmtDate, fmtShort, useLookups, whatsappLink } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ACCEPTANCE, POSITIONS, STATUSES, type Participation, type Volunteer, type VolunteerHr, type VolunteerStats } from '@/lib/types'
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
    ...(p.full ? [{ value: 'interview' as Tab, label: 'المقابلة' }] : []),
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
            {v.position !== 'متطوع' && <Badge tone="purple">{v.position}</Badge>}
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
      <Summary v={v} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'data' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {p.full ? <EditPersonal v={v} /> : <ReadPersonal v={v} />}
          </div>
          <div className="space-y-4">
            {p.full && <NationalIdCard volunteerId={v.id} canEdit={v.id !== p.volunteerId} />}
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
      {tab === 'interview' && p.full && <Interview v={v} />}
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

function Interview({ v }: { v: Volunteer }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const hr = useQuery({
    queryKey: ['hr', v.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_hr').select('*').eq('volunteer_id', v.id).maybeSingle()
      if (error) throw error
      return data as VolunteerHr | null
    },
  })
  const form = useForm({
    values: {
      status: v.status,
      position: v.position,
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
        .update({ status: f.status, position: f.position, main_committee: f.main_committee || null, sub_committee: f.sub_committee || null })
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
      <form onSubmit={form.handleSubmit((f) => save.mutate(f))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="حالة المتطوع">
          <Select {...form.register('status')} options={STATUSES} />
        </Field>
        <Field label="الوظيفة" hint="وظيفة واحدة بس. الصلاحيات من شاشة الصلاحيات">
          <Select {...form.register('position')} options={POSITIONS} />
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
        <div className="sm:col-span-2">
          <Field label="ملاحظات HR">
            <Textarea {...form.register('hr_notes')} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" loading={save.isPending}>
            حفظ
          </Button>
        </div>
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
          label="حضر الكامب / الميني كامب"
          checked={v.attended_minicamp}
          disabled={!editable || save.isPending}
          onChange={(val) => save.mutate({ attended_minicamp: val, minicamp_date: val ? (v.minicamp_date ?? new Date().toISOString().slice(0, 10)) : null })}
        />
      </div>
      {v.attended_minicamp && (
        <Field label="موعد الكامب / الميني كامب">
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

/** What the system works out for this volunteer: from the national id, and from their participations. */
function Summary({ v }: { v: Volunteer }) {
  const month = cairoToday().slice(0, 7)
  const q = useQuery({
    queryKey: ['volunteer-summary', v.id],
    queryFn: async () => {
      const [stats, days] = await Promise.all([
        supabase.from('volunteer_stats').select('*').eq('volunteer_id', v.id).maybeSingle(),
        supabase.from('participation_days').select('activity_date').eq('volunteer_id', v.id),
      ])
      if (stats.error) throw stats.error
      if (days.error) throw days.error
      const dates = (days.data as { activity_date: string }[]).map((d) => d.activity_date)
      return { stats: stats.data as VolunteerStats | null, days: dates.length, daysThisMonth: dates.filter((d) => d.startsWith(month)).length }
    },
  })
  const age = ageFrom(v.birth_date)
  const s = q.data?.stats
  const items: [string, ReactNode][] = [
    ['السن', age !== null ? `${age} سنة` : '—'],
    ['تاريخ الميلاد', fmtDate(v.birth_date)],
    ['النوع', v.gender ?? '—'],
    ['اتسجل', fmtDate(v.registered_at)],
    ['مشاركات الشهر ده', s?.this_month ?? 0],
    ['أيام الشهر ده', q.data?.daysThisMonth ?? 0],
    ['الشهر اللي فات', s?.last_month ?? 0],
    ['إجمالي المشاركات', s?.total ?? 0],
    ['إجمالي الأيام', q.data?.days ?? 0],
    ['آخر مشاركة', fmtShort(s?.last_participation)],
  ]
  return (
    <Card className="mb-4 p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        {items.map(([k, val]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-bold">{q.isLoading && typeof val === 'number' ? '…' : val}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-muted">
        السن والميلاد والنوع من الرقم القومي، والأرقام من المشاركات المقبولة.{v.updated_by && ` آخر تعديل: ${v.updated_by}`}
      </p>
    </Card>
  )
}

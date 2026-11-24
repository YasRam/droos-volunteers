import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MessageCircle, Phone, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, RequestBadge, Select, Spinner, StatusBadge, Tabs, Textarea, Toggle } from '@/components/ui'
import { VolunteerFacts } from '@/components/VolunteerFacts'
import { VolunteerSelect } from '@/components/VolunteerPick'
import { StagesCard } from '@/components/StagesCard'
import { RecruitHistory, useRecruitLog } from '@/pages/Recruit'
import { ContactLinks } from '@/components/VolunteerLink'
import { useAuth, usePermissions } from '@/lib/auth'
import { ageFrom, fmtShort, useLookups, useStatusOptions, whatsappLink, withCurrent } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { POSITIONS, type Participation, type Volunteer, type VolunteerHr } from '@/lib/types'
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
    ...(p.can('hr.view') || p.full ? [{ value: 'interview' as Tab, label: 'الحالة والمقابلة' }] : []),
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
            <Badge tone="brand">{v.position}</Badge>
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
            <VolunteerFacts v={v} />
            <StagesCard volunteerId={v.id} self={false} />
            {p.can('national_id.view') && <NationalIdCard volunteerId={v.id} canEdit={p.can('national_id.edit')} />}
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
      {tab === 'interview' && (
        <div className="space-y-4">
          <Interview v={v} />
          {p.can('hr.view') && <RecruitCard volunteerId={v.id} />}
          <FollowupCard v={v} canEdit={p.can('volunteers.edit')} canNote={p.can('volunteers.edit') || p.leader} />
        </div>
      )}
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

/** Status, job and committees (volunteers.edit) and the interview data (hr.*). */
function Interview({ v }: { v: Volunteer }) {
  const opts = useStatusOptions()
  const qc = useQueryClient()
  const p = usePermissions()
  const lookups = useLookups()
  const canEditStatus = p.can('volunteers.edit')
  const seesHr = p.can('hr.view')
  const canEditHr = p.can('hr.edit')
  const seesNotes = p.can('hr.notes')
  const hr = useQuery({
    queryKey: ['hr', v.id],
    enabled: seesHr,
    queryFn: async () => {
      const { data, error } = await supabase.from(seesNotes ? 'volunteer_hr' : 'volunteer_hr_read').select('*').eq('volunteer_id', v.id).maybeSingle()
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
      interviewer_id: hr.data?.interviewer_id ?? null,
      hr_notes: hr.data?.hr_notes ?? '',
    },
  })
  const save = useMutation({
    mutationFn: async (f: Parameters<Parameters<typeof form.handleSubmit>[0]>[0]) => {
      if (canEditStatus) {
        const a = await supabase
          .from('volunteers')
          .update({ status: f.status, position: f.position, main_committee: f.main_committee || null, sub_committee: f.sub_committee || null })
          .eq('id', v.id)
        if (a.error) throw a.error
      }
      if (canEditHr) {
        const b = await supabase
          .from('volunteer_hr')
          .update({
            acceptance: f.acceptance || null,
            interview_date: f.interview_date || null,
            interviewer_id: f.interviewer_id || null,
            interviewer: f.interviewer_id ? null : f.interviewer || null,
            ...(seesNotes ? { hr_notes: f.hr_notes || null } : {}),
          })
          .eq('volunteer_id', v.id)
        if (b.error) throw b.error
      }
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      qc.invalidateQueries({ queryKey: ['volunteer', v.id] })
      qc.invalidateQueries({ queryKey: ['hr', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['volunteer_hr'] })
    },
    onError: toastError,
  })
  if (seesHr && hr.isLoading) return <Spinner />
  const committees = lookups.data?.list('اللجنة') ?? []
  return (
    <Card>
      <form onSubmit={form.handleSubmit((f) => save.mutate(f))} className="space-y-5">
        <fieldset disabled={!canEditStatus} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold text-brand-800 sm:col-span-2">الحالة والوظيفة واللجان</legend>
          <Field label="حالة المتطوع">
            <Select {...form.register('status')} options={withCurrent(opts.statuses, v.status)} />
          </Field>
          <Field label="الوظيفة" hint="بتحدد مكانه في الهيكل">
            <Select {...form.register('position')} options={POSITIONS} />
          </Field>
          <Field label="اللجنة الأساسية">
            <Select {...form.register('main_committee')} placeholder="—" options={committees} />
          </Field>
          <Field label="اللجنة الفرعية">
            <Select {...form.register('sub_committee')} placeholder="—" options={committees} />
          </Field>
        </fieldset>
        {seesHr && (
          <fieldset disabled={!canEditHr} className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-bold text-brand-800 sm:col-span-2">المقابلة</legend>
            <Field label="درجة القبول" hint={hr.data?.status_changed_at ? `آخر تغيير ${fmtShort(hr.data.status_changed_at)}` : undefined}>
              <Select {...form.register('acceptance')} placeholder="—" options={withCurrent(opts.acceptance, hr.data?.acceptance)} />
            </Field>
            <Field label="تاريخ المقابلة">
              <Input type="date" {...form.register('interview_date')} />
            </Field>
            <Field label="القائم على المقابلة" hint="المقابلة بتتحسب مشاركة «انترفيو» ليه وللمتطوع في يومها، من غير تسجيل">
              <VolunteerSelect
                value={form.watch('interviewer_id')}
                onChange={(id) => form.setValue('interviewer_id', id, { shouldDirty: true })}
                disabled={!canEditHr}
              />
              {!form.watch('interviewer_id') && hr.data?.interviewer && <p className="mt-1 text-xs text-muted">مسجّل قبل كده: {hr.data.interviewer}</p>}
            </Field>
            {seesNotes && (
              <div className="sm:col-span-2">
                <Field label="ملاحظات HR">
                  <Textarea {...form.register('hr_notes')} />
                </Field>
              </div>
            )}
          </fieldset>
        )}
        {(canEditStatus || canEditHr) ? (
          <Button type="submit" loading={save.isPending}>
            حفظ
          </Button>
        ) : (
          <p className="text-xs text-muted">عرض بس. التعديل محتاج صلاحية تعديل المتطوعين أو المقابلة.</p>
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

/** المتابعة: who follows this volunteer up, their notes, and why they left (for «شيت المتابعة»). */
function FollowupCard({ v, canEdit, canNote }: { v: Volunteer; canEdit: boolean; canNote: boolean }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const [f, setF] = useState({
    follower_id: v.follower_id ?? null,
    follower_trainee_id: v.follower_trainee_id ?? null,
    follow_head_id: v.follow_head_id ?? null,
    out_reason: v.out_reason ?? '',
    follow_notes_1: v.follow_notes_1 ?? '',
    follow_notes_2: v.follow_notes_2 ?? '',
    follow_notes_3: v.follow_notes_3 ?? '',
  })
  const save = useMutation({
    mutationFn: async () => {
      const notes = { follow_notes_1: f.follow_notes_1 || null, follow_notes_2: f.follow_notes_2 || null, follow_notes_3: f.follow_notes_3 || null }
      const payload = canEdit
        ? { ...notes, follower_id: f.follower_id, follower_trainee_id: f.follower_trainee_id, follow_head_id: f.follow_head_id, out_reason: f.out_reason || null }
        : notes
      const { error } = await supabase.from('volunteers').update(payload).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      qc.invalidateQueries({ queryKey: ['volunteer', v.id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  if (!canEdit && !canNote) return null
  return (
    <Card>
      <p className="mb-1 font-bold text-brand-800">المتابعة</p>
      <p className="mb-4 text-xs text-muted">بتطلع في شيت المتابعة اللي بيتبعت كل نص شهر.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="المتابع">
          <VolunteerSelect value={f.follower_id} onChange={(id) => setF({ ...f, follower_id: id })} disabled={!canEdit} />
        </Field>
        <Field label="متابع تحت التدريب">
          <VolunteerSelect value={f.follower_trainee_id} onChange={(id) => setF({ ...f, follower_trainee_id: id })} disabled={!canEdit} />
        </Field>
        <Field label="هيد المتابعة">
          <VolunteerSelect value={f.follow_head_id} onChange={(id) => setF({ ...f, follow_head_id: id })} disabled={!canEdit} />
        </Field>
        <div className="sm:col-span-3">
          <Field label="سبب الخروج من المتابعة (الأعمدة)" hint="لو اتحدد، المتطوع بيطلع «خارج المتابعة» في الشيت">
            <Select
              value={f.out_reason}
              onChange={(e) => setF({ ...f, out_reason: e.target.value })}
              placeholder="—"
              options={withCurrent(lookups.data?.list('سبب الخروج') ?? [], v.out_reason)}
              disabled={!canEdit}
            />
          </Field>
        </div>
        {(['follow_notes_1', 'follow_notes_2', 'follow_notes_3'] as const).map((k, i) => (
          <Field key={k} label={`ملاحظات ${i + 1}`}>
            <Textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} rows={2} />
          </Field>
        ))}
      </div>
      <Button className="mt-4" onClick={() => save.mutate()} loading={save.isPending}>
        حفظ
      </Button>
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

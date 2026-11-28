import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Pencil, UserRound } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { CertificateCard } from '@/components/CertificateCard'
import { VolunteerFacts } from '@/components/VolunteerFacts'
import { useVolunteerPhoto } from '@/components/VolunteerPhoto'
import { MyGroupsCard } from '@/components/MyGroups'
import MyActivities from '@/pages/MyActivities'
import { Link } from 'react-router-dom'
import { Button, Card, Field, Input, Modal, PageHeader, Spinner, Textarea } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtShort } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Volunteer, VolunteerPrivate } from '@/lib/types'

const phoneRule = z.string().regex(/^01\d{9}$/, 'الرقم لازم يكون 11 رقم ويبدأ بـ 01')
export const personalSchema = z.object({
  full_name_ar: z.string().min(3, 'اكتب الاسم رباعي'),
  full_name_en: z.string().optional(),
  phone: phoneRule,
  whatsapp: phoneRule.or(z.literal('')).optional(),
  email: z.string().email('إيميل مش صحيح').or(z.literal('')).optional(),
  qualification: z.string().optional(),
  job: z.string().optional(),
  area: z.string().optional(),
  availability_notes: z.string().optional(),
  referral_source: z.string().optional(),
  study_year: z.string().optional(),
  facebook: z.string().optional(),
})
export type PersonalValues = z.infer<typeof personalSchema>

export function PersonalFields({ form }: { form: ReturnType<typeof useForm<PersonalValues>> }) {
  const { register, formState } = form
  const e = formState.errors
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="الاسم رباعي بالعربي" error={e.full_name_ar?.message}>
        <Input {...register('full_name_ar')} />
      </Field>
      <Field label="الاسم رباعي بالإنجليزي">
        <Input {...register('full_name_en')} dir="ltr" />
      </Field>
      <Field label="رقم الهاتف" error={e.phone?.message}>
        <Input {...register('phone')} inputMode="tel" dir="ltr" />
      </Field>
      <Field label="رقم الواتساب" hint="لو نفس رقم الهاتف سيبه فاضي" error={e.whatsapp?.message}>
        <Input {...register('whatsapp')} inputMode="tel" dir="ltr" />
      </Field>
      <Field label="الإيميل" hint="ده اللي بتدخل بيه التطبيق" error={e.email?.message}>
        <Input {...register('email')} type="email" dir="ltr" />
      </Field>
      <Field label="المؤهل الدراسي">
        <Input {...register('qualification')} />
      </Field>
      <Field label="الوظيفة">
        <Input {...register('job')} />
      </Field>
      <Field label="المنطقة السكنية">
        <Input {...register('area')} />
      </Field>
      <Field label="السنة الدراسية (لو طالب)">
        <Input {...register('study_year')} list="study-years" placeholder="مثلاً: سنة تالتة جامعة، خريج" />
        <datalist id="study-years">
          {['طالب ثانوي', 'سنة أولى جامعة', 'سنة تانية جامعة', 'سنة تالتة جامعة', 'سنة رابعة جامعة', 'سنة خامسة جامعة', 'خريج'].map((y) => (
            <option key={y} value={y} />
          ))}
        </datalist>
      </Field>
      <Field label="لينك الفيسبوك">
        <Input {...register('facebook')} dir="ltr" placeholder="https://facebook.com/..." />
      </Field>
      <div className="sm:col-span-2">
        <Field label="المواعيد المتاحة والملاحظات">
          <Textarea {...register('availability_notes')} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="عرفت نشاط دروس التقوية إزاي">
          <Input {...register('referral_source')} />
        </Field>
      </div>
    </div>
  )
}

export const toPersonalPayload = (v: PersonalValues) => ({
  full_name_ar: v.full_name_ar.trim(),
  full_name_en: v.full_name_en?.trim() || null,
  phone: v.phone,
  whatsapp: v.whatsapp || null,
  email: v.email?.trim().toLowerCase() || null,
  qualification: v.qualification || null,
  job: v.job || null,
  area: v.area || null,
  availability_notes: v.availability_notes || null,
  referral_source: v.referral_source || null,
  study_year: v.study_year?.trim() || null,
  facebook: v.facebook?.trim() || null,
})

export const personalDefaults = (v: Volunteer): PersonalValues => ({
  full_name_ar: v.full_name_ar,
  full_name_en: v.full_name_en ?? '',
  phone: v.phone ?? '',
  whatsapp: v.whatsapp && v.whatsapp !== v.phone ? v.whatsapp : '',
  email: v.email ?? '',
  qualification: v.qualification ?? '',
  job: v.job ?? '',
  area: v.area ?? '',
  availability_notes: v.availability_notes ?? '',
  referral_source: v.referral_source ?? '',
  study_year: v.study_year ?? '',
  facebook: v.facebook ?? '',
})

/** National ID: read-only unless the person has national_id.edit. No change requests. */
export function NationalIdCard({ volunteerId, canEdit }: { volunteerId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['private', volunteerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_private').select('*').eq('volunteer_id', volunteerId).maybeSingle()
      if (error) throw error
      return data as VolunteerPrivate | null
    },
  })
  const form = useForm<{ nid: string }>()
  const save = useMutation({
    mutationFn: async (nid: string) => {
      const { error } = await supabase.from('volunteer_private').update({ national_id: nid }).eq('volunteer_id', volunteerId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الرقم القومي اتغيّر، وتاريخ الميلاد والنوع اتحسبوا منه')
      form.reset({ nid: '' })
      qc.invalidateQueries({ queryKey: ['private', volunteerId] })
      qc.invalidateQueries({ queryKey: ['volunteer', volunteerId] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })

  if (q.isLoading) return null
  return (
    <Card>
      <p className="font-bold">الرقم القومي</p>
      <p className="ltr mt-1 text-start text-lg font-semibold tracking-wider">{q.data?.national_id ?? '—'}</p>
      {canEdit ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={form.handleSubmit(({ nid }) => {
            const clean = nid.replace(/\D/g, '')
            if (!/^[23]\d{13}$/.test(clean)) return toast.error('الرقم القومي 14 رقم ويبدأ بـ 2 أو 3')
            save.mutate(clean)
          })}
        >
          <Input {...form.register('nid')} inputMode="numeric" dir="ltr" placeholder="رقم قومي جديد" />
          <Button type="submit" variant="secondary" loading={save.isPending}>
            حفظ
          </Button>
        </form>
      ) : (
        <p className="mt-1 text-xs text-muted">لو فيه غلط عدّله من «تعديل بياناتي» والـ HR هيراجعه.</p>
      )}
    </Card>
  )
}

interface ProfileRequest {
  id: string
  changes: Record<string, string | null>
  old_values: Record<string, string | null>
  photo_path: string | null
  status: 'pending' | 'accepted' | 'rejected'
  note: string | null
  created_at: string
  reviewed_at: string | null
}

/** Labels of the fields a volunteer can ask to change (the same list as app.profile_fields()). */
export const PROFILE_FIELDS: [keyof PersonalValues | 'national_id', string][] = [
  ['full_name_ar', 'الاسم بالعربي'],
  ['full_name_en', 'الاسم بالإنجليزي'],
  ['phone', 'التليفون'],
  ['whatsapp', 'الواتساب'],
  ['email', 'الإيميل'],
  ['qualification', 'المؤهل'],
  ['area', 'المنطقة'],
  ['study_year', 'السنة الدراسية'],
  ['national_id', 'الرقم القومي'],
]

function useMyRequest(volunteerId: string | null) {
  return useQuery({
    queryKey: ['my-profile-request', volunteerId],
    enabled: Boolean(volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_requests')
        .select('*')
        .eq('volunteer_id', volunteerId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as ProfileRequest | null
    },
  })
}

/** بياناتي: everything about the volunteer to read. Changes (and the photo) go as a request to HR. */
export default function MyProfile() {
  const { volunteerId, can } = usePermissions()
  const [editing, setEditing] = useState(false)
  const q = useQuery({
    queryKey: ['volunteer', volunteerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteers').select('*').eq('id', volunteerId!).single()
      if (error) throw error
      return data as Volunteer
    },
  })
  const req = useMyRequest(volunteerId)
  const priv = useQuery({
    queryKey: ['private', volunteerId],
    enabled: Boolean(volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteer_private').select('*').eq('volunteer_id', volunteerId!).maybeSingle()
      if (error) throw error
      return data as VolunteerPrivate | null
    },
  })
  const photo = useVolunteerPhoto(volunteerId)

  if (q.isLoading || !q.data) return <Spinner />
  const v = q.data
  const r = req.data
  const pending = r?.status === 'pending' ? r : null
  const whatsapp = v.whatsapp && v.whatsapp !== v.phone ? v.whatsapp : null

  return (
    <>
      <PageHeader
        title="بياناتي"
        subtitle={<span className="ltr">{v.code}</span>}
        actions={
          <>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> {pending ? 'عدّل الطلب' : 'تعديل بياناتي'}
            </Button>
            <Link to="/me/form">
              <Button variant="secondary">استمارة التطوع</Button>
            </Link>
          </>
        }
      />
      {pending && (
        <Card className="mb-4 bg-orange-50 ring-orange-200">
          <p className="font-bold text-orange-800">طلب التعديل بتاعك مستني مراجعة الـ HR</p>
          <RequestChanges r={pending} />
        </Card>
      )}
      {r?.status === 'rejected' && (
        <Card className="mb-4 bg-red-50 ring-red-200">
          <p className="font-bold text-red-800">آخر طلب تعديل اترفض{r.reviewed_at ? ` (${fmtShort(r.reviewed_at)})` : ''}</p>
          {r.note && <p className="text-sm">{r.note}</p>}
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="flex items-center gap-4">
              <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface text-muted">
                {photo.url ? <img src={photo.url} alt="" className="h-full w-full object-cover" /> : <UserRound className="size-12" />}
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold">{v.full_name_ar}</p>
                {v.full_name_en && <p className="ltr text-start text-sm text-muted">{v.full_name_en}</p>}
                {!photo.url && <p className="mt-1 text-xs text-orange-700">مفيش صورة. ضيف صورة من «تعديل بياناتي».</p>}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-2">
              <Info label="التليفون" ltr>{v.phone}</Info>
              <Info label="الواتساب" ltr>{whatsapp ?? (v.phone ? 'نفس التليفون' : null)}</Info>
              <Info label="الإيميل" ltr>{v.email}</Info>
              <Info label="المؤهل">{v.qualification}</Info>
              <Info label="المنطقة">{v.area}</Info>
              <Info label="السنة الدراسية">{v.study_year}</Info>
            </dl>
          </Card>
          <MyActivities embedded />
        </div>
        <div className="space-y-4">
          <VolunteerFacts v={v} />
          <NationalIdCard volunteerId={v.id} canEdit={can('national_id.edit')} />
          <CertificateCard volunteerId={v.id} />
          <MyGroupsCard volunteerId={v.id} joined={Boolean(v.joined_group)} />
        </div>
      </div>
      {editing && <EditRequestModal v={v} pending={pending} photoUrl={photo.url} nationalId={priv.data?.national_id ?? null} onClose={() => setEditing(false)} />}
    </>
  )
}

function Info({ label, ltr, children }: { label: string; ltr?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={clsx('min-w-0 break-words text-end font-semibold', ltr && 'ltr')}>{children || '—'}</dd>
    </div>
  )
}

/** What a request changes: old → new, and the new photo. */
export function RequestChanges({ r, photoUrl }: { r: Pick<ProfileRequest, 'changes' | 'old_values' | 'photo_path'>; photoUrl?: string | null }) {
  const label = new Map(PROFILE_FIELDS)
  return (
    <ul className="mt-1 space-y-1 text-sm">
      {Object.entries(r.changes).map(([k, val]) => (
        <li key={k}>
          <span className="text-muted">{label.get(k as keyof PersonalValues | 'national_id') ?? k}: </span>
          <span className="line-through opacity-60">{r.old_values[k] || '—'}</span> ← <b>{val || '—'}</b>
        </li>
      ))}
      {r.photo_path && (
        <li className="flex items-center gap-2">
          <span className="text-muted">صورة جديدة</span>
          {photoUrl && <img src={photoUrl} alt="" className="size-16 rounded-xl object-cover" />}
        </li>
      )}
    </ul>
  )
}

const requestSchema = personalSchema.pick({ full_name_ar: true, full_name_en: true, phone: true, whatsapp: true, email: true, qualification: true, study_year: true }).extend({
  area: z.string().optional(),
  national_id: z
    .string()
    .optional()
    .refine((x) => !x || /^[23]\d{13}$/.test(x.replace(/\D/g, '')), 'الرقم القومي 14 رقم ويبدأ بـ 2 أو 3'),
})
type RequestValues = z.infer<typeof requestSchema>

function EditRequestModal({ v, pending, photoUrl, nationalId, onClose }: { v: Volunteer; pending: ProfileRequest | null; photoUrl: string | null; nationalId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const base: Record<string, string | undefined> = { ...personalDefaults(v), national_id: nationalId ?? '' }
  const start: RequestValues = Object.fromEntries(
    PROFILE_FIELDS.map(([k]) => [k, pending && k in pending.changes ? (pending.changes[k] ?? '') : (base[k] ?? '')]),
  ) as RequestValues
  const form = useForm<RequestValues>({ resolver: zodResolver(requestSchema), defaultValues: start })
  const [picked, setPicked] = useState<File | null>(null)
  const preview = useMemo(() => (picked ? URL.createObjectURL(picked) : null), [picked])
  const file = useRef<HTMLInputElement>(null)
  const e = form.formState.errors
  const send = useMutation({
    mutationFn: async (vals: RequestValues) => {
      let path: string | null = pending?.photo_path ?? null
      if (picked) {
        if (picked.size > 3 * 1024 * 1024) throw { message: 'الصورة أكبر من 3 ميجا' }
        const ext = picked.type === 'image/png' ? 'png' : picked.type === 'image/webp' ? 'webp' : 'jpg'
        path = `${v.id}/request-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('photos').upload(path, picked, { contentType: picked.type })
        if (error) throw error
      }
      const changes = Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, (vals[k as keyof RequestValues] ?? '').replace(k === 'national_id' ? /\D/g : /^$/, '').trim()]))
      const { error } = await supabase.rpc('submit_profile_request', { p_changes: changes, p_photo: path })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الطلب اتبعت للـ HR. هيوصلك إشعار لما يتراجع')
      qc.invalidateQueries({ queryKey: ['my-profile-request'] })
      onClose()
    },
    onError: toastError,
  })
  const reg = form.register
  return (
    <Modal open onClose={onClose} title="تعديل بياناتي">
      <form className="space-y-4" onSubmit={form.handleSubmit((vals) => send.mutate(vals))}>
        <p className="text-sm text-muted">اكتب البيانات الجديدة. التعديل بيتبعت طلب والـ HR بيراجعه قبل ما يتغير.</p>
        <div className="flex items-center gap-3">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface text-muted">
            {preview || photoUrl ? <img src={preview ?? photoUrl!} alt="" className="h-full w-full object-cover" /> : <UserRound className="size-10" />}
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={() => file.current?.click()}>
              <Camera className="size-4" /> {photoUrl || preview ? 'صورة جديدة' : 'ضيف صورة'}
            </Button>
            <p className="mt-1 text-xs text-muted">صورة شخصية واضحة، أقل من 3 ميجا.</p>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(ev) => {
              setPicked(ev.target.files?.[0] ?? null)
              ev.target.value = ''
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="الاسم رباعي بالعربي" error={e.full_name_ar?.message}>
            <Input {...reg('full_name_ar')} />
          </Field>
          <Field label="الاسم رباعي بالإنجليزي">
            <Input {...reg('full_name_en')} dir="ltr" />
          </Field>
          <Field label="رقم التليفون" error={e.phone?.message}>
            <Input {...reg('phone')} inputMode="tel" dir="ltr" />
          </Field>
          <Field label="رقم الواتساب" hint="لو نفس التليفون سيبه فاضي" error={e.whatsapp?.message}>
            <Input {...reg('whatsapp')} inputMode="tel" dir="ltr" />
          </Field>
          <Field label="الإيميل" hint="ده اللي بتدخل بيه الموقع" error={e.email?.message}>
            <Input {...reg('email')} type="email" dir="ltr" />
          </Field>
          <Field label="المؤهل الدراسي">
            <Input {...reg('qualification')} />
          </Field>
          <Field label="المنطقة السكنية">
            <Input {...reg('area')} />
          </Field>
          <Field label="السنة الدراسية (لو طالب)">
            <Input {...reg('study_year')} list="study-years" />
          </Field>
          <Field label="الرقم القومي" hint="منه بيتحسب تاريخ الميلاد والنوع" error={e.national_id?.message}>
            <Input {...reg('national_id')} inputMode="numeric" dir="ltr" maxLength={14} />
          </Field>
        </div>
        <Button type="submit" className="w-full" loading={send.isPending}>
          ابعت الطلب
        </Button>
      </form>
    </Modal>
  )
}

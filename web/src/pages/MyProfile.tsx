import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge, Button, Card, Field, Input, PageHeader, Spinner, StatusBadge, Textarea } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { ageFrom, fmtDate, useSetting } from '@/lib/data'
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
})
export type PersonalValues = z.infer<typeof personalSchema>

export function PersonalFields({ form }: { form: ReturnType<typeof useForm<PersonalValues>> }) {
  const { register, formState } = form
  const e = formState.errors
  return (
    <div className="grid gap-4 sm:grid-cols-2">
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
})

export function NationalIdCard({ volunteerId, canEditDirectly }: { volunteerId: string; canEditDirectly: boolean }) {
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
      const patch = canEditDirectly ? { national_id: nid } : { requested_national_id: nid }
      const { error } = await supabase.from('volunteer_private').update(patch).eq('volunteer_id', volunteerId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(canEditDirectly ? 'الرقم القومي اتغيّر' : 'الطلب اتبعت للـ HR')
      form.reset({ nid: '' })
      qc.invalidateQueries({ queryKey: ['private', volunteerId] })
      qc.invalidateQueries({ queryKey: ['volunteer', volunteerId] })
    },
    onError: toastError,
  })

  if (q.isLoading) return null
  return (
    <Card>
      <p className="font-bold">الرقم القومي</p>
      <p className="mb-2 text-xs text-muted">
        {canEditDirectly
          ? 'بصلاحيتك (أدمن أو ليدر نشاط أو HR) التعديل بيتحفظ على طول، وتاريخ الميلاد والنوع بيتحسبوا منه.'
          : 'التغيير بيتبعت طلب، والأدمن أو ليدر النشاط أو الـ HR بيوافقوا عليه.'}
      </p>
      <p className="ltr text-start text-lg font-semibold tracking-wider">{q.data?.national_id ?? '—'}</p>
      {q.data?.requested_national_id && (
        <p className="mt-2 text-sm">
          <Badge tone="orange">مستني موافقة</Badge> <span className="ltr">{q.data.requested_national_id}</span>
        </p>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={form.handleSubmit(({ nid }) => {
          if (!/^[23]\d{13}$/.test(nid)) return toast.error('الرقم القومي 14 رقم ويبدأ بـ 2 أو 3')
          save.mutate(nid)
        })}
      >
        <Input {...form.register('nid')} inputMode="numeric" dir="ltr" placeholder={canEditDirectly ? 'رقم قومي جديد' : 'لو عايز تغيّره اكتبه هنا'} />
        <Button type="submit" variant="secondary" loading={save.isPending}>
          {canEditDirectly ? 'حفظ' : 'اطلب تغيير'}
        </Button>
      </form>
    </Card>
  )
}

export default function MyProfile() {
  const { volunteerId, full } = usePermissions()
  const qc = useQueryClient()
  const groupLink = useSetting('whatsapp_group_link')
  const q = useQuery({
    queryKey: ['volunteer', volunteerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('volunteers').select('*').eq('id', volunteerId!).single()
      if (error) throw error
      return data as Volunteer
    },
  })
  const form = useForm<PersonalValues>({ resolver: zodResolver(personalSchema), values: q.data ? personalDefaults(q.data) : undefined })
  const save = useMutation({
    mutationFn: async (v: PersonalValues) => {
      const { error } = await supabase.from('volunteers').update(toPersonalPayload(v)).eq('id', volunteerId!)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('البيانات اتحفظت')
      qc.invalidateQueries({ queryKey: ['volunteer', volunteerId] })
    },
    onError: toastError,
  })

  if (q.isLoading || !q.data) return <Spinner />
  const v = q.data
  const age = ageFrom(v.birth_date)

  return (
    <>
      <PageHeader title="بياناتي" subtitle={<span className="ltr">{v.code}</span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <form onSubmit={form.handleSubmit((vals) => save.mutate(vals))} className="space-y-5">
              <PersonalFields form={form} />
              <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
                حفظ التعديلات
              </Button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <p className="mb-3 font-bold">في النشاط</p>
            <dl className="space-y-2 text-sm">
              <Row label="الحالة"><StatusBadge status={v.status} /></Row>
              <Row label="اللجنة الأساسية">{v.main_committee ?? '—'}</Row>
              <Row label="اللجنة الفرعية">{v.sub_committee ?? '—'}</Row>
              <Row label="تاريخ الميلاد">{fmtDate(v.birth_date)}{age !== null && ` (${age} سنة)`}</Row>
              <Row label="اتسجلت">{fmtDate(v.registered_at)}</Row>
              <Row label="الميني كامب">{v.attended_minicamp ? fmtDate(v.minicamp_date) : 'لسه'}</Row>
              <Row label="التيشيرت">{v.bought_tshirt ? 'اشتريته' : 'لسه'}</Row>
            </dl>
          </Card>
          <NationalIdCard volunteerId={v.id} canEditDirectly={full} />
          {groupLink.data && !v.joined_group && (
            <a href={groupLink.data} target="_blank" rel="noreferrer">
              <Button className="w-full">ادخل جروب الواتساب</Button>
            </a>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  )
}

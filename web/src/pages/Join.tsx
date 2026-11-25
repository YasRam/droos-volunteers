import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, Card, Field, Input, Textarea } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

const phone = z.string().trim().regex(/^01\d{9}$/, 'الرقم لازم يكون 11 رقم ويبدأ بـ 01')
const schema = z.object({
  full_name_ar: z.string().trim().refine((s) => s.split(/\s+/).length >= 3, 'اكتب اسمك ثلاثي على الأقل'),
  national_id: z.string().trim().regex(/^[23]\d{13}$/, 'الرقم القومي 14 رقم'),
  phone,
  whatsapp: phone.or(z.literal('')),
  email: z.string().trim().email('إيميل مش صحيح').or(z.literal('')),
  // the rest: required or hidden as set in the form setup
  full_name_en: z.string(),
  study_year: z.string(),
  qualification: z.string(),
  job: z.string(),
  area: z.string(),
  availability_notes: z.string(),
  referral_source: z.string(),
  facebook: z.string(),
  website: z.string(), // hidden: only robots fill it
})
type Values = z.infer<typeof schema>

export type FieldMode = 'required' | 'optional' | 'hidden'
export interface JoinFormSetup {
  title?: string
  intro?: string
  success_title?: string
  success_message?: string
  whatsapp_link?: string
  fields?: Partial<Record<OptionalField, FieldMode>>
}
export const OPTIONAL_FIELDS = [
  ['whatsapp', 'رقم الواتساب'],
  ['email', 'الإيميل'],
  ['full_name_en', 'الاسم بالإنجليزي'],
  ['study_year', 'الكلية والسنة الدراسية'],
  ['qualification', 'المؤهل'],
  ['job', 'الشغل'],
  ['area', 'المنطقة'],
  ['referral_source', 'عرفت النشاط منين؟'],
  ['facebook', 'لينك الفيسبوك'],
  ['availability_notes', 'الأيام والمواعيد اللي تناسبك'],
] as const
export type OptionalField = (typeof OPTIONAL_FIELDS)[number][0]

export const DEFAULT_SETUP: Required<Omit<JoinFormSetup, 'fields'>> = {
  title: 'التطوع في نشاط دروس التقوية',
  intro: 'املا بياناتك وفريق الـ HR هيتواصل معاك. لو اتسجلت قبل كده ابعت بياناتك الجديدة عادي.',
  success_title: 'بياناتك وصلت 🎉',
  success_message: 'فريق الـ HR هيتواصل معاك على رقمك عشان نحدد ميعاد المقابلة.',
  whatsapp_link: '',
}

/** Public sign-up for new volunteers: no account needed, so the link can go to anyone. */
export default function Join() {
  const setupQ = useQuery({
    queryKey: ['join-form'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('join_form')
      if (error) throw error
      return (data ?? {}) as JoinFormSetup
    },
  })
  const setup = { ...DEFAULT_SETUP, ...Object.fromEntries(Object.entries(setupQ.data ?? {}).filter(([, v]) => v !== '' && v != null)) } as JoinFormSetup & typeof DEFAULT_SETUP
  const mode = (k: OptionalField): FieldMode => setup.fields?.[k] ?? 'optional'
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<string>()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(Object.keys(schema.shape).map((k) => [k, ''])) as Values,
  })
  const { register, formState } = form
  const lbl = (k: OptionalField, text: string) => (mode(k) === 'required' ? `${text} *` : text)
  const e = formState.errors

  if (done)
    return (
      <Shell>
        <Card className="text-center">
          <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
          <h1 className="mt-3 text-xl font-bold">{setup.success_title}</h1>
          <p className="mt-2 whitespace-pre-line text-sm text-muted">{setup.success_message}</p>
          {setup.whatsapp_link && (
            <a href={setup.whatsapp_link} target="_blank" rel="noreferrer" className="mt-5 inline-block rounded-xl bg-emerald-600 px-5 py-2.5 font-bold text-white">
              ادخل جروب الواتساب
            </a>
          )}
        </Card>
      </Shell>
    )

  return (
    <Shell>
      <Card>
        <h1 className="text-xl font-bold">{setup.title}</h1>
        <p className="mt-1 whitespace-pre-line text-sm text-muted">{setup.intro}</p>
        <form
          className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={form.handleSubmit(async (v) => {
            setServerError(undefined)
            const missing = OPTIONAL_FIELDS.find(([k]) => mode(k) === 'required' && !String(v[k] ?? '').trim())
            if (missing) return setServerError(`خانة «${missing[1]}» مطلوبة`)
            const { error } = await supabase.rpc('join_activity', { p: v })
            if (error) setServerError(errorMessage(error))
            else setDone(true)
          })}
        >
          <Field label="الاسم رباعي بالعربي *" error={e.full_name_ar?.message}>
            <Input {...register('full_name_ar')} autoComplete="name" />
          </Field>
          <Field label="الرقم القومي *" error={e.national_id?.message}>
            <Input {...register('national_id')} inputMode="numeric" dir="ltr" maxLength={14} />
          </Field>
          <Field label="رقم الموبايل *" error={e.phone?.message}>
            <Input {...register('phone')} inputMode="tel" dir="ltr" autoComplete="tel" />
          </Field>
          {mode('whatsapp') !== 'hidden' && (
          <Field label={lbl('whatsapp', 'رقم الواتساب')} hint="لو نفس الموبايل سيبه فاضي" error={e.whatsapp?.message}>
            <Input {...register('whatsapp')} inputMode="tel" dir="ltr" />
          </Field>
          )}
          {mode('email') !== 'hidden' && (
          <Field label={lbl('email', 'الإيميل')} hint="جيميل بيخليك تدخل الموقع بعد كده" error={e.email?.message}>
            <Input {...register('email')} type="email" dir="ltr" autoComplete="email" />
          </Field>
          )}
          {mode('full_name_en') !== 'hidden' && (
          <Field label={lbl('full_name_en', 'الاسم بالإنجليزي')}>
            <Input {...register('full_name_en')} dir="ltr" />
          </Field>
          )}
          {mode('study_year') !== 'hidden' && (
          <Field label={lbl('study_year', 'الكلية والسنة الدراسية (لو لسه بتدرس)')}>
            <Input {...register('study_year')} />
          </Field>
          )}
          {mode('qualification') !== 'hidden' && (
          <Field label={lbl('qualification', 'المؤهل')}>
            <Input {...register('qualification')} />
          </Field>
          )}
          {mode('job') !== 'hidden' && (
          <Field label={lbl('job', 'الشغل')}>
            <Input {...register('job')} />
          </Field>
          )}
          {mode('area') !== 'hidden' && (
          <Field label={lbl('area', 'المنطقة')}>
            <Input {...register('area')} />
          </Field>
          )}
          {mode('referral_source') !== 'hidden' && (
          <Field label={lbl('referral_source', 'عرفت النشاط منين؟')}>
            <Input {...register('referral_source')} />
          </Field>
          )}
          {mode('facebook') !== 'hidden' && (
          <Field label={lbl('facebook', 'لينك الفيسبوك')}>
            <Input {...register('facebook')} dir="ltr" />
          </Field>
          )}
          <div className="sm:col-span-2">
            {mode('availability_notes') !== 'hidden' && (
          <Field label={lbl('availability_notes', 'الأيام والمواعيد اللي تناسبك')}>
              <Textarea {...register('availability_notes')} rows={2} />
            </Field>
          )}
          </div>
          <input {...register('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 opacity-0" />
          {serverError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{serverError}</p>}
          <Button type="submit" className="sm:col-span-2" loading={formState.isSubmitting}>
            ابعت البيانات
          </Button>
        </form>
      </Card>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <div className="mb-5 flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-14 object-contain" />
        <div>
          <p className="font-bold">نشاط دروس التقوية</p>
          <p className="text-xs text-muted">جمعية رسالة للأعمال الخيرية · فرع إسكندرية</p>
        </div>
        <img src={`${import.meta.env.BASE_URL}resala.png`} alt="رسالة" className="ms-auto h-10 w-auto object-contain" />
      </div>
      {children}
    </div>
  )
}

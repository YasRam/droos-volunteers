import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
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

/** Public sign-up for new volunteers: no account needed, so the link can go to anyone. */
export default function Join() {
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<string>()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(Object.keys(schema.shape).map((k) => [k, ''])) as Values,
  })
  const { register, formState } = form
  const e = formState.errors

  if (done)
    return (
      <Shell>
        <Card className="text-center">
          <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
          <h1 className="mt-3 text-xl font-bold">بياناتك وصلت 🎉</h1>
          <p className="mt-2 text-sm text-muted">فريق الـ HR هيتواصل معاك على رقمك عشان نحدد ميعاد المقابلة.</p>
        </Card>
      </Shell>
    )

  return (
    <Shell>
      <Card>
        <h1 className="text-xl font-bold">التطوع في نشاط دروس التقوية</h1>
        <p className="mt-1 text-sm text-muted">املا بياناتك وفريق الـ HR هيتواصل معاك. لو اتسجلت قبل كده ابعت بياناتك الجديدة عادي.</p>
        <form
          className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={form.handleSubmit(async (v) => {
            setServerError(undefined)
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
          <Field label="رقم الواتساب" hint="لو نفس الموبايل سيبه فاضي" error={e.whatsapp?.message}>
            <Input {...register('whatsapp')} inputMode="tel" dir="ltr" />
          </Field>
          <Field label="الإيميل" hint="جيميل بيخليك تدخل الموقع بعد كده" error={e.email?.message}>
            <Input {...register('email')} type="email" dir="ltr" autoComplete="email" />
          </Field>
          <Field label="الاسم بالإنجليزي">
            <Input {...register('full_name_en')} dir="ltr" />
          </Field>
          <Field label="الكلية والسنة الدراسية (لو لسه بتدرس)">
            <Input {...register('study_year')} />
          </Field>
          <Field label="المؤهل">
            <Input {...register('qualification')} />
          </Field>
          <Field label="الشغل">
            <Input {...register('job')} />
          </Field>
          <Field label="المنطقة">
            <Input {...register('area')} />
          </Field>
          <Field label="عرفت النشاط منين؟">
            <Input {...register('referral_source')} />
          </Field>
          <Field label="لينك الفيسبوك">
            <Input {...register('facebook')} dir="ltr" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="الأيام والمواعيد اللي تناسبك">
              <Textarea {...register('availability_notes')} rows={2} />
            </Field>
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <div className="mb-5 flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-10" />
        <div>
          <p className="font-bold">نشاط دروس التقوية</p>
          <p className="text-xs text-muted">فرع إسكندرية</p>
        </div>
      </div>
      {children}
    </div>
  )
}

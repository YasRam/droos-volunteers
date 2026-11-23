import { useId } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { Field, Input, Select, Textarea } from './ui'
import { useLookups } from '@/lib/data'

const TEACHING = ['تدريس', 'تحضير محتوى']

export const activitySchema = z
  .object({
    activity_date: z.string().min(1, 'اختار التاريخ'),
    event: z.string().min(1, 'اختار الحدث'),
    subject: z.string().trim().optional(),
    place: z.string().optional(),
    grade: z.string().optional(),
    beneficiaries: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (TEACHING.includes(v.event) && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'اكتب نوع الحدث' })
    if (TEACHING.includes(v.event) && !v.grade) ctx.addIssue({ code: 'custom', path: ['grade'], message: 'اختار السنة' })
    if (v.beneficiaries && !(Number(v.beneficiaries) > 0)) ctx.addIssue({ code: 'custom', path: ['beneficiaries'], message: 'رقم أكبر من صفر' })
  })

export type ActivityValues = z.infer<typeof activitySchema>

export function toActivityPayload(v: ActivityValues) {
  return {
    activity_date: v.activity_date,
    event: v.event,
    subject: v.subject || null,
    place: v.place || null,
    grade: v.grade || null,
    beneficiaries: v.beneficiaries ? Number(v.beneficiaries) : null,
    notes: v.notes || null,
  }
}

export default function ActivityFields({
  form,
  dateMin,
  dateMax,
  dateLocked,
}: {
  form: UseFormReturn<ActivityValues>
  dateMin?: string
  dateMax?: string
  dateLocked?: boolean
}) {
  const lookups = useLookups()
  const { register, watch, formState } = form
  const event = watch('event')
  const teaching = TEACHING.includes(event)
  const errors = formState.errors
  const listId = useId()
  // Types already used with this event first, then the ones used with other events
  const subjects = [...new Set([...(lookups.data?.list('نوع الحدث', event) ?? []), ...(lookups.data?.list('نوع الحدث') ?? [])])]

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="التاريخ" error={errors.activity_date?.message}>
        <Input type="date" {...register('activity_date')} min={dateMin} max={dateMax} disabled={dateLocked} />
      </Field>
      <Field label="الحدث" error={errors.event?.message}>
        <Select {...register('event')} placeholder="اختار..." options={lookups.data?.list('الحدث') ?? []} />
      </Field>
      <Field
        label={teaching ? 'نوع الحدث (المادة)' : 'نوع الحدث (اختياري)'}
        hint="اختار من الاقتراحات أو اكتب نوع جديد، وهيتضاف للقايمة للمرات الجاية"
        error={errors.subject?.message}
      >
        <Input {...register('subject')} list={listId} autoComplete="off" placeholder={teaching ? 'مثلاً: رياضيات' : 'مثلاً: ورشة إسعافات أولية'} />
        <datalist id={listId}>
          {subjects.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label="المكان">
        <Select {...register('place')} placeholder="—" options={lookups.data?.list('المكان') ?? []} />
      </Field>
      {teaching && (
        <Field label="السنة الدراسية" error={errors.grade?.message}>
          <Select {...register('grade')} placeholder="اختار..." options={lookups.data?.list('السنة الدراسية') ?? []} />
        </Field>
      )}
      {event === 'تدريس' && (
        <Field label="عدد الطلاب" error={errors.beneficiaries?.message}>
          <Input type="number" inputMode="numeric" min={1} {...register('beneficiaries')} />
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="ملاحظات (اختياري)">
          <Textarea {...register('notes')} rows={2} />
        </Field>
      </div>
    </div>
  )
}

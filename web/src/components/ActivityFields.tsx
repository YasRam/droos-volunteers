import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { Field, Input, Select, Textarea } from './ui'
import { useLookups } from '@/lib/data'
import type { Lookup } from '@/lib/types'

/**
 * What each «الحدث» asks for, set per event in الإعدادات ← القوائم:
 *  teaching → المادة والسنة (ممكن أكتر من واحدة) وعدد الطلاب، كلهم لازم
 *  none     → مفيش نوع حدث (زي التنظيم)
 *  optional → نوع الحدث اختياري
 */
export type EventForm = 'teaching' | 'none' | 'optional'
export const SEP = '، '
export const splitMulti = (s?: string | null) => (s ? s.split('،').map((x) => x.trim()).filter(Boolean) : [])

export function eventForm(rows: Lookup[] | undefined, event: string): EventForm {
  const r = rows?.find((x) => x.list === 'الحدث' && x.value === event)
  return (r?.form as EventForm | undefined) ?? 'optional'
}

export const activitySchema = z.object({
  activity_date: z.string().min(1, 'اختار التاريخ'),
  event: z.string().min(1, 'اختار الحدث'),
  subject: z.string().trim().optional(),
  place: z.string().optional(),
  grade: z.string().optional(),
  beneficiaries: z.string().optional(),
  notes: z.string().optional(),
})

export type ActivityValues = z.infer<typeof activitySchema>

/** Checks that depend on the event's form; returns field → message. */
export function validateActivity(v: ActivityValues, form: EventForm): Partial<Record<keyof ActivityValues, string>> {
  const e: Partial<Record<keyof ActivityValues, string>> = {}
  if (form === 'teaching') {
    if (!splitMulti(v.subject).length) e.subject = 'اختار المادة'
    if (!splitMulti(v.grade).length) e.grade = 'اختار السنة'
    if (!(Number(v.beneficiaries) > 0)) e.beneficiaries = 'اكتب عدد الطلاب'
  } else if (v.beneficiaries && !(Number(v.beneficiaries) > 0)) {
    e.beneficiaries = 'رقم أكبر من صفر'
  }
  return e
}

export function toActivityPayload(v: ActivityValues, form: EventForm = 'optional') {
  return {
    activity_date: v.activity_date,
    event: v.event,
    subject: form === 'none' ? null : splitMulti(v.subject).join(SEP) || null,
    place: v.place || null,
    grade: form === 'teaching' ? splitMulti(v.grade).join(SEP) || null : null,
    beneficiaries: form === 'teaching' && v.beneficiaries ? Number(v.beneficiaries) : null,
    notes: v.notes || null,
  }
}

/** Runs the event-specific checks and reports them on the form. Returns true when valid. */
export function checkActivity(form: UseFormReturn<ActivityValues>, rows: Lookup[] | undefined) {
  const v = form.getValues()
  const errors = validateActivity(v, eventForm(rows, v.event))
  for (const [k, msg] of Object.entries(errors)) form.setError(k as keyof ActivityValues, { message: msg })
  return Object.keys(errors).length === 0
}

/** Pick one or more values: suggestions + free text, shown as chips. Stored as «a، b». */
function MultiPick({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const listId = useId()
  const [draft, setDraft] = useState('')
  const items = splitMulti(value)
  const add = (x: string) => {
    const t = x.trim()
    if (!t || items.includes(t)) return setDraft('')
    onChange([...items, t].join(SEP))
    setDraft('')
  }
  return (
    <div>
      <div className="flex gap-2">
        <Input
          value={draft}
          list={listId}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value
            // picking a suggestion fills the whole value at once
            if (options.includes(v)) add(v)
            else setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
        />
        <button type="button" onClick={() => add(draft)} className="rounded-xl border border-line px-3 text-brand-700 hover:bg-brand-50" aria-label="إضافة">
          <Plus className="size-4" />
        </button>
        <datalist id={listId}>
          {options.filter((o) => !items.includes(o)).map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((x) => (
            <span key={x} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 ps-2.5 pe-1 text-sm font-semibold text-brand-800">
              {x}
              <button type="button" onClick={() => onChange(items.filter((i) => i !== x).join(SEP))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`شيل ${x}`}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
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
  const { register, watch, setValue, formState, clearErrors } = form
  const event = watch('event')
  const kind = event ? eventForm(lookups.data?.rows, event) : 'optional'
  const errors = formState.errors
  const listId = useId()
  // Types already used with this event first, then the rest
  const subjects = [...new Set([...(lookups.data?.list('نوع الحدث', event) ?? []), ...(lookups.data?.list('نوع الحدث') ?? [])])]
  const grades = lookups.data?.list('السنة الدراسية') ?? []

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="التاريخ" error={errors.activity_date?.message}>
        <Input type="date" {...register('activity_date')} min={dateMin} max={dateMax} disabled={dateLocked} />
      </Field>
      <Field label="الحدث" error={errors.event?.message}>
        <Select {...register('event')} placeholder="اختار..." options={lookups.data?.list('الحدث') ?? []} />
      </Field>

      {kind === 'teaching' ? (
        <>
          <Field label="المادة" hint="ممكن تختار أكتر من مادة" error={errors.subject?.message}>
            <MultiPick
              value={watch('subject') ?? ''}
              onChange={(v) => {
                setValue('subject', v)
                clearErrors('subject')
              }}
              options={subjects}
              placeholder="مثلاً: رياضيات"
            />
          </Field>
          <Field label="السنة الدراسية" hint="ممكن تختار أكتر من سنة" error={errors.grade?.message}>
            <MultiPick
              value={watch('grade') ?? ''}
              onChange={(v) => {
                setValue('grade', v)
                clearErrors('grade')
              }}
              options={grades}
              placeholder="اختار السنة"
            />
          </Field>
          <Field label="عدد الطلاب" error={errors.beneficiaries?.message}>
            <Input type="number" inputMode="numeric" min={1} {...register('beneficiaries')} />
          </Field>
        </>
      ) : kind === 'optional' ? (
        <Field label="نوع الحدث (اختياري)" hint="اختار من الاقتراحات أو اكتب نوع جديد" error={errors.subject?.message}>
          <Input {...register('subject')} list={listId} autoComplete="off" placeholder="مثلاً: ورشة إسعافات أولية" />
          <datalist id={listId}>
            {subjects.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      ) : null}

      <Field label="المكان">
        <Select {...register('place')} placeholder="—" options={lookups.data?.list('المكان') ?? []} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="ملاحظات (اختياري)">
          <Textarea {...register('notes')} rows={2} />
        </Field>
      </div>
    </div>
  )
}

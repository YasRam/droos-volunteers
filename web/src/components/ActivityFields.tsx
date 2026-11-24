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
 *  calls    → عدد المكالمات ومدتها
 */
export type EventForm = 'teaching' | 'none' | 'optional' | 'calls'
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
  duration_minutes: z.string().optional(),
  notes: z.string().optional(),
  with_content: z.boolean().optional(),
})

export type ActivityValues = z.infer<typeof activitySchema>

/** Checks that depend on the event's form; returns field → message. */
export function validateActivity(v: ActivityValues, form: EventForm): Partial<Record<keyof ActivityValues, string>> {
  const e: Partial<Record<keyof ActivityValues, string>> = {}
  if (form === 'teaching') {
    if (!splitMulti(v.subject).length) e.subject = 'اختار المادة'
    if (!splitMulti(v.grade).length) e.grade = 'اختار السنة'
    if (!(Number(v.beneficiaries) > 0)) e.beneficiaries = 'اكتب عدد الطلاب'
  } else if (form === 'calls') {
    if (!(Number(v.beneficiaries) > 0)) e.beneficiaries = 'اكتب عدد المكالمات'
    if (v.duration_minutes && !(Number(v.duration_minutes) > 0)) e.duration_minutes = 'رقم أكبر من صفر'
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
    beneficiaries: (form === 'teaching' || form === 'calls') && v.beneficiaries ? Number(v.beneficiaries) : null,
    duration_minutes: form === 'calls' && v.duration_minutes ? Number(v.duration_minutes) : null,
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

/** Pick one or more values by tapping them. Stored as «a، b». `allowOther` adds a free-text box (Enter to add). */
function MultiPick({ value, onChange, options, allowOther }: { value: string; onChange: (v: string) => void; options: string[]; allowOther?: boolean }) {
  const [draft, setDraft] = useState('')
  const items = splitMulti(value)
  const toggle = (x: string) => onChange((items.includes(x) ? items.filter((i) => i !== x) : [...items, x]).join(SEP))
  const all = [...options, ...items.filter((i) => !options.includes(i))]
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((o) => {
          const on = items.includes(o)
          return (
            <button
              type="button"
              key={o}
              onClick={() => toggle(o)}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1 text-sm font-semibold transition ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink hover:bg-brand-50'}`}
            >
              {o}
            </button>
          )
        })}
      </div>
      {allowOther && (
        <Input
          className="mt-2"
          value={draft}
          placeholder="مادة تانية؟ اكتبها ودوس Enter"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const t = draft.trim()
            if (t && !items.includes(t)) onChange([...items, t].join(SEP))
            setDraft('')
          }}
        />
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
              allowOther
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
            />
          </Field>
          <Field label="عدد الطلاب" error={errors.beneficiaries?.message}>
            <Input type="number" inputMode="numeric" min={1} {...register('beneficiaries')} />
          </Field>
          {event !== 'تحضير محتوى' && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-700" {...register('with_content')} />
              حضّرت محتوى الحصة دي كمان
            </label>
          )}
        </>
      ) : kind === 'calls' ? (
        <>
          <Field label="عدد المكالمات" error={errors.beneficiaries?.message}>
            <Input type="number" inputMode="numeric" min={1} {...register('beneficiaries')} />
          </Field>
          <Field label="المدة (بالدقايق)" error={errors.duration_minutes?.message}>
            <Input type="number" inputMode="numeric" min={1} {...register('duration_minutes')} />
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
        <Field label="تفاصيل الحدث (اختياري)">
          <Textarea {...register('notes')} rows={2} placeholder="أي تفاصيل عن اللي حصل" />
        </Field>
      </div>
    </div>
  )
}

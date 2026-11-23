import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { Field, Input, Select, Textarea } from './ui'
import { useLookups } from '@/lib/data'

/** Compare Arabic names typed different ways (ى/ي، أ/ا، ة/ه). */
export const norm = (t?: string | null) =>
  (t ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ى/g, 'ي')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')

/** تأسيس، تدريس، امتحان شهري، كورس: مادة وسنة (ممكن أكتر من واحدة) وعدد طلاب. */
const CLASS_EVENTS = ['تاسيس', 'تدريس', 'امتحان شهري', 'كورس'].map(norm)
/** Old rule kept: content preparation still needs a subject and a grade. */
const PREP_EVENTS = ['تحضير محتوي'].map(norm)
/** تنظيم has no event type. */
const NO_TYPE_EVENTS = ['تنظيم'].map(norm)

export const isClassEvent = (e?: string | null) => CLASS_EVENTS.includes(norm(e))
const needsSubject = (e?: string | null) => isClassEvent(e) || PREP_EVENTS.includes(norm(e))
export const hasNoType = (e?: string | null) => NO_TYPE_EVENTS.includes(norm(e))
export const isCamp = (e?: string | null) => ['ميني كامب', 'كامب'].includes(norm(e))

/** Several values live in one text field, separated by «، ». */
export const SEP = '، '
export const splitMulti = (v?: string | null) =>
  (v ?? '')
    .split(/\s*[،,]\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
const joinMulti = (xs: string[]) => [...new Set(xs)].join(SEP)

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
    if (needsSubject(v.event) && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'اختار المادة' })
    if (needsSubject(v.event) && !v.grade) ctx.addIssue({ code: 'custom', path: ['grade'], message: 'اختار السنة' })
    if (v.beneficiaries && !(Number(v.beneficiaries) > 0)) ctx.addIssue({ code: 'custom', path: ['beneficiaries'], message: 'رقم أكبر من صفر' })
  })

export type ActivityValues = z.infer<typeof activitySchema>

export function toActivityPayload(v: ActivityValues) {
  const classEvent = isClassEvent(v.event)
  const noType = hasNoType(v.event)
  return {
    activity_date: v.activity_date,
    event: v.event,
    subject: noType ? null : v.subject || null,
    place: v.place || null,
    grade: needsSubject(v.event) ? v.grade || null : null,
    beneficiaries: classEvent && v.beneficiaries ? Number(v.beneficiaries) : null,
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
  const { register, watch, setValue, formState } = form
  const event = watch('event')
  const classEvent = isClassEvent(event)
  const subjectNeeded = needsSubject(event)
  const noType = hasNoType(event)
  const errors = formState.errors
  const listId = useId()
  // Types already used with this event first, then the ones used with other events
  const subjects = [
    ...new Set([...(lookups.data?.list('نوع الحدث', event) ?? []), ...(lookups.data?.list('المادة') ?? []), ...(lookups.data?.list('نوع الحدث') ?? [])]),
  ]
  const grades = lookups.data?.list('السنة الدراسية') ?? []
  const set = (k: 'subject' | 'grade', v: string) => setValue(k, v, { shouldDirty: true, shouldValidate: formState.isSubmitted })

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="التاريخ" error={errors.activity_date?.message}>
        <Input type="date" {...register('activity_date')} min={dateMin} max={dateMax} disabled={dateLocked} />
      </Field>
      <Field label="الحدث" error={errors.event?.message}>
        <Select {...register('event')} placeholder="اختار..." options={lookups.data?.list('الحدث') ?? []} />
      </Field>
      {classEvent ? (
        <>
          <Field label="المادة" hint="ممكن تختار أكتر من مادة" error={errors.subject?.message}>
            <MultiPick value={watch('subject') ?? ''} onChange={(v) => set('subject', v)} options={subjects} placeholder="اختار أو اكتب مادة" allowNew />
          </Field>
          <Field label="السنة الدراسية" hint="ممكن تختار أكتر من سنة" error={errors.grade?.message}>
            <MultiPick value={watch('grade') ?? ''} onChange={(v) => set('grade', v)} options={grades} placeholder="اختار سنة" />
          </Field>
        </>
      ) : (
        !noType && (
          <Field
            label={subjectNeeded ? 'نوع الحدث (المادة)' : 'نوع الحدث (اختياري)'}
            hint="اختار من الاقتراحات أو اكتب نوع جديد، وهيتضاف للقايمة للمرات الجاية"
            error={errors.subject?.message}
          >
            <Input {...register('subject')} list={listId} autoComplete="off" placeholder={subjectNeeded ? 'مثلاً: رياضيات' : 'مثلاً: ورشة إسعافات أولية'} />
            <datalist id={listId}>
              {subjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        )
      )}
      <Field label="المكان">
        <Select {...register('place')} placeholder="—" options={lookups.data?.list('المكان') ?? []} />
      </Field>
      {subjectNeeded && !classEvent && (
        <Field label="السنة الدراسية" error={errors.grade?.message}>
          <Select {...register('grade')} placeholder="اختار..." options={grades} />
        </Field>
      )}
      {classEvent && (
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

/** Pick several values from a list (and type new ones when allowNew). Value is «a، b». */
function MultiPick({ value, onChange, options, placeholder, allowNew }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string; allowNew?: boolean }) {
  const chosen = splitMulti(value)
  const [text, setText] = useState('')
  const add = (x: string) => {
    const t = x.trim()
    if (!t) return
    onChange(joinMulti([...chosen, t]))
    setText('')
  }
  const left = options.filter((o) => !chosen.includes(o))
  return (
    <div className="space-y-2">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 ps-2.5 pe-1 text-sm font-semibold text-brand-800">
              {c}
              <button type="button" onClick={() => onChange(joinMulti(chosen.filter((x) => x !== c)))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`شيل ${c}`}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {allowNew ? (
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add(text)
              }
            }}
            list={`mp-${placeholder}`}
            autoComplete="off"
            placeholder={placeholder}
          />
          <datalist id={`mp-${placeholder}`}>
            {left.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <button type="button" onClick={() => add(text)} className="grid size-10 shrink-0 place-items-center rounded-xl border border-line text-brand-700 hover:bg-surface" aria-label="إضافة">
            <Plus className="size-4" />
          </button>
        </div>
      ) : (
        <Select value="" onChange={(e) => add(e.target.value)} placeholder={placeholder} options={left} />
      )}
    </div>
  )
}

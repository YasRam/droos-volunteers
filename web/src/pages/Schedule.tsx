import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtTime, useDirectory, useLookups } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { WEEKDAYS, type ScheduleSlot, type Weekday } from '@/lib/types'

type View = 'day' | 'grade' | 'teacher'

export default function Schedule() {
  const p = usePermissions()
  const lookups = useLookups()
  const [view, setView] = useState<View>('day')
  const [day, setDay] = useState('')
  const [grade, setGrade] = useState('')
  const [teacher, setTeacher] = useState('')
  const [editing, setEditing] = useState<ScheduleSlot | 'new' | null>(null)

  const q = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_slots').select('*').order('starts_at')
      if (error) throw error
      return (data as ScheduleSlot[]).sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.starts_at.localeCompare(b.starts_at))
    },
  })

  const rows = (q.data ?? []).filter(
    (s) => (!day || s.day === day) && (!grade || s.grade === grade) && (!teacher || (s.teacher_name ?? '').includes(teacher)),
  )
  const groups = useMemo(() => {
    const key = (s: ScheduleSlot) => (view === 'day' ? s.day : view === 'grade' ? s.grade : s.teacher_name || 'من غير مدرس')
    const m = new Map<string, ScheduleSlot[]>()
    for (const s of rows) m.set(key(s), [...(m.get(key(s)) ?? []), s])
    const entries = [...m.entries()]
    if (view === 'day') entries.sort((a, b) => WEEKDAYS.indexOf(a[0] as Weekday) - WEEKDAYS.indexOf(b[0] as Weekday))
    else entries.sort((a, b) => a[0].localeCompare(b[0], 'ar'))
    return entries
  }, [rows, view])

  const mine = (s: ScheduleSlot) => Boolean(p.volunteerId && s.volunteer_id === p.volunteerId)

  return (
    <>
      <PageHeader
        title="جدول الحصص"
        subtitle={q.data ? `${q.data.length} حصة في الأسبوع` : undefined}
        actions={
          p.canEditSchedule && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> حصة جديدة
            </Button>
          )
        }
      />
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: 'day', label: 'حسب اليوم' },
          { value: 'grade', label: 'حسب السنة' },
          { value: 'teacher', label: 'حسب المتطوع' },
        ]}
      />
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Select value={day} onChange={(e) => setDay(e.target.value)} placeholder="كل الأيام" options={WEEKDAYS} />
        <Select value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="كل السنين" options={lookups.data?.list('السنة الدراسية') ?? []} />
        <Input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="اسم المتطوع" />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !groups.length ? (
        <Empty title="مفيش حصص" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(([title, slots]) => (
            <Card key={title} className="p-0">
              <p className="border-b border-line px-4 py-2 font-bold text-brand-800">{title}</p>
              <div className="divide-y divide-line">
                {slots.map((s) => (
                  <div key={s.id} className={clsx('flex items-center gap-3 px-4 py-2.5', mine(s) && 'bg-brand-50')}>
                    <span className="ltr w-24 shrink-0 text-xs font-semibold text-muted">
                      {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={clsx('truncate text-sm font-semibold', mine(s) && 'text-brand-800')}>
                        {s.subject} · {view === 'grade' ? s.day : s.grade}
                      </p>
                      <p className={clsx('truncate text-xs', s.teacher_name ? 'text-muted' : 'italic text-gray-400')}>
                        {view === 'teacher' ? s.day : s.teacher_name || 'من غير مدرس'}
                        {mine(s) && ' · حصتك'}
                      </p>
                    </div>
                    {p.canEditSchedule && (
                      <button onClick={() => setEditing(s)} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="تعديل">
                        <Pencil className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <SlotForm slot={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SlotForm({ slot, onClose }: { slot: ScheduleSlot | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lookups = useLookups()
  const dir = useDirectory()
  const form = useForm({
    defaultValues: {
      day: slot?.day ?? 'السبت',
      grade: slot?.grade ?? '',
      subject: slot?.subject ?? '',
      volunteer_id: slot?.volunteer_id ?? '',
      teacher_name: slot?.teacher_name ?? '',
      starts_at: slot ? fmtTime(slot.starts_at) : '15:00',
      ends_at: slot ? fmtTime(slot.ends_at) : '16:00',
    },
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedule'] })
  const save = useMutation({
    mutationFn: async (f: Parameters<Parameters<typeof form.handleSubmit>[0]>[0]) => {
      if (!f.grade || !f.subject) throw { message: 'اختار السنة والمادة' }
      if (f.ends_at <= f.starts_at) throw { message: 'وقت النهاية لازم يكون بعد البداية' }
      const teacher = f.volunteer_id ? dir.data?.find((v) => v.id === f.volunteer_id)?.full_name_ar : f.teacher_name
      const payload = { ...f, volunteer_id: f.volunteer_id || null, teacher_name: teacher || null }
      const { error } = slot ? await supabase.from('schedule_slots').update(payload).eq('id', slot.id) : await supabase.from('schedule_slots').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      invalidate()
      onClose()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('schedule_slots').delete().eq('id', slot!.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الحصة اتمسحت')
      invalidate()
      onClose()
    },
    onError: toastError,
  })
  const subjects = [...new Set(lookups.data?.list('نوع الحدث', 'تدريس') ?? [])]
  return (
    <Modal open onClose={onClose} title={slot ? 'تعديل حصة' : 'حصة جديدة'}>
      <form onSubmit={form.handleSubmit((f) => save.mutate(f))} className="grid gap-4 sm:grid-cols-2">
        <Field label="اليوم">
          <Select {...form.register('day')} options={WEEKDAYS} />
        </Field>
        <Field label="السنة الدراسية">
          <Select {...form.register('grade')} placeholder="اختار..." options={lookups.data?.list('السنة الدراسية') ?? []} />
        </Field>
        <Field label="المادة">
          <Input {...form.register('subject')} list="subjects" />
          <datalist id="subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="المتطوع">
          <Select {...form.register('volunteer_id')} placeholder="— مش متطوع —" options={(dir.data ?? []).map((v) => ({ value: v.id, label: v.full_name_ar }))} />
        </Field>
        {!form.watch('volunteer_id') && (
          <div className="sm:col-span-2">
            <Field label="اسم المدرس" hint="لو المدرس مش متطوع في النشاط">
              <Input {...form.register('teacher_name')} />
            </Field>
          </div>
        )}
        <Field label="من">
          <Input type="time" {...form.register('starts_at')} />
        </Field>
        <Field label="إلى">
          <Input type="time" {...form.register('ends_at')} />
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" className="flex-1" loading={save.isPending}>
            حفظ
          </Button>
          {slot && (
            <Button type="button" variant="secondary" className="text-red-600" loading={remove.isPending} onClick={() => confirm('مسح الحصة دي؟') && remove.mutate()}>
              مسح
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Field, Modal, Select, Spinner, Textarea } from '@/components/ui'
import { cairoToday, fmtDate, fmtTime } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { WEEKDAYS, type ScheduleSlot } from '@/lib/types'

export interface Absence {
  id: string
  slot_id: string
  on_date: string
  volunteer_id: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

/** The next dates of a class after today (an excuse can't be for today). */
export function nextDates(day: string, count = 4) {
  const out: string[] = []
  const start = new Date(`${cairoToday()}T12:00:00Z`)
  for (let i = 1; out.length < count && i < 40; i++) {
    const d = new Date(start.getTime() + i * 864e5)
    // Saturday = 0 in our list; JS Sunday = 0
    if (WEEKDAYS[(d.getUTCDay() + 1) % 7] === day) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Absences coming up (next two weeks), for badges on the schedule. */
export function useUpcomingAbsences() {
  return useQuery({
    queryKey: ['class-absences', 'upcoming'],
    queryFn: async () => {
      const today = cairoToday()
      const { data, error } = await supabase.from('class_absences').select('*').gte('on_date', today).neq('status', 'rejected').order('on_date')
      if (error) throw error
      return data as Absence[]
    },
  })
}

export function AbsenceModal({ slot, date, onClose }: { slot: ScheduleSlot; date?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const dates = nextDates(slot.day)
  const [day, setDay] = useState(date && dates.includes(date) ? date : dates[0])
  const [reason, setReason] = useState('')
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('request_absence', { p_slot: slot.id, p_date: day, p_reason: reason })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اعتذارك وصل للتنظيم، وهيوصلك ردهم')
      qc.invalidateQueries({ queryKey: ['class-absences'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="اعتذار عن حصة">
      <div className="space-y-3">
        <p className="text-sm">
          <b>{slot.subject}</b> · {slot.grade} · {slot.day} {fmtTime(slot.starts_at)}
        </p>
        <Field label="يوم">
          <Select value={day} onChange={(e) => setDay(e.target.value)} options={dates.map((d) => ({ value: d, label: fmtDate(d) }))} />
        </Field>
        <Field label="السبب">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: عندي امتحان" />
        </Field>
        <p className="text-xs text-muted">الاعتذار لازم يكون قبل يوم الحصة. في نفس اليوم كلّم التنظيم على طول.</p>
        <Button className="w-full" loading={send.isPending} onClick={() => send.mutate()}>
          ابعت الاعتذار
        </Button>
      </div>
    </Modal>
  )
}

/** Organizers: excuses waiting for a decision. */
export function AbsenceRequests() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['class-absences', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_absences')
        .select('*, slot:schedule_slots(subject, grade, day, starts_at, place), volunteer:volunteers(full_name_ar)')
        .eq('status', 'pending')
        .order('on_date')
      if (error) throw error
      return data as (Absence & { slot: Pick<ScheduleSlot, 'subject' | 'grade' | 'day' | 'starts_at' | 'place'>; volunteer: { full_name_ar: string } })[]
    },
  })
  const review = useMutation({
    mutationFn: async (a: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_absence', { p_id: a.id, p_approve: a.approve })
      if (error) throw error
      return a.approve
    },
    onSuccess: (ok) => {
      toast.success(ok ? 'اتقبل، واتبعت إشعار للمدرس واللي معاه في الحصة' : 'اترفض، واتبعت إشعار للمدرس')
      qc.invalidateQueries({ queryKey: ['class-absences'] })
      qc.invalidateQueries({ queryKey: ['pending-count'] })
    },
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="مفيش اعتذارات مستنية">لما مدرس يعتذر عن حصة، طلبه بيظهر هنا.</Empty>
  return (
    <div className="space-y-3">
      {q.data.map((a) => (
        <Card key={a.id} className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              <VolunteerName id={a.volunteer_id} name={a.volunteer.full_name_ar} />
            </p>
            <p className="text-sm">
              {a.slot.subject} · {a.slot.grade} · {fmtDate(a.on_date)} {fmtTime(a.slot.starts_at)}
              {a.slot.place ? ` · ${a.slot.place}` : ''}
            </p>
            {a.reason && <p className="text-sm text-muted">السبب: {a.reason}</p>}
          </div>
          <Badge tone="orange">مستني</Badge>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, approve: false })}>
              رفض
            </Button>
            <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, approve: true })}>
              موافقة
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}

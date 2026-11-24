import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { VolunteerChips, VolunteerSelect } from '@/components/VolunteerPick'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { cairoToday, fmtDate, useLookups, useVolunteers } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type Meeting = {
  id: string
  meeting_date: string
  committee: string
  head_id: string | null
  head_name: string | null
  head_role: string | null
  meeting_type: string
  goal: string | null
  achievements: string | null
  minutes_link: string | null
  attendees_extra: number
}

const TYPES = ['الفرع', 'اونلاين', 'اوفلاين']

export function useMeetings(month: string) {
  return useQuery({
    queryKey: ['meetings', month],
    queryFn: async () => {
      const next = new Date(month + '-01T00:00:00Z')
      next.setUTCMonth(next.getUTCMonth() + 1)
      const [m, a] = await Promise.all([
        supabase.from('meetings').select('*').gte('meeting_date', month + '-01').lt('meeting_date', next.toISOString().slice(0, 10)).order('meeting_date', { ascending: false }),
        supabase.from('participations').select('meeting_id, volunteer_id').not('meeting_id', 'is', null),
      ])
      if (m.error) throw m.error
      if (a.error) throw a.error
      const attendees = new Map<string, string[]>()
      for (const r of a.data as { meeting_id: string; volunteer_id: string }[]) attendees.set(r.meeting_id, [...(attendees.get(r.meeting_id) ?? []), r.volunteer_id])
      return (m.data as Meeting[]).map((x) => ({ ...x, attendees: attendees.get(x.id) ?? [] }))
    },
  })
}

/** Meetings of a month: who held it, why, what came out of it, who attended. */
export default function Meetings() {
  const [month, setMonth] = useState(cairoToday().slice(0, 7))
  const [editing, setEditing] = useState<(Meeting & { attendees: string[] }) | 'new' | null>(null)
  const q = useMeetings(month)
  const vols = useVolunteers()
  const name = (id: string | null) => (id ? vols.data?.find((v) => v.id === id)?.full_name_ar : null)
  return (
    <>
      <PageHeader
        title="الاجتماعات"
        subtitle="كل اجتماع بيتسجل مرة واحدة، والحاضرين بيتحسبلهم مشاركة. بيطلع في شيت الاجتماعات."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> اجتماع جديد
          </Button>
        }
      />
      <Card className="mb-4 max-w-xs">
        <Field label="الشهر">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="مفيش اجتماعات في الشهر ده" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {q.data.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{m.committee}</p>
                  <p className="text-xs text-muted">
                    {fmtDate(m.meeting_date)} · {m.meeting_type}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label="تعديل" title="تعديل">
                  <Pencil className="size-4" />
                </Button>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div>
                  <dt className="inline text-muted">الهيد: </dt>
                  <dd className="inline font-semibold">
                    {name(m.head_id) ?? m.head_name ?? '—'}
                    {m.head_role ? ` (${m.head_role})` : ''}
                  </dd>
                </div>
                {m.goal && (
                  <div>
                    <dt className="inline text-muted">الهدف: </dt>
                    <dd className="inline">{m.goal}</dd>
                  </div>
                )}
                {m.achievements && (
                  <div>
                    <dt className="inline text-muted">الإنجازات: </dt>
                    <dd className="inline">{m.achievements}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="brand">
                  <Users className="me-1 inline size-3.5" />
                  {m.attendees.length + m.attendees_extra} حاضر
                </Badge>
                {m.minutes_link && (
                  <a href={m.minutes_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700">
                    <ExternalLink className="size-3.5" /> المحضر
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <MeetingForm meeting={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function MeetingForm({ meeting, onClose }: { meeting: (Meeting & { attendees: string[] }) | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const p = usePermissions()
  const lookups = useLookups()
  const vols = useVolunteers()
  const committees = p.can('attendance.register') ? [...new Set(['فريق العمل', ...(lookups.data?.list('اللجنة') ?? [])])] : (me?.committees ?? [])
  const [f, setF] = useState({
    meeting_date: meeting?.meeting_date ?? cairoToday(),
    committee: meeting?.committee ?? (p.can('attendance.register') ? '' : (me?.committees?.[0] ?? '')),
    head_id: meeting?.head_id ?? me?.volunteer_id ?? null,
    head_name: meeting?.head_name ?? '',
    head_role: meeting?.head_role ?? '',
    meeting_type: meeting?.meeting_type ?? 'الفرع',
    goal: meeting?.goal ?? '',
    achievements: meeting?.achievements ?? '',
    minutes_link: meeting?.minutes_link ?? '',
    attendees_extra: String(meeting?.attendees_extra ?? 0),
  })
  const [attendees, setAttendees] = useState<string[]>(meeting?.attendees ?? [])
  const headRole = f.head_role || (f.head_id ? vols.data?.find((v) => v.id === f.head_id)?.position : '') || ''
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['meetings'] })
    qc.invalidateQueries({ queryKey: ['followups'] })
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!f.committee) throw { message: 'اختار اللجنة' }
      const { error } = await supabase.rpc('save_meeting', {
        p: { ...f, id: meeting?.id ?? '', head_role: headRole, attendees_extra: Number(f.attendees_extra) || 0 },
        p_attendees: attendees,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الاجتماع اتسجل')
      refresh()
      onClose()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('meetings').delete().eq('id', meeting!.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الاجتماع اتمسح')
      refresh()
      onClose()
    },
    onError: toastError,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open onClose={onClose} title={meeting ? 'تعديل اجتماع' : 'اجتماع جديد'}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="التاريخ">
            <Input type="date" value={f.meeting_date} onChange={set('meeting_date')} />
          </Field>
          <Field label="اللجنة">
            <Select value={f.committee} onChange={set('committee')} placeholder="اختار..." options={committees} />
          </Field>
          <Field label="نوع الاجتماع">
            <Select value={f.meeting_type} onChange={set('meeting_type')} options={TYPES} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="هيد الاجتماع">
            <VolunteerSelect value={f.head_id} onChange={(id) => setF({ ...f, head_id: id, head_role: '' })} />
          </Field>
          <Field label="دوره في الهيكل" hint="بيتحط من وظيفته لوحده، وتقدر تغيّره">
            <Input value={headRole} onChange={set('head_role')} placeholder="مثلاً: ليدر لجنة" />
          </Field>
        </div>
        <Field label="الهدف من الاجتماع">
          <Textarea value={f.goal} onChange={set('goal')} rows={2} />
        </Field>
        <Field label="إنجازات اللجنة">
          <Textarea value={f.achievements} onChange={set('achievements')} rows={2} />
        </Field>
        <Field label="الحاضرين" hint="كل واحد هنا بتتحسبله مشاركة «اجتماع» في اليوم ده">
          <VolunteerChips value={attendees} onChange={setAttendees} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="حاضرين تانيين (مش متطوعين)">
            <Input type="number" min={0} value={f.attendees_extra} onChange={set('attendees_extra')} />
          </Field>
          <Field label="لينك المحضر (اختياري)">
            <Input value={f.minutes_link} onChange={set('minutes_link')} dir="ltr" placeholder="https://drive.google.com/..." />
          </Field>
        </div>
        <p className="text-sm text-muted">إجمالي الحاضرين: {attendees.length + (Number(f.attendees_extra) || 0)}</p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => save.mutate()} loading={save.isPending}>
            حفظ
          </Button>
          {meeting && (
            <Button variant="secondary" className="text-red-600" loading={remove.isPending} onClick={() => confirm('مسح الاجتماع ده ومشاركات الحاضرين فيه؟') && remove.mutate()}>
              <Trash2 className="size-4" /> مسح
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

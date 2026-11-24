import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, Pencil, Search, Trash2, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { MeetingForm } from './Meetings'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import ActivityFields, { activitySchema, checkActivity, eventForm, toActivityPayload, type ActivityValues } from '@/components/ActivityFields'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, RequestBadge, Select, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { addDays, cairoToday, fmtDate, fmtShort, useDirectory, useLookups } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Participation } from '@/lib/types'

const describe = (r: Participation) =>
  [r.event, r.subject, r.grade, r.duration_minutes ? `${r.beneficiaries ?? 1} مكالمة · ${r.duration_minutes} دقيقة` : r.beneficiaries ? `${r.beneficiaries} طالب` : null].filter(Boolean).join(' · ')

/** Participations in a period, grouped by person, each row editable. */
export default function FollowUps() {
  const p = usePermissions()
  const today = cairoToday()
  const lookups = useLookups()
  const dir = useDirectory()
  const anyDate = p.can('attendance.view_all')
  const [from, setFrom] = useState(addDays(today, -7))
  const [to, setTo] = useState(today)
  const [event, setEvent] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Participation | null>(null)
  const [groupForm, setGroupForm] = useState(false)
  const [view, setView] = useState<'person' | 'day'>('person')
  const navigate = useNavigate()

  const q = useQuery({
    queryKey: ['followups', from, to, event, status],
    queryFn: async () => {
      let query = supabase.from('participations').select('*').gte('activity_date', from).lte('activity_date', to).order('activity_date', { ascending: false }).limit(3000)
      if (event) query = query.eq('event', event)
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw error
      return data as Participation[]
    },
  })
  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])

  const people = useMemo(() => {
    const m = new Map<string, Participation[]>()
    for (const r of q.data ?? []) m.set(r.volunteer_id, [...(m.get(r.volunteer_id) ?? []), r])
    const s = search.trim()
    return [...m.entries()]
      .map(([id, rows]) => ({ id, name: names.get(id) ?? '—', rows, days: new Set(rows.filter((r) => r.status === 'accepted').map((r) => r.activity_date)).size }))
      .filter((x) => !s || x.name.includes(s))
      .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, 'ar'))
  }, [q.data, names, search])

  const total = q.data?.length ?? 0
  // Meetings and family days: one line each, with how many attended
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; date: string; event: string; subject: string; count: number }>()
    for (const r of q.data ?? []) {
      if (!r.meeting_id) continue
      const g = m.get(r.meeting_id) ?? { id: r.meeting_id, date: r.activity_date, event: r.event, subject: r.subject ?? '', count: 0 }
      g.count++
      m.set(r.meeting_id, g)
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [q.data])
  return (
    <>
      <PageHeader
        title="المتابعة اليومية"
        subtitle={`${people.length} متطوع · ${total} مشاركة${anyDate ? '' : ' · آخر 7 أيام'}`}
        actions={
          <Button variant="secondary" onClick={() => setGroupForm(true)}>
            <Users className="size-4" /> اجتماع / يوم عائلي
          </Button>
        }
      />
      {groups.length > 0 && (
        <Card className="mb-4 p-0">
          <p className="border-b border-line px-4 py-2 text-sm font-bold">الأنشطة الجماعية في الفترة دي</p>
          <div className="divide-y divide-line">
            {groups.map((g) => (
              <button key={g.id} onClick={() => navigate(`/meetings?edit=${g.id}`)} className="flex w-full items-center gap-2 px-4 py-2 text-start text-sm hover:bg-surface">
                <span className="w-14 shrink-0 text-xs font-semibold text-muted">{fmtShort(g.date)}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {g.event} · {g.subject}
                </span>
                <Badge tone="brand">{g.count} حاضر</Badge>
                <Pencil className="size-4 text-muted" />
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Field label="من">
          <Input type="date" value={from} min={anyDate ? undefined : addDays(today, -7)} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="إلى">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="الحدث">
          <Select value={event} onChange={(e) => setEvent(e.target.value)} placeholder="الكل" options={lookups.data?.list('الحدث') ?? []} />
        </Field>
        <Field label="الحالة">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="الكل"
            options={[
              { value: 'accepted', label: 'مقبول' },
              { value: 'pending', label: 'مستني موافقة' },
              { value: 'rejected', label: 'مرفوض' },
            ]}
          />
        </Field>
        <div className="col-span-2 lg:col-span-1">
          <Field label="اسم">
            <div className="relative">
              <Search className="absolute start-3 top-2.5 size-5 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="ps-10" />
            </div>
          </Field>
        </div>
      </Card>
      <Tabs
        value={view}
        onChange={(v) => setView(v as 'person' | 'day')}
        tabs={[
          { value: 'person', label: 'بالمتطوع' },
          { value: 'day', label: 'باليوم' },
        ]}
      />
      {view === 'day' && !q.isLoading ? (
        <ByDay rows={(q.data ?? []).filter((r) => !search.trim() || (names.get(r.volunteer_id) ?? '').includes(search.trim()))} names={names} onEdit={setEditing} />
      ) : q.isLoading ? (
        <Spinner />
      ) : !people.length ? (
        <Empty title="مفيش مشاركات في الفترة دي" />
      ) : (
        <div className="space-y-2">
          {people.map((x) => (
            <PersonRows key={x.id} id={x.id} name={x.name} rows={x.rows} days={x.days} onEdit={setEditing} canDelete={p.can('attendance.delete')} />
          ))}
        </div>
      )}
      {groupForm && <MeetingForm meeting={null} onClose={() => setGroupForm(false)} />}
      {editing && <EditParticipation row={editing} name={names.get(editing.volunteer_id)} rowsKind={lookups.data?.rows} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Same participations, one card per day (newest first); group activities stay one line. */
function ByDay({ rows, names, onEdit }: { rows: Participation[]; names: Map<string, string>; onEdit: (r: Participation) => void }) {
  const navigate = useNavigate()
  const days = useMemo(() => {
    const m = new Map<string, Participation[]>()
    for (const r of rows) m.set(r.activity_date, [...(m.get(r.activity_date) ?? []), r])
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])
  if (!days.length) return <Empty title="مفيش مشاركات في الفترة دي" />
  return (
    <div className="space-y-3">
      {days.map(([day, list]) => {
        const groups = new Map<string, Participation[]>()
        const singles = list.filter((r) => {
          if (!r.meeting_id) return true
          groups.set(r.meeting_id, [...(groups.get(r.meeting_id) ?? []), r])
          return false
        })
        return (
          <Card key={day} className="p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <p className="font-bold">{fmtDate(day)}</p>
              <span className="text-xs text-muted">
                {new Set(list.map((r) => r.volunteer_id)).size} متطوع · {list.length} مشاركة
              </span>
            </div>
            <div className="divide-y divide-line">
              {[...groups.entries()].map(([id, g]) => (
                <button key={id} onClick={() => navigate(`/meetings?edit=${id}`)} className="flex w-full items-center gap-2 px-4 py-2 text-start text-sm hover:bg-surface">
                  <Badge tone="brand">جماعي</Badge>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {g[0].event} · {g[0].subject}
                  </span>
                  <span className="text-xs text-muted">{g.length} حاضر</span>
                  <Pencil className="size-4 text-muted" />
                </button>
              ))}
              {singles.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <VolunteerName id={r.volunteer_id} name={names.get(r.volunteer_id) ?? '—'} className="w-40 shrink-0 truncate font-semibold" />
                  <p className="min-w-0 flex-1 truncate text-muted">{describe(r)}</p>
                  <RequestBadge status={r.status} />
                  <Button variant="ghost" size="sm" onClick={() => onEdit(r)} aria-label="تعديل" title="تعديل">
                    <Pencil className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function PersonRows({
  id,
  name,
  rows,
  days,
  onEdit,
  canDelete,
}: {
  id: string
  name: string
  rows: Participation[]
  days: number
  onEdit: (r: Participation) => void
  canDelete: boolean
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(rows.length <= 2)
  const remove = useMutation({
    mutationFn: async (rid: string) => {
      const { error } = await supabase.from('participations').delete().eq('id', rid)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتمسحت')
      qc.invalidateQueries({ queryKey: ['followups'] })
    },
    onError: toastError,
  })
  const pending = rows.filter((r) => r.status === 'pending').length
  return (
    <Card className="p-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <VolunteerName id={id} name={name} className="block truncate font-bold" />
          <p className="text-xs text-muted">
            {rows.length} مشاركة · {days} يوم
          </p>
        </div>
        {pending > 0 && <Badge tone="orange">{pending} مستني</Badge>}
        <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label={open ? 'اقفل' : 'افتح'}>
          <ChevronDown className={clsx('size-5 transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="divide-y divide-line border-t border-line">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-4 py-2">
              <span className="w-14 shrink-0 text-xs font-semibold text-muted">{fmtShort(r.activity_date)}</span>
              <p className="min-w-0 flex-1 truncate text-sm">
                {describe(r)}
                {r.method === 'group' && <span className="text-xs text-muted"> · جماعي</span>}
              </p>
              {r.meeting_id ? <Badge tone="brand">جماعي</Badge> : <RequestBadge status={r.status} />}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (r.meeting_id ? navigate(`/meetings?edit=${r.meeting_id}`) : onEdit(r))}
                aria-label="تعديل"
                title={r.meeting_id ? 'تعديل النشاط الجماعي' : 'تعديل'}
              >
                <Pencil className="size-4" />
              </Button>
              {canDelete && !r.meeting_id && (
                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm('مسح المشاركة دي؟') && remove.mutate(r.id)} aria-label="مسح" title="مسح">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function EditParticipation({ row, name, rowsKind, onClose }: { row: Participation; name?: string; rowsKind?: Parameters<typeof eventForm>[0]; onClose: () => void }) {
  const qc = useQueryClient()
  const p = usePermissions()
  const today = cairoToday()
  const form = useForm<ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      activity_date: row.activity_date,
      event: row.event,
      subject: row.subject ?? '',
      grade: row.grade ?? '',
      place: row.place ?? '',
      beneficiaries: row.beneficiaries ? String(row.beneficiaries) : '',
      duration_minutes: row.duration_minutes ? String(row.duration_minutes) : '',
      notes: row.notes ?? '',
    },
  })
  const [status, setStatus] = useState(row.status)
  const save = useMutation({
    mutationFn: async (v: ActivityValues) => {
      const payload = { ...toActivityPayload(v, eventForm(rowsKind, v.event)), ...(p.canReview ? { status } : {}) }
      const { error } = await supabase.from('participations').update(payload).eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتعدّلت')
      qc.invalidateQueries({ queryKey: ['followups'] })
      qc.invalidateQueries({ queryKey: ['pending'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`تعديل مشاركة · ${name ?? ''}`}>
      <form onSubmit={form.handleSubmit((v) => checkActivity(form, rowsKind) && save.mutate(v))} className="space-y-4">
        <ActivityFields form={form} dateMin={p.can('attendance.any_date') ? undefined : addDays(today, -7)} dateMax={today} />
        {p.canReview && (
          <Field label="الحالة">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as Participation['status'])}
              options={[
                { value: 'accepted', label: 'مقبول' },
                { value: 'pending', label: 'مستني موافقة' },
                { value: 'rejected', label: 'مرفوض' },
              ]}
            />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={save.isPending}>
          حفظ التعديل
        </Button>
      </form>
    </Modal>
  )
}

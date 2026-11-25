import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { VolunteerChips, VolunteerSelect } from '@/components/VolunteerPick'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { cairoToday, fmtDate, useLookups, useVolunteers } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useJobs } from '@/lib/jobs'

export type Meeting = {
  id: string
  event: string
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
export const FAMILY_DAY = 'يوم عائلي'
const PHOTO_BUCKET = 'activity-photos'
const needsPhotos = (event: string, type: string) => event === FAMILY_DAY || type === 'اونلاين'

type Photo = { id: string; path: string; url: string | null }
function usePhotos(meetingId: string | undefined) {
  return useQuery({
    queryKey: ['meeting-photos', meetingId],
    enabled: Boolean(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase.from('meeting_photos').select('id, path').eq('meeting_id', meetingId!).order('created_at')
      if (error) throw error
      const rows = data as { id: string; path: string }[]
      if (!rows.length) return [] as Photo[]
      const signed = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map((r) => r.path), 3600)
      return rows.map((r, i) => ({ ...r, url: signed.data?.[i]?.signedUrl ?? null }))
    },
  })
}

/** Fetch one group activity with its attendees (to open it from the daily follow-up). */
export async function loadMeeting(id: string) {
  const [m, a] = await Promise.all([
    supabase.from('meetings').select('*').eq('id', id).single(),
    supabase.from('participations').select('volunteer_id').eq('meeting_id', id),
  ])
  if (m.error) throw m.error
  return { ...(m.data as Meeting), attendees: (a.data ?? []).map((r: { volunteer_id: string }) => r.volunteer_id) }
}

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
function perCommittee(rows: Meeting[]): [string, number, number][] {
  const m = new Map<string, [number, number]>()
  for (const r of rows) {
    const x = m.get(r.committee) ?? [0, 0]
    if (r.event === FAMILY_DAY) x[1]++
    else x[0]++
    m.set(r.committee, x)
  }
  return [...m.entries()].map(([c, [n, f]]) => [c, n, f] as [string, number, number]).sort((a, b) => b[1] - a[1])
}

export default function Meetings() {
  const [month, setMonth] = useState(cairoToday().slice(0, 7))
  const [editing, setEditing] = useState<(Meeting & { attendees: string[] }) | 'new' | null>(null)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('edit')
    if (!id) return
    setParams({}, { replace: true })
    loadMeeting(id).then(setEditing).catch(toastError)
  }, [params, setParams])
  const q = useMeetings(month)
  const vols = useVolunteers()
  const name = (id: string | null) => (id ? vols.data?.find((v) => v.id === id)?.full_name_ar : null)
  return (
    <>
      <PageHeader
        title="الاجتماعات والأيام العائلية"
        subtitle="بتتسجل مرة واحدة بالحاضرين، وبتظهر في المتابعة اليومية مجمّعة. الاجتماع الأونلاين واليوم العائلي بيترفع معاهم صور."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> جديد
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Card className="w-full max-w-xs">
          <Field label="الشهر">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
        </Card>
        {Boolean(q.data?.length) && (
          <Card className="min-w-0 flex-1">
            <p className="mb-2 text-sm font-bold">عدد الاجتماعات لكل لجنة</p>
            <div className="flex flex-wrap gap-2">
              {perCommittee(q.data!).map(([c, n, f]) => (
                <Badge key={c} tone="brand">
                  {c}: {n} اجتماع{f ? ` · ${f} يوم عائلي` : ''}
                </Badge>
              ))}
            </div>
          </Card>
        )}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="مفيش اجتماعات ولا أيام عائلية في الشهر ده" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {q.data.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">
                    {m.event === FAMILY_DAY ? 'يوم عائلي' : 'اجتماع'} · {m.committee}
                  </p>
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

export function MeetingForm({ meeting, onClose }: { meeting: (Meeting & { attendees: string[] }) | null; onClose: () => void }) {
  const { jobOf } = useJobs()
  const qc = useQueryClient()
  const { me } = useAuth()
  const p = usePermissions()
  const lookups = useLookups()
  const vols = useVolunteers()
  const committees = p.can('meetings.manage') ? [...new Set(['فريق العمل', ...(lookups.data?.list('اللجنة') ?? [])])] : (me?.committees ?? [])
  const [f, setF] = useState({
    event: meeting?.event ?? 'أجتماع',
    meeting_date: meeting?.meeting_date ?? cairoToday(),
    committee: meeting?.committee ?? (p.can('meetings.manage') ? '' : (me?.committees?.[0] ?? '')),
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
  const photos = usePhotos(meeting?.id)
  const [files, setFiles] = useState<File[]>([])
  const isFamily = f.event === FAMILY_DAY
  const headRole = f.head_role || (f.head_id ? jobOf(vols.data?.find((v) => v.id === f.head_id)) : '') || ''
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['meetings'] })
    qc.invalidateQueries({ queryKey: ['followups'] })
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!f.committee) throw { message: 'اختار اللجنة' }
      if (needsPhotos(f.event, f.meeting_type) && !files.length && !photos.data?.length)
        throw { message: isFamily ? 'اليوم العائلي محتاج صورة واحدة على الأقل' : 'الاجتماع الأونلاين محتاج صورة واحدة على الأقل' }
      const big = files.find((x) => x.size > 8 * 1024 * 1024)
      if (big) throw { message: `الصورة ${big.name} أكبر من 8 ميجا` }
      const { data, error } = await supabase.rpc('save_meeting', {
        p: { ...f, id: meeting?.id ?? '', head_role: headRole, attendees_extra: Number(f.attendees_extra) || 0 },
        p_attendees: attendees,
      })
      if (error) throw error
      const id = data as string
      for (const [i, file] of files.entries()) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${id}/${Date.now()}-${i}.${ext}`
        const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
        if (up.error) throw up.error
        const ins = await supabase.from('meeting_photos').insert({ meeting_id: id, path })
        if (ins.error) throw ins.error
      }
    },
    onSuccess: () => {
      toast.success(isFamily ? 'اليوم العائلي اتسجل' : 'الاجتماع اتسجل')
      qc.invalidateQueries({ queryKey: ['meeting-photos'] })
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
    <Modal open onClose={onClose} title={meeting ? (isFamily ? 'تعديل يوم عائلي' : 'تعديل اجتماع') : isFamily ? 'يوم عائلي جديد' : 'اجتماع جديد'}>
      <div className="space-y-4">
        <Tabs
          value={f.event === FAMILY_DAY ? 'family' : 'meeting'}
          onChange={(t) => setF({ ...f, event: t === 'family' ? FAMILY_DAY : 'أجتماع' })}
          tabs={[
            { value: 'meeting', label: 'اجتماع' },
            { value: 'family', label: 'يوم عائلي' },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="التاريخ">
            <Input type="date" value={f.meeting_date} onChange={set('meeting_date')} />
          </Field>
          <Field label="اللجنة">
            <Select value={f.committee} onChange={set('committee')} placeholder="اختار..." options={committees} />
          </Field>
          <Field label={isFamily ? 'المكان' : 'نوع الاجتماع'}>
            <Select value={f.meeting_type} onChange={set('meeting_type')} options={TYPES} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={isFamily ? 'المسئول عنه' : 'هيد الاجتماع'}>
            <VolunteerSelect value={f.head_id} onChange={(id) => setF({ ...f, head_id: id, head_role: '' })} />
          </Field>
          <Field label="دوره في الهيكل" hint="بيتحط من وظيفته لوحده، وتقدر تغيّره">
            <Input value={headRole} onChange={set('head_role')} placeholder="مثلاً: ليدر لجنة" />
          </Field>
        </div>
        <Field label={isFamily ? 'وصف اليوم' : 'الهدف من الاجتماع'}>
          <Textarea value={f.goal} onChange={set('goal')} rows={2} />
        </Field>
        {!isFamily && (
          <Field label="إنجازات اللجنة">
            <Textarea value={f.achievements} onChange={set('achievements')} rows={2} />
          </Field>
        )}
        <Field label="الحاضرين" hint="تقدر تزوّد أو تشيل في أي وقت. كل واحد هنا بتتحسبله مشاركة في اليوم ده">
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
        <Field
          label={needsPhotos(f.event, f.meeting_type) ? 'الصور (مطلوبة)' : 'الصور (اختياري)'}
          hint={needsPhotos(f.event, f.meeting_type) ? 'صورة واحدة على الأقل للاجتماع الأونلاين واليوم العائلي' : undefined}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
            className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800"
          />
          {files.length > 0 && <p className="mt-1 text-xs text-muted">{files.length} صورة جديدة هتترفع مع الحفظ</p>}
        </Field>
        {photos.data && photos.data.length > 0 && <PhotoGrid photos={photos.data} />}
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

function PhotoGrid({ photos }: { photos: Photo[] }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: async (ph: Photo) => {
      const a = await supabase.storage.from(PHOTO_BUCKET).remove([ph.path])
      if (a.error) throw a.error
      const b = await supabase.from('meeting_photos').delete().eq('id', ph.id)
      if (b.error) throw b.error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-photos'] }),
    onError: toastError,
  })
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((ph) => (
        <div key={ph.id} className="relative">
          {ph.url ? (
            <a href={ph.url} target="_blank" rel="noreferrer">
              <img src={ph.url} alt="" className="aspect-square w-full rounded-lg border border-line object-cover" />
            </a>
          ) : (
            <div className="aspect-square rounded-lg bg-surface" />
          )}
          <button
            type="button"
            onClick={() => confirm('تمسح الصورة دي؟') && del.mutate(ph)}
            className="absolute end-1 top-1 rounded-full bg-white/90 p-1 text-red-600 shadow"
            aria-label="مسح الصورة"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

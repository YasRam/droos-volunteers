import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BellRing, Pencil, Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Camp } from '@/components/StagesCard'
import { VolunteerName } from '@/components/VolunteerLink'
import { VolunteerSearch } from '@/components/VolunteerPick'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Tabs, Textarea } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { cairoToday, fmtDate, useVolunteers } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type CampStat = { camp_id: string; kind: string; camp_date: string; title: string | null; capacity: number | null; confirmed: number; waitlist: number; cancelled: number; attended: number }
type Reg = { camp_id: string; volunteer_id: string; status: 'confirmed' | 'waitlist' | 'cancelled'; attended: boolean; registered_at: string }

const STATUS_LABEL = { confirmed: 'جاي', waitlist: 'انتظار', cancelled: 'اعتذر' } as const

/** Camps and mini camps: dates, seats, waiting list, attendance, and who still needs one. */
export default function Camps() {
  const p = usePermissions()
  const manage = p.can('stages.manage')
  const vols = useVolunteers()
  const [editing, setEditing] = useState<Camp | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const camps = useQuery({
    queryKey: ['camps', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('camps').select('*').order('camp_date', { ascending: false })
      if (error) throw error
      return data as Camp[]
    },
  })
  const stats = useQuery({
    queryKey: ['camps', 'stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('camp_stats')
      if (error) throw error
      return new Map((data as CampStat[]).map((r) => [r.camp_id, r]))
    },
  })
  const [kind, setKind] = useState<'minicamp' | 'camp' | 'graduation'>('minicamp')
  const KIND_NAME = { minicamp: 'ميني كامب', camp: 'كامب', graduation: 'حفلة تخرج' } as const
  const did = (v: (typeof active)[number]) => (kind === 'minicamp' ? v.attended_minicamp : kind === 'camp' ? v.attended_camp : v.attended_graduation)
  const active = (vols.data ?? []).filter((v) => v.status !== 'خارج المتابعة')
  const attended = active.filter(did)
  const missing = active.filter((v) => !did(v))
  const [who, setWho] = useState('')
  const attendedAll = [...(vols.data ?? []).filter(did)].sort((a, b) => {
    const d = (v: typeof a) => (kind === 'minicamp' ? v.minicamp_date : kind === 'camp' ? v.camp_date : v.graduation_date) ?? ''
    return d(b).localeCompare(d(a)) || a.full_name_ar.localeCompare(b.full_name_ar, 'ar')
  })
  const allThree = active.filter((v) => v.attended_minicamp && v.attended_camp && v.attended_graduation).length
  const byMonth = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of vols.data ?? []) if (v.minicamp_date) m.set(v.minicamp_date.slice(0, 7), (m.get(v.minicamp_date.slice(0, 7)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8)
  }, [vols.data])

  return (
    <>
      <PageHeader
        title="الكامبات وحفلة التخرج"
        subtitle="الميني كامب والكامب وحفلة التخرج: المواعيد، والأماكن، وقايمة الانتظار، والحضور. بيتسجلوا عند المتطوع ومش في المتابعة اليومية، ولازم يحضرهم كلهم قبل ما يبقى «مسئول»."
        actions={
          manage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> ميعاد جديد
            </Button>
          )
        }
      />
      <Tabs
        value={kind}
        onChange={(k) => setKind(k as typeof kind)}
        tabs={[
          { value: 'minicamp', label: 'ميني كامب' },
          { value: 'camp', label: 'كامب' },
          { value: 'graduation', label: 'حفلة تخرج' },
        ]}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`حضروا ${KIND_NAME[kind]} (من المتابعين)`} value={`${attended.length} من ${active.length}`} tone="green" />
        <Stat label="النسبة" value={active.length ? `${Math.round((attended.length / active.length) * 100)}%` : '—'} />
        <Stat label="لسه محضروش" value={missing.length} tone="orange" />
        <Stat label="حضروا التلاتة (يقدروا يبقوا مسئولين)" value={allThree} />
      </div>
      {byMonth.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-bold">حضور الميني كامب حسب الشهر</p>
          <div className="flex flex-wrap gap-2">
            {byMonth.map(([m, n]) => (
              <Badge key={m} tone="brand">
                {m}: {n}
              </Badge>
            ))}
          </div>
        </Card>
      )}
      {camps.isLoading ? (
        <Spinner />
      ) : !camps.data?.length ? (
        <Empty title="لسه مفيش مواعيد" />
      ) : (
        <div className="space-y-3">
          {camps.data.map((c) => {
            const s = stats.data?.get(c.id)
            const past = c.camp_date < cairoToday()
            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">
                      {c.kind}
                      {c.title ? ` · ${c.title}` : ''} <span className="text-sm font-normal text-muted">· {fmtDate(c.camp_date)}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {c.place ?? ''} {c.capacity ? `· ${c.capacity} مكان` : '· من غير عدد'} {!c.registration_open && '· التسجيل مقفول'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="green">{s?.confirmed ?? 0} متأكد</Badge>
                    {Boolean(s?.waitlist) && <Badge tone="orange">{s?.waitlist} انتظار</Badge>}
                    {past && <Badge tone="brand">{s?.attended ?? 0} حضر</Badge>}
                    <Button variant="secondary" size="sm" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <Users className="size-4" /> الأسماء
                    </Button>
                    {manage && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label="تعديل" title="تعديل">
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {open === c.id && <Registrations camp={c} manage={manage} />}
              </Card>
            )
          })}
        </div>
      )}
      <Card className="mt-4 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <p className="text-sm font-bold">
            حضروا {KIND_NAME[kind]} ({attendedAll.length})
          </p>
          <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="دوّر بالاسم" className="h-9 w-48" />
        </div>
        <div className="max-h-96 divide-y divide-line overflow-y-auto">
          {attendedAll
            .filter((v) => !who.trim() || v.full_name_ar.includes(who.trim()))
            .map((v) => {
              const date = kind === 'minicamp' ? v.minicamp_date : kind === 'camp' ? v.camp_date : v.graduation_date
              return (
                <div key={v.id} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                  <VolunteerName id={v.id} name={v.full_name_ar} className="min-w-0 flex-1 truncate font-semibold" />
                  <span className="text-xs text-muted">{v.main_committee ?? ''}</span>
                  <span className="w-24 text-xs text-muted">{date ? fmtDate(date) : 'تاريخ مش متسجل'}</span>
                  {v.status === 'خارج المتابعة' && <Badge>خارج المتابعة</Badge>}
                </div>
              )
            })}
          {!attendedAll.length && <p className="px-4 py-3 text-sm text-muted">لسه محدش</p>}
        </div>
      </Card>
      {missing.length > 0 && (
        <Card className="mt-4">
          <p className="mb-2 text-sm font-bold">
            لسه محضروش {KIND_NAME[kind]} ({missing.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missing.slice(0, 60).map((v) => (
              <VolunteerName key={v.id} id={v.id} name={v.full_name_ar} className="rounded-full bg-surface px-2.5 py-1 text-xs" />
            ))}
            {missing.length > 60 && <span className="text-xs text-muted">و{missing.length - 60} كمان</span>}
          </div>
        </Card>
      )}
      {editing && <CampForm camp={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function Registrations({ camp, manage }: { camp: Camp; manage: boolean }) {
  const qc = useQueryClient()
  const vols = useVolunteers()
  const q = useQuery({
    queryKey: ['camps', 'regs', camp.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('camp_registrations').select('*').eq('camp_id', camp.id).order('registered_at')
      if (error) throw error
      return data as Reg[]
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['camps'] })
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn()
      if (error) throw error
    },
    onSuccess: refresh,
    onError: toastError,
  })
  const remind = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('remind_camp', { p_camp: camp.id })
      if (error) throw error
      return Number(data)
    },
    onSuccess: (n) => toast.success(`اتبعت تذكير لـ ${n} متطوع`),
    onError: toastError,
  })
  const name = (id: string) => vols.data?.find((v) => v.id === id)?.full_name_ar ?? '…'
  const rows = q.data ?? []
  const order = { confirmed: 0, waitlist: 1, cancelled: 2 }
  return (
    <div className="mt-3 border-t border-line pt-3">
      {manage && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="min-w-60 flex-1">
            <VolunteerSearch
              placeholder="ضيف متطوع"
              exclude={rows.filter((r) => r.status !== 'cancelled').map((r) => r.volunteer_id)}
              onPick={(v) => run.mutate(() => supabase.rpc('register_camp', { p_camp: camp.id, p_volunteer: v.id }))}
            />
          </div>
          {(
            <Button variant="secondary" size="sm" loading={remind.isPending} onClick={() => remind.mutate()}>
              <BellRing className="size-4" /> ابعت تذكير للي لسه محضروش
            </Button>
          )}
        </div>
      )}
      {manage && rows.length > 0 && (
        <p className="mb-2 text-xs text-muted">
          «جاي» يعني أكّد إنه هييجي. لو حد اعتذر بيفضل ظاهر هنا، وأول واحد في الانتظار بياخد مكانه لوحده. «حضر» علّمها يوم الكامب للي حضر فعلاً.
        </p>
      )}
      {q.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <p className="text-sm text-muted">لسه محدش سجّل</p>
      ) : (
        <div className="divide-y divide-line">
          {[...rows].sort((a, b) => order[a.status] - order[b.status]).map((r) => (
            <div key={r.volunteer_id} className={clsx('flex items-center gap-2 py-1.5 text-sm', r.status === 'cancelled' && 'opacity-50')}>
              <VolunteerName id={r.volunteer_id} name={name(r.volunteer_id)} className="min-w-0 flex-1 truncate font-semibold" />
              <Badge tone={r.status === 'confirmed' ? 'green' : r.status === 'waitlist' ? 'orange' : 'gray'}>{STATUS_LABEL[r.status]}</Badge>
              {manage && (
                <>
                  {r.status === 'cancelled' ? (
                    <Button variant="ghost" size="sm" onClick={() => run.mutate(() => supabase.rpc('register_camp', { p_camp: camp.id, p_volunteer: r.volunteer_id }))}>
                      رجّعه
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => run.mutate(() => supabase.rpc('cancel_camp', { p_camp: camp.id, p_volunteer: r.volunteer_id }))}>
                      اعتذر
                    </Button>
                  )}
                  <button
                    type="button"
                    disabled={run.isPending}
                    onClick={() => run.mutate(() => supabase.rpc('set_camp_attendance', { p_camp: camp.id, p_volunteer: r.volunteer_id, p_attended: !r.attended }))}
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-bold ring-1 transition disabled:opacity-50',
                      r.attended ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-muted ring-line hover:ring-emerald-400',
                    )}
                  >
                    {r.attended ? '✓ حضر' : 'حضر؟'}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CampForm({ camp, onClose }: { camp: Camp | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    kind: camp?.kind ?? 'ميني كامب',
    title: camp?.title ?? '',
    camp_date: camp?.camp_date ?? cairoToday(),
    end_date: camp?.end_date ?? '',
    place: camp?.place ?? '',
    capacity: camp?.capacity ? String(camp.capacity) : '',
    notes: camp?.notes ?? '',
    registration_open: camp?.registration_open ?? true,
  })
  const dateProblem = !f.camp_date
    ? 'اختار اليوم'
    : f.end_date && f.end_date < f.camp_date
      ? '«لحد يوم» لازم يكون بعد اليوم نفسه أو هو'
      : f.capacity && !(Number(f.capacity) > 0)
        ? 'عدد الأماكن لازم يكون رقم أكبر من صفر'
        : null
  const save = useMutation({
    mutationFn: async () => {
      if (dateProblem) throw { message: dateProblem }
      const payload = {
        kind: f.kind,
        title: f.title.trim() || null,
        camp_date: f.camp_date,
        end_date: f.end_date || null,
        place: f.place.trim() || null,
        capacity: Number(f.capacity) || null,
        notes: f.notes.trim() || null,
        registration_open: f.registration_open,
      }
      const { error } = camp ? await supabase.from('camps').update(payload).eq('id', camp.id) : await supabase.from('camps').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(camp ? 'اتعدّل' : `الميعاد اتضاف، واتبعت إشعار للي لسه محضروش ${f.kind}`)
      qc.invalidateQueries({ queryKey: ['camps'] })
      onClose()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('camps').delete().eq('id', camp!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['camps'] })
      onClose()
    },
    onError: toastError,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open onClose={onClose} title={camp ? 'تعديل الميعاد' : 'ميعاد جديد'}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="النوع">
          <Select value={f.kind} onChange={set('kind')} options={['ميني كامب', 'كامب', 'حفلة تخرج']} />
        </Field>
        <Field label="اسم (اختياري)">
          <Input value={f.title} onChange={set('title')} placeholder="مثلاً: ميني كامب ديسمبر" />
        </Field>
        <Field label="اليوم">
          <Input type="date" value={f.camp_date} onChange={set('camp_date')} />
        </Field>
        <Field label="لحد يوم (لو أكتر من يوم)" error={f.end_date && f.end_date < f.camp_date ? 'لازم يكون بعد اليوم نفسه' : undefined}>
          <Input type="date" value={f.end_date} min={f.camp_date} onChange={set('end_date')} />
        </Field>
        <Field label="المكان">
          <Input value={f.place} onChange={set('place')} />
        </Field>
        <Field label="عدد الأماكن" hint="فاضي = من غير حد. اللي بعد العدد بيدخل قايمة الانتظار">
          <Input type="number" min={1} value={f.capacity} onChange={set('capacity')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات للمتطوعين">
            <Textarea value={f.notes} onChange={set('notes')} rows={2} placeholder="مثلاً: الميعاد 9 الصبح، هات معاك بطاقتك" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-brand-700" checked={f.registration_open} onChange={(e) => setF({ ...f, registration_open: e.target.checked })} />
          التسجيل مفتوح
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button className="flex-1" loading={save.isPending} onClick={() => save.mutate()}>
            حفظ
          </Button>
          {camp && (
            <Button variant="secondary" className="text-red-600" loading={remove.isPending} onClick={() => confirm('مسح الميعاد ده وكل التسجيلات فيه؟') && remove.mutate()}>
              مسح
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

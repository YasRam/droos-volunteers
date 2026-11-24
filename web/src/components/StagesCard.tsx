import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarDays, Check, CircleDashed, MapPin, Shirt, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { cairoToday, fmtDate, fmtShort } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type Stage = {
  key: string
  name: string
  description: string | null
  source: string
  self_complete: boolean
  sort_order: number
  done: boolean
  done_at: string | null
}

export type Camp = {
  id: string
  kind: 'ميني كامب' | 'كامب' | 'حفلة تخرج'
  title: string | null
  camp_date: string
  end_date: string | null
  place: string | null
  capacity: number | null
  notes: string | null
  registration_open: boolean
}

const SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL']

export function useStages(volunteerId: string | null | undefined) {
  return useQuery({
    queryKey: ['stages', volunteerId],
    enabled: Boolean(volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('volunteer_stages', { p_volunteer: volunteerId })
      if (error) throw error
      return data as Stage[]
    },
  })
}

/** The volunteer's path: done stages ticked, the rest with what to do next. */
export function StagesCard({ volunteerId, self }: { volunteerId: string; self: boolean }) {
  const qc = useQueryClient()
  const p = usePermissions()
  const q = useStages(volunteerId)
  const [open, setOpen] = useState<string | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['stages'] })
    qc.invalidateQueries({ queryKey: ['tshirt-mine'] })
    qc.invalidateQueries({ queryKey: ['camps'] })
  }
  const mark = useMutation({
    mutationFn: async ({ key, done }: { key: string; done: boolean }) => {
      const r = done
        ? await supabase.from('stage_done').insert({ volunteer_id: volunteerId, stage_key: key })
        : await supabase.from('stage_done').delete().eq('volunteer_id', volunteerId).eq('stage_key', key)
      if (r.error) throw r.error
    },
    onSuccess: refresh,
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  const stages = q.data ?? []
  if (!stages.length) return null
  const done = stages.filter((s) => s.done).length
  const pct = Math.round((done / stages.length) * 100)
  const next = stages.find((s) => !s.done)
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">مراحل التطوع</p>
        <span className="text-sm font-semibold text-brand-700">
          {done} من {stages.length}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-surface">
        <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {self && next && <p className="mt-2 text-xs text-muted">الخطوة الجاية: {next.name}</p>}
      <ol className="mt-3 space-y-1.5">
        {stages.map((s) => (
          <li key={s.key} className={clsx('flex items-start gap-2 rounded-xl px-2 py-1.5', !s.done && s.key === next?.key && 'bg-brand-50')}>
            {s.done ? <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-gray-300" />}
            <div className="min-w-0 flex-1">
              <p className={clsx('text-sm font-semibold', s.done && 'text-muted')}>{s.name}</p>
              {!s.done && s.description && <p className="text-xs text-muted">{s.description}</p>}
              {s.done && s.done_at && <p className="text-xs text-muted">{fmtShort(s.done_at)}</p>}
            </div>
            {!s.done && self && <StageAction stage={s} onOpen={() => setOpen(s.source === 'manual' ? s.key : s.source)} onMark={() => mark.mutate({ key: s.key, done: true })} />}
            {!self && p.can('stages.manage') && s.source === 'manual' && (
              <Button variant="ghost" size="sm" onClick={() => mark.mutate({ key: s.key, done: !s.done })}>
                {s.done ? 'شيل' : 'خلصت'}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {open === 'rules' && <RulesModal onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'tshirt' && <TshirtModal volunteerId={volunteerId} onClose={() => setOpen(null)} onDone={refresh} />}
      {(open === 'minicamp' || open === 'camp' || open === 'graduation') && (
        <Modal open onClose={() => setOpen(null)} title="المواعيد الجاية">
          <CampSignup />
        </Modal>
      )}
    </Card>
  )
}

function StageAction({ stage, onOpen, onMark }: { stage: Stage; onOpen: () => void; onMark: () => void }) {
  const tshirt = useMyTshirt(stage.source === 'tshirt')
  if (stage.source === 'rules')
    return (
      <Button size="sm" onClick={onOpen}>
        اقرا ووافق
      </Button>
    )
  if (stage.source === 'tshirt')
    return tshirt.data ? (
      <Badge tone="orange">طلبك مستني</Badge>
    ) : (
      <Button size="sm" onClick={onOpen}>
        <Shirt className="size-4" /> اطلب
      </Button>
    )
  if (stage.source === 'minicamp' || stage.source === 'camp' || stage.source === 'graduation')
    return (
      <Button size="sm" onClick={onOpen}>
        <CalendarDays className="size-4" /> المواعيد
      </Button>
    )
  if (stage.self_complete && (stage.source === 'manual' || stage.source === 'joined_group'))
    return (
      <Button size="sm" variant="secondary" onClick={onMark}>
        خلصتها
      </Button>
    )
  return null
}

function useMyTshirt(enabled = true) {
  return useQuery({
    queryKey: ['tshirt-mine'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('tshirt_requests').select('*').eq('status', 'pending').maybeSingle()
      if (error) throw error
      return data as { id: string; size: string | null } | null
    },
  })
}

function RulesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const rules = useQuery({
    queryKey: ['setting', 'rules_text'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'rules_text').maybeSingle()
      if (error) throw error
      return (data?.value as string | null) ?? ''
    },
  })
  const [read, setRead] = useState(false)
  const accept = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('accept_rules')
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('شكرًا! اتسجلت موافقتك')
      onDone()
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="قواعد النشاط">
      {rules.isLoading ? (
        <Spinner />
      ) : !rules.data ? (
        <p className="text-sm text-muted">القواعد لسه متكتبتش. هتظهر هنا أول ما الإدارة تضيفها.</p>
      ) : (
        <div className="space-y-4">
          <div className="max-h-96 overflow-y-auto whitespace-pre-line rounded-xl bg-surface px-4 py-3 text-sm leading-7">{rules.data}</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-700" checked={read} onChange={(e) => setRead(e.target.checked)} />
            قريت القواعد وموافق عليها
          </label>
          <Button className="w-full" disabled={!read} loading={accept.isPending} onClick={() => accept.mutate()}>
            موافق
          </Button>
        </div>
      )}
    </Modal>
  )
}

function TshirtModal({ volunteerId, onClose, onDone }: { volunteerId: string; onClose: () => void; onDone: () => void }) {
  const [size, setSize] = useState('')
  const [notes, setNotes] = useState('')
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tshirt_requests').insert({ volunteer_id: volunteerId, size: size || null, notes: notes.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('طلبك وصل، وهيوصلك إشعار لما يتأكد')
      onDone()
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="طلب تيشيرت">
      <div className="space-y-4">
        <Field label="المقاس">
          <Select value={size} onChange={(e) => setSize(e.target.value)} placeholder="اختار..." options={SIZES} />
        </Field>
        <Field label="ملاحظات (اختياري)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: هدفع يوم السبت" />
        </Field>
        <Button className="w-full" disabled={!size} loading={send.isPending} onClick={() => send.mutate()}>
          ابعت الطلب
        </Button>
      </div>
    </Modal>
  )
}

/** Upcoming camps: register, see the seat count, or leave the waiting list. */
export function CampSignup() {
  const qc = useQueryClient()
  const today = cairoToday()
  const q = useQuery({
    queryKey: ['camps', 'upcoming'],
    queryFn: async () => {
      const [camps, mine] = await Promise.all([
        supabase.from('camps').select('*').gte('camp_date', today).order('camp_date'),
        supabase.from('camp_registrations').select('camp_id, status'),
      ])
      if (camps.error) throw camps.error
      if (mine.error) throw mine.error
      const seats = await Promise.all(
        (camps.data as Camp[]).map(async (c) => {
          const { data } = await supabase.rpc('camp_seats', { p_camp: c.id })
          return [c.id, (data as { confirmed: number; waitlist: number }[] | null)?.[0] ?? { confirmed: 0, waitlist: 0 }] as const
        }),
      )
      return {
        camps: camps.data as Camp[],
        mine: new Map((mine.data as { camp_id: string; status: string }[]).map((r) => [r.camp_id, r.status])),
        seats: new Map(seats),
      }
    },
  })
  const act = useMutation({
    mutationFn: async ({ id, join }: { id: string; join: boolean }) => {
      const { data, error } = join ? await supabase.rpc('register_camp', { p_camp: id }) : await supabase.rpc('cancel_camp', { p_camp: id })
      if (error) throw error
      return join ? (data as string) : 'cancelled'
    },
    onSuccess: (st) => {
      toast.success(st === 'confirmed' ? 'مكانك اتأكد' : st === 'waitlist' ? 'الأماكن خلصت، ودخلت قايمة الانتظار. هيوصلك إشعار لو اتفضّى مكان' : 'اتلغى تسجيلك')
      qc.invalidateQueries({ queryKey: ['camps'] })
    },
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.camps.length) return <p className="text-sm text-muted">مفيش كامب جاي دلوقتي. هيوصلك إشعار أول ما يتحدد ميعاد.</p>
  return (
    <div className="space-y-3">
      {q.data.camps.map((c) => {
        const st = q.data.mine.get(c.id)
        const seats = q.data.seats.get(c.id)
        const left = c.capacity ? Math.max(0, c.capacity - (seats?.confirmed ?? 0)) : null
        const active = st && st !== 'cancelled'
        return (
          <div key={c.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {c.kind}
                {c.title ? ` · ${c.title}` : ''}
              </p>
              {st === 'confirmed' && <Badge tone="green">مكانك متأكد</Badge>}
              {st === 'waitlist' && <Badge tone="orange">قايمة الانتظار</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" /> {fmtDate(c.camp_date)}
                {c.end_date && c.end_date !== c.camp_date ? ` لـ ${fmtDate(c.end_date)}` : ''}
              </span>
              {c.place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {c.place}
                </span>
              )}
              {left !== null && (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" /> {left ? `فاضل ${left} مكان` : `الأماكن خلصت${seats?.waitlist ? ` · ${seats.waitlist} في الانتظار` : ''}`}
                </span>
              )}
            </div>
            {c.notes && <p className="mt-1 text-xs">{c.notes}</p>}
            <div className="mt-2">
              {active ? (
                <Button size="sm" variant="secondary" className="text-red-600" loading={act.isPending} onClick={() => confirm('تلغي تسجيلك؟') && act.mutate({ id: c.id, join: false })}>
                  إلغاء التسجيل
                </Button>
              ) : c.registration_open ? (
                <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: c.id, join: true })}>
                  {left === 0 ? 'سجّلني في قايمة الانتظار' : 'هاجي، سجّلني'}
                </Button>
              ) : (
                <span className="text-xs text-muted">التسجيل مقفول</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

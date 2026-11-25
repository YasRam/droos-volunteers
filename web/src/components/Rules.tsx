import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Modal, Spinner, Textarea } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface Rule {
  id: string
  body: string
  sort_order: number
  version: number
}
interface Answer {
  rule_id: string
  version: number
  agreed: boolean
  comment: string | null
}

export function useRules() {
  return useQuery({
    queryKey: ['activity-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_rules').select('id, body, sort_order, version').eq('is_active', true).order('sort_order')
      if (error) throw error
      return data as Rule[]
    },
  })
}

/** The volunteer reads each rule and agrees, or leaves a comment on it to come back to. */
export function RulesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const p = usePermissions()
  const rules = useRules()
  const mine = useQuery({
    queryKey: ['rule-answers', p.volunteerId],
    enabled: Boolean(p.volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase.from('rule_answers').select('rule_id, version, agreed, comment').eq('volunteer_id', p.volunteerId!)
      if (error) throw error
      return new Map((data as Answer[]).map((a) => [a.rule_id, a]))
    },
  })
  const [state, setState] = useState<Record<string, { agreed: boolean; comment: string; open: boolean }>>({})
  useEffect(() => {
    if (!rules.data || !mine.data) return
    setState(
      Object.fromEntries(
        rules.data.map((r) => {
          const a = mine.data.get(r.id)
          const current = a && a.version === r.version
          return [r.id, { agreed: Boolean(current && a.agreed), comment: a?.comment ?? '', open: Boolean(a?.comment) }]
        }),
      ),
    )
  }, [rules.data, mine.data])

  const send = useMutation({
    mutationFn: async () => {
      const payload = (rules.data ?? []).map((r) => ({ rule_id: r.id, agreed: state[r.id]?.agreed ?? false, comment: state[r.id]?.comment ?? '' }))
      const { data, error } = await supabase.rpc('answer_rules', { p: payload })
      if (error) throw error
      return data as boolean
    },
    onSuccess: (done) => {
      toast.success(done ? 'شكرًا! وافقت على كل القواعد' : 'اتحفظ. القواعد اللي عليها تعليق هنرجعلها معاك')
      onDone()
      onClose()
    },
    onError: toastError,
  })

  const list = rules.data ?? []
  const agreedCount = list.filter((r) => state[r.id]?.agreed).length
  const set = (id: string, patch: Partial<{ agreed: boolean; comment: string; open: boolean }>) =>
    setState((s) => ({ ...s, [id]: { ...{ agreed: false, comment: '', open: false }, ...s[id], ...patch } }))

  return (
    <Modal open onClose={onClose} title="قواعد النشاط">
      {rules.isLoading || mine.isLoading ? (
        <Spinner />
      ) : !list.length ? (
        <p className="text-sm text-muted">القواعد لسه متكتبتش. هتظهر هنا أول ما الإدارة تضيفها.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">وافق على كل قاعدة، ولو عندك سؤال أو اعتراض على قاعدة اكتب تعليق عليها وهنرجعلها معاك.</p>
          <ol className="max-h-[55vh] space-y-2 overflow-y-auto">
            {list.map((r, i) => {
              const s = state[r.id] ?? { agreed: false, comment: '', open: false }
              const old = mine.data?.get(r.id)
              const tag = !old ? null : old.version < r.version ? 'اتعدلت' : null
              return (
                <li key={r.id} className={clsx('rounded-xl p-3 ring-1', s.agreed ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-line')}>
                  <div className="flex gap-2">
                    <span className="font-bold text-brand-700">{i + 1}.</span>
                    <p className="flex-1 whitespace-pre-line text-sm leading-7">
                      {r.body} {tag && <Badge tone="orange">{tag}</Badge>}
                      {!old && mine.data && mine.data.size > 0 && <Badge tone="orange">جديدة</Badge>}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" className="size-4 accent-emerald-600" checked={s.agreed} onChange={(e) => set(r.id, { agreed: e.target.checked })} />
                      موافق
                    </label>
                    <button type="button" className="flex items-center gap-1 text-xs font-semibold text-brand-700" onClick={() => set(r.id, { open: !s.open })}>
                      <MessageSquare className="size-3.5" /> {s.comment ? 'تعليقك' : 'عندي تعليق'}
                    </button>
                  </div>
                  {s.open && <Textarea className="mt-2" rows={2} value={s.comment} onChange={(e) => set(r.id, { comment: e.target.value })} placeholder="اكتب سؤالك أو تعليقك على القاعدة دي" />}
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setState((st) => Object.fromEntries(list.map((r) => [r.id, { ...(st[r.id] ?? { comment: '', open: false }), agreed: true }])))}>
              موافق على الكل
            </Button>
            <span className="text-xs text-muted">
              {agreedCount} من {list.length}
            </span>
            <Button className="ms-auto" loading={send.isPending} onClick={() => send.mutate()}>
              حفظ
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

interface Report {
  rule_id: string
  agreed: number
  pending: number
  comments: { volunteer_id: string; name: string; comment: string; agreed: boolean; old: boolean; at: string }[]
}

/** Admin: the rules one by one. Saving tells everyone about new or reworded rules. */
export function RulesEditor() {
  const qc = useQueryClient()
  const rules = useRules()
  const report = useQuery({
    queryKey: ['rules-report'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rules_report')
      if (error) throw error
      return new Map((data as Report[]).map((r) => [r.rule_id, r]))
    },
  })
  const [items, setItems] = useState<{ id?: string; body: string }[] | null>(null)
  useEffect(() => {
    if (rules.data && items === null) setItems(rules.data.map((r) => ({ id: r.id, body: r.body })))
  }, [rules.data, items])
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('save_rules', { p: (items ?? []).filter((x) => x.body.trim()) })
      if (error) throw error
      return Number(data)
    },
    onSuccess: (n) => {
      toast.success(n ? `اتحفظت، واتبعت إشعار للمتطوعين بـ ${n} قاعدة جديدة أو متعدلة` : 'اتحفظت')
      setItems(null)
      qc.invalidateQueries({ queryKey: ['activity-rules'] })
      qc.invalidateQueries({ queryKey: ['rules-report'] })
      qc.invalidateQueries({ queryKey: ['stages'] })
    },
    onError: toastError,
  })
  if (rules.isLoading || items === null) return <Spinner />
  const original = new Map((rules.data ?? []).map((r) => [r.id, r.body]))
  const dirty = items.length !== (rules.data ?? []).length || items.some((x) => !x.id || original.get(x.id) !== x.body)
  const move = (i: number, d: number) =>
    setItems((xs) => {
      const a = [...(xs ?? [])]
      const [x] = a.splice(i, 1)
      a.splice(i + d, 0, x)
      return a
    })
  return (
    <Card>
      <p className="font-bold">قواعد النشاط</p>
      <p className="mb-3 text-xs text-muted">
        كل قاعدة لوحدها. لما تضيف قاعدة أو تغيّر كلامها وتحفظ، كل المتطوعين بيوصلهم إشعار ولازم يوافقوا عليها تاني. تغيير الترتيب بس مش بيطلب موافقة.
      </p>
      <ol className="space-y-3">
        {items.map((x, i) => {
          const rep = x.id ? report.data?.get(x.id) : undefined
          const changed = x.id && original.get(x.id) !== x.body
          return (
            <li key={x.id ?? `new-${i}`} className="rounded-xl p-3 ring-1 ring-line">
              <div className="flex items-start gap-2">
                <span className="mt-2 font-bold text-brand-700">{i + 1}.</span>
                <Textarea rows={2} className="flex-1" value={x.body} onChange={(e) => setItems((xs) => xs!.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)))} />
                <div className="flex flex-col gap-1">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 hover:bg-surface disabled:opacity-30" aria-label="لفوق">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="rounded p-1 hover:bg-surface disabled:opacity-30" aria-label="لتحت">
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" onClick={() => setItems((xs) => xs!.filter((_, j) => j !== i))} className="rounded p-1 text-red-600 hover:bg-red-50" aria-label="مسح">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {!x.id && <Badge tone="orange">جديدة</Badge>}
                {changed && <Badge tone="orange">اتعدلت (هيوافقوا تاني)</Badge>}
                {rep && (
                  <>
                    <Badge tone="green">وافق {rep.agreed}</Badge>
                    <Badge tone="gray">لسه {rep.pending}</Badge>
                  </>
                )}
              </div>
              {rep && rep.comments.length > 0 && (
                <div className="mt-2 space-y-1 rounded-lg bg-amber-50 p-2 text-sm">
                  <p className="text-xs font-bold text-amber-800">تعليقات نرجعلها ({rep.comments.length})</p>
                  {rep.comments.map((c, k) => (
                    <p key={k}>
                      <VolunteerName id={c.volunteer_id} name={c.name} className="font-semibold" />: {c.comment}{' '}
                      <span className="text-xs text-muted">
                        ({fmtDate(c.at)}
                        {c.old ? ' · على النسخة القديمة' : ''}
                        {c.agreed ? ' · ووافق' : ''})
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setItems((xs) => [...(xs ?? []), { body: '' }])}>
          <Plus className="size-4" /> قاعدة جديدة
        </Button>
        <Button className="ms-auto" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          حفظ القواعد
        </Button>
      </div>
    </Card>
  )
}

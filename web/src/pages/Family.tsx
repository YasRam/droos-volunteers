import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, CalendarDays, CheckCircle2, ClipboardList, LogOut, MessageSquare, Phone, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Modal, Spinner, Textarea, type Tone } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { sdb, useStudentRules } from '@/lib/students'
import { supabase } from '@/lib/supabase'

interface Child {
  id: string
  full_name: string
  school: string | null
  carnet_no: string | null
  grade: string | null
  status: string | null
  application: string | null
  counts: { present: number; absent: number; excused: number; violations: number }
  recent: { date: string; subject: string; mark: string; note: string | null }[]
  exams: { date: string; subject: string; score: number; max: number | null }[]
  upcoming: { date: string; starts_at: string; ends_at: string; subject: string; kind: string; status: string }[]
}
interface Home {
  kind: 'guardian' | 'student'
  login: string
  name: string | null
  guardian_id: string | null
  rules_done: boolean
  org: { name: string; phone: string | null; address: string | null; about: string | null } | null
  children: Child[]
}

const MARK_TONE: Record<string, Tone> = {
  حاضر: 'green',
  غائب: 'red',
  معتذر: 'gray',
  تأخير: 'orange',
  كارنيه: 'orange',
  واجب: 'orange',
  شغب: 'red',
  طرد: 'red',
  إجازة: 'blue',
  'فصل مؤقت': 'red',
}
const STATUS_TONE: Record<string, Tone> = { نشط: 'green', تحذير: 'orange', مفصول: 'red', منقطع: 'gray', اتنقل: 'gray' }
const hhmm = (t: string) => t.slice(0, 5)

function useHome() {
  return useQuery({
    queryKey: ['family-home'],
    queryFn: async () => {
      const { data, error } = await sdb().rpc('family_home')
      if (error) throw error
      return data as Home
    },
  })
}

/** The page guardians and students see: their children, classes, attendance and the rules. */
export default function Family() {
  const { signOut } = useAuth()
  const home = useHome()
  const [rulesOpen, setRulesOpen] = useState(false)
  const h = home.data
  useEffect(() => {
    if (h && h.kind === 'guardian' && !h.rules_done) setRulesOpen(true)
  }, [h?.kind, h?.rules_done]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-dvh bg-surface pb-10">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="h-11 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{h?.name ?? 'نشاط دروس التقوية'}</p>
            <p className="text-xs text-muted">{h?.kind === 'student' ? 'طالب' : 'ولي أمر'} · نشاط دروس التقوية</p>
          </div>
          <img src={`${import.meta.env.BASE_URL}resala.png`} alt="جمعية رسالة" className="hidden h-8 w-auto sm:block" />
          <button onClick={() => void signOut()} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface" title="خروج">
            <LogOut className="size-4" /> خروج
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {home.isLoading ? (
          <Spinner />
        ) : home.isError || !h ? (
          <Card>
            <p className="text-sm">مش قادرين نجيب البيانات دلوقتي.</p>
            <Button className="mt-3" variant="secondary" onClick={() => void home.refetch()}>
              جرّب تاني
            </Button>
          </Card>
        ) : (
          <>
            <RulesCard home={h} onOpen={() => setRulesOpen(true)} />
            {!h.children.length && (
              <Card>
                <p className="text-sm text-muted">مفيش طلاب مربوطين بالحساب ده لسه. كلّم التنظيم في النشاط.</p>
              </Card>
            )}
            {h.children.map((c) => (
              <ChildCard key={c.id} c={c} />
            ))}
            <Notifications />
            {h.org && (h.org.phone || h.org.address || h.org.about) && (
              <Card>
                <p className="font-bold">{h.org.name}</p>
                {h.org.about && <p className="mt-1 whitespace-pre-line text-sm text-muted">{h.org.about}</p>}
                {h.org.address && <p className="mt-2 text-sm">{h.org.address}</p>}
                {h.org.phone && (
                  <a href={`tel:${h.org.phone}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                    <Phone className="size-4" /> <span dir="ltr">{h.org.phone}</span>
                  </a>
                )}
              </Card>
            )}
          </>
        )}
      </main>
      {rulesOpen && h && <FamilyRulesModal readOnly={h.kind !== 'guardian'} onClose={() => setRulesOpen(false)} />}
    </div>
  )
}

function RulesCard({ home, onOpen }: { home: Home; onOpen: () => void }) {
  const guardian = home.kind === 'guardian'
  return (
    <Card className={clsx(!home.rules_done && 'ring-2 ring-orange-300')}>
      <div className="flex items-center gap-3">
        <ScrollText className={clsx('size-8 shrink-0', home.rules_done ? 'text-emerald-600' : 'text-orange-500')} />
        <div className="flex-1">
          <p className="font-bold">قواعد النشاط</p>
          <p className="text-sm text-muted">
            {home.rules_done
              ? guardian
                ? 'وافقت على كل القواعد. شكرًا!'
                : 'ولي أمرك وافق على القواعد.'
              : guardian
                ? 'محتاجين موافقتك على قواعد النشاط عشان ولادك يكمّلوا معانا.'
                : 'ولي أمرك لسه موافقش على القواعد. اقراها وفكّره يوافق من حسابه.'}
          </p>
        </div>
        <Button variant={home.rules_done ? 'secondary' : 'primary'} onClick={onOpen}>
          {home.rules_done || !guardian ? 'اقرا القواعد' : 'اقرا ووافق'}
        </Button>
      </div>
    </Card>
  )
}

function ChildCard({ c }: { c: Child }) {
  const [all, setAll] = useState(false)
  const recent = all ? c.recent : c.recent.slice(0, 5)
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1">
          <p className="text-lg font-bold">{c.full_name}</p>
          <p className="text-sm text-muted">
            {[c.grade && `الصف ${c.grade}`, c.school, c.carnet_no && `كارنيه ${c.carnet_no}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {c.status ? (
          <Badge tone={STATUS_TONE[c.status] ?? 'gray'}>{c.status}</Badge>
        ) : (
          c.application && <Badge tone={c.application === 'مقبول' ? 'green' : 'orange'}>{c.application === 'انتظار' ? 'في الانتظار' : c.application}</Badge>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Count label="حضر" value={c.counts.present} tone="text-emerald-700" />
        <Count label="غاب" value={c.counts.absent} tone="text-red-600" />
        <Count label="بعذر" value={c.counts.excused} tone="text-gray-600" />
        <Count label="ملاحظات" value={c.counts.violations} tone="text-orange-600" />
      </div>

      {c.upcoming.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 flex items-center gap-1 text-sm font-bold">
            <CalendarDays className="size-4 text-brand-700" /> الحصص الجاية
          </p>
          <ul className="divide-y divide-line text-sm">
            {c.upcoming.map((u, i) => (
              <li key={i} className={clsx('flex items-center gap-2 py-1.5', u.status === 'اتلغت' && 'text-muted line-through')}>
                <span className="w-28 shrink-0">{fmtDate(u.date)}</span>
                <span className="w-24 shrink-0" dir="ltr">
                  {hhmm(u.starts_at)}–{hhmm(u.ends_at)}
                </span>
                <span className="flex-1">{u.subject}</span>
                {u.kind === 'امتحان' && <Badge tone="purple">امتحان</Badge>}
                {u.status === 'اتلغت' && <Badge tone="red">اتلغت</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.recent.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 flex items-center gap-1 text-sm font-bold">
            <ClipboardList className="size-4 text-brand-700" /> آخر الحضور
          </p>
          <ul className="divide-y divide-line text-sm">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-2 py-1.5">
                <span className="w-28 shrink-0">{fmtDate(r.date)}</span>
                <span className="flex-1">
                  {r.subject}
                  {r.note && <span className="text-xs text-muted"> · {r.note}</span>}
                </span>
                <Badge tone={MARK_TONE[r.mark] ?? 'gray'}>{r.mark}</Badge>
              </li>
            ))}
          </ul>
          {c.recent.length > 5 && (
            <button className="mt-1 text-xs font-semibold text-brand-700" onClick={() => setAll(!all)}>
              {all ? 'أقل' : 'كل اللي فات'}
            </button>
          )}
        </div>
      )}

      {c.exams.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-bold">الامتحانات</p>
          <ul className="divide-y divide-line text-sm">
            {c.exams.map((x, i) => (
              <li key={i} className="flex items-center gap-2 py-1.5">
                <span className="w-28 shrink-0">{fmtDate(x.date)}</span>
                <span className="flex-1">{x.subject}</span>
                <span className="font-bold">
                  {x.score}
                  {x.max ? ` / ${x.max}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-surface py-2">
      <p className={clsx('text-xl font-bold', tone)}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

interface Note {
  id: number
  title: string
  body: string | null
  read_at: string | null
  created_at: string
}

function Notifications() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const email = session?.user.email ?? ''
  const q = useQuery({
    queryKey: ['family-notes', email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, read_at, created_at')
        .eq('recipient_email', email)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as Note[]
    },
  })
  const unread = (q.data ?? []).filter((n) => !n.read_at).map((n) => n.id)
  const markRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['family-notes'] }),
  })
  if (!q.data?.length) return null
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <Bell className="size-5 text-brand-700" />
        <p className="flex-1 font-bold">الإشعارات</p>
        {unread.length > 0 && (
          <button className="text-xs font-semibold text-brand-700" onClick={() => markRead.mutate()}>
            علّم الكل مقروء
          </button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {q.data.map((n) => (
          <li key={n.id} className={clsx('py-2', !n.read_at && 'font-semibold')}>
            <p className="text-sm">{n.title}</p>
            {n.body && <p className="text-sm font-normal text-muted">{n.body}</p>}
            <p className="text-xs font-normal text-muted">{fmtDate(n.created_at)}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

interface Answer {
  rule_id: string
  version: number
  agreed: boolean
  comment: string | null
}

/** The guardian agrees to each rule, or comments on it. The student only reads them. */
function FamilyRulesModal({ readOnly, onClose }: { readOnly: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const rules = useStudentRules()
  const home = useHome()
  const gid = home.data?.guardian_id
  const mine = useQuery({
    queryKey: ['student-rule-answers', gid],
    enabled: Boolean(gid) && !readOnly,
    queryFn: async () => {
      const { data, error } = await sdb().from('rule_answers').select('rule_id, version, agreed, comment').eq('guardian_id', gid!)
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
  const list = rules.data ?? []
  const send = useMutation({
    mutationFn: async () => {
      const p = list.map((r) => ({ rule_id: r.id, agreed: state[r.id]?.agreed ?? false, comment: state[r.id]?.comment ?? '' }))
      const { data, error } = await sdb().rpc('answer_rules', { p })
      if (error) throw error
      return data as boolean
    },
    onSuccess: (done) => {
      toast.success(done ? 'شكرًا! وافقت على كل القواعد' : 'اتحفظ. التنظيم هيرد على تعليقاتك')
      qc.invalidateQueries({ queryKey: ['family-home'] })
      qc.invalidateQueries({ queryKey: ['student-rule-answers'] })
      onClose()
    },
    onError: toastError,
  })
  const set = (id: string, patch: Partial<{ agreed: boolean; comment: string; open: boolean }>) =>
    setState((s) => ({ ...s, [id]: { ...{ agreed: false, comment: '', open: false }, ...s[id], ...patch } }))
  const agreedCount = list.filter((r) => state[r.id]?.agreed).length

  return (
    <Modal open onClose={onClose} title="قواعد النشاط">
      {rules.isLoading || (!readOnly && mine.isLoading) ? (
        <Spinner />
      ) : !list.length ? (
        <p className="text-sm text-muted">القواعد لسه متكتبتش.</p>
      ) : (
        <div className="space-y-3">
          {!readOnly && <p className="text-sm text-muted">وافق على كل قاعدة، ولو عندك سؤال أو اعتراض على قاعدة اكتب تعليق عليها والتنظيم هيرد عليك.</p>}
          <ol className="max-h-[55vh] space-y-2 overflow-y-auto">
            {list.map((r, i) => {
              const s = state[r.id] ?? { agreed: false, comment: '', open: false }
              const old = mine.data?.get(r.id)
              return (
                <li key={r.id} className={clsx('rounded-xl p-3 ring-1', s.agreed ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-line')}>
                  <div className="flex gap-2">
                    <span className="font-bold text-brand-700">{i + 1}.</span>
                    <p className="flex-1 whitespace-pre-line text-sm leading-7">
                      {r.body} {old && old.version < r.version && <Badge tone="orange">اتعدلت</Badge>}
                    </p>
                  </div>
                  {!readOnly && (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" className="size-4 accent-emerald-600" checked={s.agreed} onChange={(e) => set(r.id, { agreed: e.target.checked })} />
                          موافق
                        </label>
                        <button type="button" className="flex items-center gap-1 text-xs font-semibold text-brand-700" onClick={() => set(r.id, { open: !s.open })}>
                          <MessageSquare className="size-3.5" /> {s.comment ? 'تعليقك' : 'عندي تعليق'}
                        </button>
                      </div>
                      {s.open && (
                        <Textarea className="mt-2" rows={2} value={s.comment} onChange={(e) => set(r.id, { comment: e.target.value })} placeholder="اكتب سؤالك أو تعليقك على القاعدة دي" />
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setState((st) => Object.fromEntries(list.map((r) => [r.id, { ...(st[r.id] ?? { comment: '', open: false }), agreed: true }])))}
              >
                <CheckCircle2 className="size-4" /> موافق على الكل
              </Button>
              <span className="text-xs text-muted">
                {agreedCount} من {list.length}
              </span>
              <Button className="ms-auto" loading={send.isPending} onClick={() => send.mutate()}>
                حفظ
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

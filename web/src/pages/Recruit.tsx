import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarClock, History, PhoneCall, RotateCcw, Search, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ContactLinks, VolunteerName } from '@/components/VolunteerLink'
import { VolunteerSelect } from '@/components/VolunteerPick'
import { AcceptanceBadge, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { cairoToday, fmtDate, fmtDateTime, fmtShort, useHrRows, useVolunteers, type VolunteerWithStats } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { VolunteerHr } from '@/lib/types'

type Stage = 'للتواصل' | 'ميعاد انترفيو' | 'اتعمل انترفيو' | 'مقفول'
type Log = {
  id: string
  volunteer_id: string
  kind: 'call' | 'interview' | 'reopen'
  outcome: string
  scheduled_at: string | null
  interviewer_id: string | null
  prev_acceptance: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}
type V = VolunteerWithStats & { recruit_status?: Stage | null; interview_at?: string | null }

const CALL_OUTCOMES = [
  { value: 'تم التواصل', hint: 'رد، ولسه هيتحدد ميعاد' },
  { value: 'مردش', hint: 'هيفضل في القايمة' },
  { value: 'رقم غلط', hint: 'هيفضل في القايمة' },
  { value: 'حدد ميعاد', hint: 'بيروح لقايمة «ميعاد انترفيو»' },
  { value: 'رفض الانترفيو', hint: 'بيتقفل ويختفي' },
  { value: 'معتذر نهائى', hint: 'بيتقفل ويختفي' },
]
const RESULTS = [
  { value: 'اختبار', hint: 'بيبدأ فترة الاختبار' },
  { value: 'مقبول', hint: '' },
  { value: 'مرفوض', hint: 'بيتقفل ويختفي' },
  { value: 'محضرش', hint: 'بيرجع لقايمة التواصل بملاحظاته' },
]

export function useRecruitLog() {
  return useQuery({
    queryKey: ['recruit-log'],
    queryFn: async () => {
      const { data, error } = await supabase.from('recruit_log').select('*').order('created_at', { ascending: false }).limit(5000)
      if (error) throw error
      const by = new Map<string, Log[]>()
      for (const r of data as Log[]) by.set(r.volunteer_id, [...(by.get(r.volunteer_id) ?? []), r])
      return by
    },
  })
}

/** New volunteers: who to call, who has an interview booked, results, and the closed ones. */
export default function Recruit() {
  const p = usePermissions()
  const vols = useVolunteers()
  const hr = useHrRows(true)
  const log = useRecruitLog()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [call, setCall] = useState<V | null>(null)
  const [result, setResult] = useState<V | null>(null)
  const acceptance = hr.data ?? new Map<string, VolunteerHr>()
  const all = (vols.data ?? []) as V[]
  const by = (s: Stage) => all.filter((v) => v.recruit_status === s)
  const toCall = by('للتواصل').sort((a, b) => b.registered_at.localeCompare(a.registered_at))
  const booked = by('ميعاد انترفيو').sort((a, b) => (a.interview_at ?? '').localeCompare(b.interview_at ?? ''))
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
  const done = by('اتعمل انترفيو')
    .filter((v) => (acceptance.get(v.id)?.interview_date ?? '') >= since)
    .sort((a, b) => (acceptance.get(b.id)?.interview_date ?? '').localeCompare(acceptance.get(a.id)?.interview_date ?? ''))
  const closed = by('مقفول')
  const tabs = [
    { value: 'call', label: `للتواصل (${toCall.length})` },
    { value: 'booked', label: `ميعاد انترفيو (${booked.length})` },
    { value: 'done', label: `اتعمل انترفيو (${done.length})` },
    { value: 'closed', label: `مقفول (${closed.length})` },
  ]
  const tab = tabs.find((t) => t.value === params.get('tab'))?.value ?? 'call'
  const list = tab === 'call' ? toCall : tab === 'booked' ? booked : tab === 'done' ? done : closed
  const s = search.trim()
  const shown = s ? list.filter((v) => v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s)) : list
  const canEdit = p.can('hr.edit')

  return (
    <>
      <PageHeader
        title="الجداد"
        subtitle="التواصل مع المتطوعين الجداد، ومواعيد الانترفيو ونتايجها. كل خطوة بتتسجل في تاريخ المتطوع."
        actions={<JoinLink />}
      />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      <div className="relative mb-3 max-w-sm">
        <Search className="absolute start-3 top-2.5 size-5 text-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو الكود أو التليفون" className="ps-10" />
      </div>
      {tab === 'closed' && <p className="mb-3 text-xs text-muted">اللي رفض الانترفيو أو اترفض أو اتفصل أو اعتذر نهائي. بيرجع لوحده لو حالته اتغيرت من ملفه، أو بزرار «رجّعه للتواصل».</p>}
      {vols.isLoading || log.isLoading ? (
        <Spinner />
      ) : !shown.length ? (
        <Empty title={tab === 'call' ? 'مفيش حد مستني تواصل' : tab === 'booked' ? 'مفيش مواعيد انترفيو' : 'مفيش'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.slice(0, 200).map((v) => (
            <Person
              key={v.id}
              v={v}
              logs={log.data?.get(v.id) ?? []}
              acceptance={acceptance.get(v.id)?.acceptance ?? null}
              tab={tab}
              canEdit={canEdit}
              onCall={() => setCall(v)}
              onResult={() => setResult(v)}
            />
          ))}
          {shown.length > 200 && <p className="text-sm text-muted">بيظهر أول 200. استخدم البحث.</p>}
        </div>
      )}
      {call && <CallForm v={call} onClose={() => setCall(null)} />}
      {result && <ResultForm v={result} onClose={() => setResult(null)} />}
    </>
  )
}

function Person({
  v,
  logs,
  acceptance,
  tab,
  canEdit,
  onCall,
  onResult,
}: {
  v: V
  logs: Log[]
  acceptance: string | null
  tab: string
  canEdit: boolean
  onCall: () => void
  onResult: () => void
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const last = logs[0]
  const overdue = v.interview_at && v.interview_at.slice(0, 10) < cairoToday()
  const reopen = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('recruit_reopen', { p_volunteer: v.id, p_notes: null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('رجع لقايمة التواصل')
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['recruit-log'] })
    },
    onError: toastError,
  })
  return (
    <Card className={clsx(overdue && tab === 'booked' && 'border-orange-300')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <VolunteerName id={v.id} name={v.full_name_ar} className="block truncate font-bold" />
          <p className="text-xs text-muted">
            <span className="ltr">{v.code}</span> · اتسجل {fmtShort(v.registered_at)}
            {v.main_committee ? ` · ${v.main_committee}` : ''}
          </p>
        </div>
        {acceptance && <AcceptanceBadge value={acceptance} />}
      </div>
      <div className="mt-2">
        <ContactLinks phone={v.phone} whatsapp={v.whatsapp} />
      </div>
      {tab === 'booked' && v.interview_at && (
        <p className={clsx('mt-2 inline-flex items-center gap-1 text-sm font-semibold', overdue ? 'text-orange-700' : 'text-brand-800')}>
          <CalendarClock className="size-4" /> {fmtDateTime(v.interview_at)}
          {overdue && ' · فات، سجّل النتيجة'}
        </p>
      )}
      {last && (
        <p className="mt-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
          <span className="font-semibold">{last.outcome}</span> · {fmtShort(last.created_at)}
          {last.notes ? ` · ${last.notes}` : ''}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit && (tab === 'call' || tab === 'booked') && (
          <Button size="sm" variant={tab === 'call' ? 'primary' : 'secondary'} onClick={onCall}>
            <PhoneCall className="size-4" /> {tab === 'call' ? 'سجّل مكالمة' : 'غيّر الميعاد'}
          </Button>
        )}
        {canEdit && (tab === 'booked' || tab === 'call') && (
          <Button size="sm" variant={tab === 'booked' ? 'primary' : 'ghost'} onClick={onResult}>
            <UserCheck className="size-4" /> نتيجة الانترفيو
          </Button>
        )}
        {canEdit && (tab === 'closed' || tab === 'done') && (
          <Button size="sm" variant="secondary" loading={reopen.isPending} onClick={() => confirm(`ترجّع ${v.full_name_ar} لقايمة التواصل؟`) && reopen.mutate()}>
            <RotateCcw className="size-4" /> رجّعه للتواصل
          </Button>
        )}
        {logs.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            <History className="size-4" /> التاريخ ({logs.length})
          </Button>
        )}
      </div>
      {open && <RecruitHistory logs={logs} />}
    </Card>
  )
}

const KIND = { call: 'مكالمة', interview: 'انترفيو', reopen: 'رجوع' } as const

/** Every step, newest first, with the result they had before it. */
export function RecruitHistory({ logs }: { logs: Log[] }) {
  const vols = useVolunteers()
  const name = (id: string | null) => (id ? vols.data?.find((x) => x.id === id)?.full_name_ar : null)
  return (
    <ol className="mt-3 space-y-2 border-s-2 border-brand-100 ps-3">
      {logs.map((l) => (
        <li key={l.id} className="text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={l.kind === 'interview' ? 'purple' : l.kind === 'reopen' ? 'orange' : 'blue'}>{KIND[l.kind]}</Badge>
            <span className="font-semibold">{l.outcome}</span>
            <span className="text-xs text-muted">{fmtDateTime(l.created_at)}</span>
          </div>
          <p className="text-xs text-muted">
            {l.scheduled_at && l.kind === 'call' ? `الميعاد: ${fmtDateTime(l.scheduled_at)} · ` : ''}
            {l.interviewer_id ? `مع ${name(l.interviewer_id) ?? '—'} · ` : ''}
            {l.prev_acceptance ? `كان: ${l.prev_acceptance}` : 'من غير نتيجة قبلها'}
          </p>
          {l.notes && <p className="text-xs">{l.notes}</p>}
        </li>
      ))}
    </ol>
  )
}

function CallForm({ v, onClose }: { v: V; onClose: () => void }) {
  const qc = useQueryClient()
  const [outcome, setOutcome] = useState(v.recruit_status === 'ميعاد انترفيو' ? 'حدد ميعاد' : '')
  const [when, setWhen] = useState(v.interview_at ? new Date(v.interview_at).toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 16) : '')
  const [notes, setNotes] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      if (!outcome) throw { message: 'اختار نتيجة المكالمة' }
      const at = outcome === 'حدد ميعاد' && when ? new Date(`${when}:00+02:00`).toISOString() : null
      const { error } = await supabase.rpc('recruit_call', { p_volunteer: v.id, p_outcome: outcome, p_scheduled_at: at, p_notes: notes })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(outcome === 'حدد ميعاد' ? 'الميعاد اتسجل' : 'المكالمة اتسجلت')
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['recruit-log'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`مكالمة · ${v.full_name_ar}`}>
      <div className="space-y-4">
        <ContactLinks phone={v.phone} whatsapp={v.whatsapp} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CALL_OUTCOMES.map((o) => (
            <label key={o.value} className={clsx('flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2', outcome === o.value ? 'border-brand-500 bg-brand-50' : 'border-line')}>
              <input type="radio" name="outcome" className="mt-1 size-4 accent-brand-700" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
              <span>
                <span className="block text-sm font-semibold">{o.value}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {outcome === 'حدد ميعاد' && (
          <Field label="ميعاد الانترفيو">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        )}
        <Field label="ملاحظات (اختياري)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="مثلاً: هيرد بعد الامتحانات" />
        </Field>
        <Button className="w-full" loading={save.isPending} disabled={!outcome || (outcome === 'حدد ميعاد' && !when)} onClick={() => save.mutate()}>
          حفظ
        </Button>
      </div>
    </Modal>
  )
}

function ResultForm({ v, onClose }: { v: V; onClose: () => void }) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const [res, setRes] = useState('')
  const [date, setDate] = useState(v.interview_at ? new Date(v.interview_at).toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 10) : cairoToday())
  const [interviewer, setInterviewer] = useState<string | null>(me?.volunteer_id ?? null)
  const [notes, setNotes] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      if (!res) throw { message: 'اختار النتيجة' }
      const { error } = await supabase.rpc('recruit_interview', { p_volunteer: v.id, p_result: res, p_date: date, p_interviewer: res === 'محضرش' ? null : interviewer, p_notes: notes })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(res === 'محضرش' ? 'رجع لقايمة التواصل' : 'النتيجة اتسجلت')
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['recruit-log'] })
      qc.invalidateQueries({ queryKey: ['volunteer_hr'] })
      qc.invalidateQueries({ queryKey: ['hr'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`نتيجة الانترفيو · ${v.full_name_ar}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {RESULTS.map((o) => (
            <label key={o.value} className={clsx('flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2', res === o.value ? 'border-brand-500 bg-brand-50' : 'border-line')}>
              <input type="radio" name="res" className="mt-1 size-4 accent-brand-700" checked={res === o.value} onChange={() => setRes(o.value)} />
              <span>
                <span className="block text-sm font-semibold">{o.value}</span>
                {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="تاريخ الانترفيو">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={cairoToday()} />
          </Field>
          {res !== 'محضرش' && (
            <Field label="القائم على المقابلة" hint="بتتحسبله مشاركة «انترفيو»">
              <VolunteerSelect value={interviewer} onChange={setInterviewer} />
            </Field>
          )}
        </div>
        <Field label="ملاحظات (اختياري)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <p className="text-xs text-muted">يوم {fmtDate(date)}</p>
        <Button className="w-full" loading={save.isPending} disabled={!res} onClick={() => save.mutate()}>
          حفظ النتيجة
        </Button>
      </div>
    </Modal>
  )
}

/** The public join form: copy or share its link. Whoever fills it lands in «للتواصل». */
function JoinLink() {
  const url = `${location.origin}${import.meta.env.BASE_URL}join`
  const text = `عايز تتطوع في نشاط دروس التقوية؟ سجّل بياناتك من هنا: ${url}`
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url)
          toast.success('لينك فورم التسجيل اتنسخ')
        }}
      >
        نسخ لينك فورم التسجيل
      </Button>
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">
        ابعته واتساب
      </a>
    </div>
  )
}

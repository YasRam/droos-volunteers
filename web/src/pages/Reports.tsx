import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, FileSpreadsheet, Link2, Send } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Field, Input, PageHeader, Spinner, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { cairoToday, fmtShort, useVolunteers } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { exportFollowup, seasonStart } from '@/lib/followupExport'
import { supabase } from '@/lib/supabase'
import { FAMILY_DAY, useMeetings } from './Meetings'

type Tab = 'eval' | 'meetings' | 'followup' | 'sheets'

type EvalRow = {
  day: string
  classes: number
  foundation: number
  content: number
  exam_primary: number
  exam_prep: number
  organizers: number
  admin: number
  meetings_desc: string | null
  meetings: number
  camps: number
  workshop_type: string | null
  workshops: number
  sports: number
  trips: number
  behavior: number
  religious: number
  quran: number
  calls: number
  media: number
  courses_type: string | null
  courses: number
  events: number
  other_type: string | null
  other: number
}

/** Same groups and columns as the «اقتراح» tab of the evaluation sheet. */
const EVAL_GROUPS: { group: string; cols: { key: keyof EvalRow; label: string; text?: boolean }[] }[] = [
  {
    group: 'تدريس',
    cols: [
      { key: 'classes', label: 'عدد الحصص' },
      { key: 'foundation', label: 'التأسيس' },
      { key: 'content', label: 'تحضير محتوى' },
      { key: 'exam_primary', label: 'امتحان ابتدائي' },
      { key: 'exam_prep', label: 'امتحان (أي سنة تانية)' },
    ],
  },
  { group: 'تنظيم', cols: [{ key: 'organizers', label: 'متطوعين التنظيم' }] },
  {
    group: 'HR وفريق العمل',
    cols: [
      { key: 'admin', label: 'اداريات وانترفيوهات' },
      { key: 'meetings_desc', label: 'الاجتماعات', text: true },
      { key: 'meetings', label: 'عدد الاجتماعات' },
      { key: 'camps', label: 'الكامبات' },
    ],
  },
  {
    group: 'ترفيهية',
    cols: [
      { key: 'workshop_type', label: 'نوع الورشة', text: true },
      { key: 'workshops', label: 'عدد الورش' },
      { key: 'sports', label: 'يوم رياضي' },
      { key: 'trips', label: 'رحلات' },
    ],
  },
  {
    group: 'دينية وسلوكية',
    cols: [
      { key: 'behavior', label: 'حصص السلوكية' },
      { key: 'religious', label: 'ندوات دينية' },
      { key: 'quran', label: 'تحفيظ القرآن' },
      { key: 'calls', label: 'اتصالات' },
    ],
  },
  { group: 'ميديا', cols: [{ key: 'media', label: 'كرنفالات ودعاية' }] },
  {
    group: 'علمية',
    cols: [
      { key: 'courses_type', label: 'نوع الكورس', text: true },
      { key: 'courses', label: 'عدد الكورسات' },
    ],
  },
  {
    group: 'أخرى',
    cols: [
      { key: 'events', label: 'ايفينتات' },
      { key: 'other_type', label: 'نوع الحدث', text: true },
      { key: 'other', label: 'العدد' },
    ],
  },
]

/** Ask the Google Apps Script to write a report into the linked sheet. */
async function sendToSheet(report: 'eval' | 'meetings', month: string) {
  const { data: urlRow } = await supabase.from('app_settings').select('value').eq('key', 'sheets_webapp_url').maybeSingle()
  const url = urlRow?.value as string | undefined
  if (!url) throw { message: 'الكتابة الفورية في الشيت محتاجة «لينك السكريبت» في «ربط الشيتات». من غيره الشيت بيتحدّث لوحده كل ساعة.' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw { message: 'ادخل الموقع تاني' }
  // text/plain keeps it a simple request (no CORS preflight), which Apps Script accepts
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ access_token: token, report, month }) })
  const out = (await res.json().catch(() => null)) as { ok: boolean; error?: string; url?: string; rows?: number; tab?: string } | null
  if (!out?.ok) throw { message: out?.error ?? 'السكريبت مردش' }
  return out
}

function SendButton({ report, month, label }: { report: 'eval' | 'meetings'; month: string; label: string }) {
  const [link, setLink] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () => sendToSheet(report, month),
    onSuccess: (r) => {
      toast.success(`اتكتب في تابة «${r.tab}»`)
      setLink(r.url ?? null)
    },
    onError: toastError,
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => send.mutate()} loading={send.isPending}>
        <Send className="size-4" /> {label}
      </Button>
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700">
          <ExternalLink className="size-4" /> افتح الشيت
        </a>
      )}
    </div>
  )
}

export default function Reports() {
  const p = usePermissions()
  const [params, setParams] = useSearchParams()
  const tabs = [
    { value: 'eval' as Tab, label: 'التقييم الفني' },
    { value: 'meetings' as Tab, label: 'الاجتماعات' },
    { value: 'followup' as Tab, label: 'شيت المتابعة' },
    ...(p.can('settings.manage') ? [{ value: 'sheets' as Tab, label: 'ربط الشيتات' }] : []),
  ]
  const tab = (tabs.find((t) => t.value === params.get('tab'))?.value ?? 'eval') as Tab
  const [month, setMonth] = useState(cairoToday().slice(0, 7))
  return (
    <>
      <PageHeader title="التقارير" subtitle="التقارير اللي بتتبعت كل شهر، بنفس شكل الشيتات" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {(tab === 'eval' || tab === 'meetings') && (
        <Card className="mb-4 max-w-xs">
          <Field label="الشهر">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
        </Card>
      )}
      {tab === 'eval' && <EvalReport month={month} />}
      {tab === 'meetings' && <MeetingsReport month={month} />}
      {tab === 'followup' && <FollowupReport />}
      {tab === 'sheets' && <SheetLinks />}
    </>
  )
}

function EvalReport({ month }: { month: string }) {
  const q = useQuery({
    queryKey: ['report-eval', month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_eval', { p_month: month + '-01' })
      if (error) throw error
      return data as EvalRow[]
    },
  })
  const cols = EVAL_GROUPS.flatMap((g) => g.cols)
  const total = (k: keyof EvalRow) => (q.data ?? []).reduce((n, r) => n + (Number(r[k]) || 0), 0)
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">بيتحسب من المشاركات المقبولة. الحصة = نفس الحدث والمادة والسنة والمكان في اليوم، مهما كان عدد المتطوعين فيها.</p>
        <SendButton report="eval" month={month} label="اكتب في شيت التقييم" />
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="bg-surface">
              <tr>
                <th rowSpan={2} className="border border-line px-2 py-1">
                  التاريخ
                </th>
                {EVAL_GROUPS.map((g) => (
                  <th key={g.group} colSpan={g.cols.length} className="border border-line px-2 py-1 text-brand-800">
                    {g.group}
                  </th>
                ))}
              </tr>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className="border border-line px-2 py-1 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={r.day} className="even:bg-gray-50/60">
                  <td className="whitespace-nowrap border border-line px-2 py-1 font-semibold">{fmtShort(r.day)}</td>
                  {cols.map((c) => (
                    <td key={c.key} className={`border border-line px-2 py-1 ${c.text ? 'max-w-40 truncate' : 'text-center'} ${!c.text && !r[c.key] ? 'text-gray-300' : ''}`}>
                      {r[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-brand-50 font-bold">
                <td className="border border-line px-2 py-1">المجموع</td>
                {cols.map((c) => (
                  <td key={c.key} className="border border-line px-2 py-1 text-center">
                    {c.text ? '' : total(c.key)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-muted">
        كل حدث بيروح في عمود حسب إعداده في{' '}
        <Link to="/admin?tab=lists" className="text-brand-700">
          القوائم ← الحدث
        </Link>
        . اللي مالوش عمود بيروح في «أخرى».
      </p>
    </div>
  )
}

function MeetingsReport({ month }: { month: string }) {
  const q = useMeetings(month)
  const vols = useVolunteers()
  const head = (id: string | null, fallback: string | null) => (id ? vols.data?.find((v) => v.id === id)?.full_name_ar : null) ?? fallback ?? ''
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {q.data?.filter((m) => m.event !== FAMILY_DAY).length ?? 0} اجتماع في الشهر ده.{' '}
          <Link to="/meetings" className="text-brand-700">
            سجّل أو عدّل الاجتماعات
          </Link>
        </p>
        <SendButton report="meetings" month={month} label="اكتب في شيت الاجتماعات" />
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface text-xs">
              <tr>
                {['العدد', 'تاريخ الاجتماع', 'اللجنة', 'هيد الاجتماع', 'دوره', 'عدد الحاضرين', 'الهدف', 'الإنجازات', 'النوع'].map((h) => (
                  <th key={h} className="border border-line px-2 py-1">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...(q.data ?? [])].filter((m) => m.event !== FAMILY_DAY).reverse().map((m, i) => (
                <tr key={m.id}>
                  <td className="border border-line px-2 py-1 text-center">{i + 1}</td>
                  <td className="whitespace-nowrap border border-line px-2 py-1">{fmtShort(m.meeting_date)}</td>
                  <td className="border border-line px-2 py-1">{m.committee}</td>
                  <td className="border border-line px-2 py-1">{head(m.head_id, m.head_name)}</td>
                  <td className="border border-line px-2 py-1">{m.head_role ?? ''}</td>
                  <td className="border border-line px-2 py-1 text-center">{m.attendees.length + m.attendees_extra}</td>
                  <td className="border border-line px-2 py-1">{m.goal}</td>
                  <td className="border border-line px-2 py-1">{m.achievements}</td>
                  <td className="border border-line px-2 py-1">{m.meeting_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function FollowupReport() {
  const today = cairoToday()
  const [start, setStart] = useState(seasonStart(today).slice(0, 7))
  const [until, setUntil] = useState(today)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await exportFollowup(start + '-01', until)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(r.blob)
      a.download = r.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      toast.success(`اتنزّل: ${r.people} متطوع`)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="mt-0.5 size-6 shrink-0 text-brand-700" />
        <p className="text-sm text-muted">
          نفس ملف «دروس تقوية .. الاسكندرية» اللي بيتبعت كل نص شهر: نفس الأعمدة والألوان والمعادلات. كل يوم شارك فيه المتطوع بيتكتب 1 لو في الفرع، و2 لو من البيت أو أونلاين. الشيت فيه 6 شهور تبدأ من أول الموسم.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="أول شهر في الموسم">
          <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="لحد يوم" hint="للنص الأول من الشهر اختار يوم 15">
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </div>
      <Button onClick={run} loading={busy}>
        <Download className="size-4" /> تنزيل شيت المتابعة
      </Button>
      <p className="text-xs text-muted">المتابع والملاحظات وسبب الخروج بيتكتبوا من ملف كل متطوع ← الحالة والمقابلة ← المتابعة.</p>
    </Card>
  )
}

function SheetLinks() {
  const qc = useQueryClient()
  const keys = [
    { key: 'report_sheet_eval', label: 'شيت التقييم الفني', hint: 'لازم يكون فيه تابة «اقتراح»، والزرار بيعمل منها تابة لكل شهر' },
    { key: 'report_sheet_meetings', label: 'شيت الاجتماعات', hint: 'تابة لكل شهر (يناير، فبراير...)، ولو مش موجودة بتتعمل' },
    { key: 'sheets_webapp_url', label: 'لينك السكريبت', hint: 'من السكريبت: Deploy ← Web app، وانسخ اللينك اللي بيخلص بـ /exec' },
  ]
  const q = useQuery({
    queryKey: ['setting', 'report-sheets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys.map((k) => k.key))
      if (error) throw error
      return Object.fromEntries((data as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']))
    },
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: async () => {
      for (const [key, raw] of Object.entries(draft)) {
        const value = raw.trim() || null
        if (value && key !== 'sheets_webapp_url' && !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(value)) throw { message: 'لينك الشيت لازم يبدأ بـ https://docs.google.com/spreadsheets/' }
        if (value && key === 'sheets_webapp_url' && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(value)) throw { message: 'لينك السكريبت لازم يبدأ بـ https://script.google.com/macros/s/ ويخلص بـ /exec' }
        const { error } = await supabase.from('app_settings').upsert({ key, value })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['setting'] })
    },
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  return (
    <Card className="max-w-3xl space-y-4">
      <p className="text-sm text-muted">الشيتات دي بتاعتكم على جوجل درايف. الزرار بيكتب فيها هي نفسها، في تابة الشهر.</p>
      {keys.map((k) => (
        <Field key={k.key} label={k.label} hint={k.hint}>
          <div className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0 text-muted" />
            <Input dir="ltr" value={draft[k.key] ?? q.data?.[k.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k.key]: e.target.value }))} />
            {(q.data?.[k.key] ?? '') && k.key !== 'sheets_webapp_url' && (
              <a href={q.data?.[k.key]} target="_blank" rel="noreferrer" className="shrink-0 text-brand-700" aria-label="افتح">
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        </Field>
      ))}
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(draft).length}>
        حفظ
      </Button>
    </Card>
  )
}

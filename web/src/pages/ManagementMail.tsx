import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, MailWarning, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, PageHeader, Spinner, Tabs, Textarea, Toggle } from '@/components/ui'
import { VolunteerChips } from '@/components/VolunteerPick'
import { fmtShort } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Kind = 'access' | 'updates' | 'requests'
type Tab = Kind | 'settings' | 'log'

type MailSettings = {
  enabled: boolean
  management_email: string | null
  followup_subject: string
  followup_body: string
  edits_body: string
  access_subject: string | null
  updates_subject: string | null
  requests_subject: string | null
  error_email: string | null
}
type ThreadInfo = { subject: string; last: string; messages: number } | null
type LogRow = { id: number; kind: string; subject: string | null; ok: boolean; error: string | null; rows: number | null; sent_by: string | null; sent_at: string }

const KIND_LABEL: Record<string, string> = {
  followup: 'المتابعة اليومية',
  meetings: 'الاجتماعات',
  edits: 'التعديلات',
  access: 'الأكسس',
  updates: 'التطورات',
  requests: 'الطلبات',
}

/** The Apps Script (on droosmng@gmail.com) sends; the site only asks it to. */
async function askScript<T>(payload: Record<string, unknown>): Promise<T> {
  const { data: urlRow } = await supabase.from('app_settings').select('value').eq('key', 'sheets_webapp_url').maybeSingle()
  const url = urlRow?.value as string | undefined
  if (!url) throw { message: 'محتاج «لينك السكريبت» في التقارير ← ربط الشيتات.' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw { message: 'ادخل الموقع تاني' }
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ access_token: token, ...payload }) })
  const out = (await res.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null
  if (!out?.ok) throw { message: out?.error ?? 'السكريبت مردش' }
  return out
}

function useMailSettings() {
  return useQuery({
    queryKey: ['mail-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('mail_settings').select('*').single()
      if (error) throw error
      return data as MailSettings
    },
  })
}

export default function ManagementMail() {
  const [tab, setTab] = useState<Tab>('access')
  const tabs = [
    { value: 'access' as Tab, label: 'الأكسس' },
    { value: 'updates' as Tab, label: 'التطورات' },
    { value: 'requests' as Tab, label: 'الطلبات' },
    { value: 'log' as Tab, label: 'اللي اتبعت' },
    { value: 'settings' as Tab, label: 'الإعدادات' },
  ]
  return (
    <>
      <PageHeader
        title="إيميلات الإدارة"
        subtitle="بتتبعت من droosmng@gmail.com «رد على الكل» على إيميل الإدارة نفسه. المتابعة اليومية بتتبعت لوحدها كل يوم الفجر، والتعديلات آخر اليوم."
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'settings' && <MailSettingsForm />}
      {tab === 'log' && <MailLog />}
      {(tab === 'access' || tab === 'updates' || tab === 'requests') && <Compose kind={tab} key={tab} />}
    </>
  )
}

/** Which of the management's emails the script would answer, right now. */
function ThreadCheck({ kind }: { kind: Kind | 'followup' }) {
  const q = useQuery({
    queryKey: ['mail-threads'],
    queryFn: () => askScript<{ threads: Record<string, ThreadInfo>; account: string }>({ report: 'mail_check' }),
    staleTime: 60_000,
    retry: false,
  })
  if (q.isLoading) return <p className="text-sm text-muted">بندوّر على إيميل الإدارة…</p>
  if (q.error) return <p className="text-sm text-red-700">{(q.error as { message?: string }).message}</p>
  const t = q.data?.threads[kind]
  return (
    <div className="flex items-start gap-2 rounded-xl bg-surface p-3 text-sm">
      {t ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700" /> : <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-700" />}
      <div className="min-w-0 flex-1">
        {t ? (
          <>
            هيترد على: <span className="font-semibold">{t.subject}</span>
            <span className="block text-xs text-muted">
              {t.messages} رسالة · آخر واحدة {fmtShort(t.last.slice(0, 10))} · من {q.data?.account}
            </span>
          </>
        ) : (
          <>ملقيناش إيميل الإدارة بالعنوان اللي في الإعدادات في {q.data?.account}.</>
        )}
      </div>
      <button type="button" onClick={() => q.refetch()} className="text-brand-700" aria-label="دوّر تاني">
        <RefreshCw className="size-4" />
      </button>
    </div>
  )
}

function Compose({ kind }: { kind: Kind }) {
  const qc = useQueryClient()
  const [ids, setIds] = useState<string[]>([])
  const [text, setText] = useState('')
  const send = useMutation({
    mutationFn: () => askScript<{ subject: string }>({ report: `mail_${kind}`, ids, note: text, text }),
    onSuccess: (r) => {
      toast.success(`اتبعت على «${r.subject}»`)
      setIds([])
      setText('')
      qc.invalidateQueries({ queryKey: ['mail-log'] })
    },
    onError: toastError,
  })
  const ready = kind === 'access' ? ids.length > 0 : text.trim().length > 0
  return (
    <Card className="max-w-3xl space-y-4">
      <ThreadCheck kind={kind} />
      {kind === 'access' ? (
        <>
          <Field label="المتطوعين اللي ليهم أكسس على المكان" hint="بيتبعت جدول فيه الاسم والرقم واللجنة">
            <VolunteerChips value={ids} onChange={setIds} />
          </Field>
          <Field label="كلمة قبل الجدول (اختياري)">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label={kind === 'updates' ? 'التطورات' : 'الطلبات'}>
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      <Button
        onClick={() => {
          if (window.confirm('هيتبعت للإدارة «رد على الكل». متأكد؟')) send.mutate()
        }}
        loading={send.isPending}
        disabled={!ready}
      >
        <Send className="size-4" /> ابعت للإدارة
      </Button>
    </Card>
  )
}

function MailSettingsForm() {
  const qc = useQueryClient()
  const q = useMailSettings()
  const [draft, setDraft] = useState<Partial<MailSettings>>({})
  const save = useMutation({
    mutationFn: async () => {
      const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))
      if (clean.followup_subject === null) throw { message: 'عنوان إيميل المتابعة مطلوب' }
      const { error } = await supabase.from('mail_settings').update(clean).eq('id', true)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['mail-settings'] })
      qc.invalidateQueries({ queryKey: ['mail-threads'] })
    },
    onError: toastError,
  })
  if (q.isLoading || !q.data) return <Spinner />
  const v = { ...q.data, ...draft }
  const set = (k: keyof MailSettings) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  return (
    <Card className="max-w-3xl space-y-4">
      <Toggle
        checked={v.enabled}
        onChange={(on: boolean) => setDraft((d) => ({ ...d, enabled: on }))}
        label="المتابعة اليومية والتعديلات بيتبعتوا لوحدهم"
      />
      <Field label="عنوان إيميل المتابعة الشهري" hint="{month} و{year} بيتبدلوا بشهر الحدث، زي «… 11/2026». كل شهر بيروح على إيميله.">
        <Input value={v.followup_subject ?? ''} onChange={set('followup_subject')} />
      </Field>
      <ThreadCheck kind="followup" />
      <Field label="الرسالة مع ملف المتابعة">
        <Input value={v.followup_body ?? ''} onChange={set('followup_body')} />
      </Field>
      <Field label="الرسالة مع ملف التعديلات">
        <Input value={v.edits_body ?? ''} onChange={set('edits_body')} />
      </Field>
      <Field label="عنوان إيميل الأكسس">
        <Input value={v.access_subject ?? ''} onChange={set('access_subject')} />
      </Field>
      <Field label="عنوان إيميل التطورات">
        <Input value={v.updates_subject ?? ''} onChange={set('updates_subject')} />
      </Field>
      <Field label="عنوان إيميل الطلبات">
        <Input value={v.requests_subject ?? ''} onChange={set('requests_subject')} />
      </Field>
      <Field label="إيميل الإدارة (اختياري)" hint="لو اتكتب، بيدوّر بس في الإيميلات اللي جاية منه">
        <Input dir="ltr" value={v.management_email ?? ''} onChange={set('management_email')} />
      </Field>
      <Field label="لو الإيميل مش موجود، يبلّغ مين" hint="بيوصله إيميل إن المتابعة مستنية">
        <Input dir="ltr" value={v.error_email ?? ''} onChange={set('error_email')} />
      </Field>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(draft).length}>
        حفظ
      </Button>
    </Card>
  )
}

function MailLog() {
  const q = useQuery({
    queryKey: ['mail-log'],
    queryFn: async () => {
      const { data, error } = await supabase.from('mail_log').select('id, kind, subject, ok, error, rows, sent_by, sent_at').order('sent_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as LogRow[]
    },
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Card className="max-w-3xl text-sm text-muted">لسه مفيش إيميلات اتبعتت.</Card>
  return (
    <Card className="max-w-4xl overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs text-muted">
          <tr>
            <th className="p-2 text-start">إمتى</th>
            <th className="p-2 text-start">النوع</th>
            <th className="p-2 text-start">العدد</th>
            <th className="p-2 text-start">مين</th>
            <th className="p-2 text-start">الحالة</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="p-2 whitespace-nowrap">{new Date(r.sent_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="p-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
              <td className="p-2">{r.rows ?? '—'}</td>
              <td className="p-2">{r.sent_by ?? 'لوحده'}</td>
              <td className="p-2">{r.ok ? <span className="text-green-700">اتبعت</span> : <span className="text-red-700">{r.error ?? 'فشل'}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

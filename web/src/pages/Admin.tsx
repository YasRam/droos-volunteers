import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, CircleAlert, CircleCheck, Download, Eye, Upload, EyeOff, HardDrive, Link2, Lock, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { fmtDateTime } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { RulesEditor } from '@/components/Rules'
import { usePermissions } from '@/lib/auth'
import { DataSection } from '@/pages/DataTools'
import { useSearchParams } from 'react-router-dom'
import { locale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { Lookup } from '@/lib/types'

type Tab = 'lists' | 'groups' | 'stages' | 'data'

export default function Admin() {
  const p = usePermissions()
  const [params, setParams] = useSearchParams()
  const tabs = [
    ...(p.can('settings.manage') ? [{ value: 'lists' as Tab, label: 'القوائم' }, { value: 'groups' as Tab, label: 'جروبات الواتساب' }] : []),
    ...(p.can('stages.manage') || p.can('rules.manage') ? [{ value: 'stages' as Tab, label: 'مراحل التطوع والقواعد' }] : []),
    ...(p.can('data.export') || p.can('backup.manage') || p.can('settings.manage') ? [{ value: 'data' as Tab, label: 'البيانات والنسخ الاحتياطية' }] : []),
  ]
  const tab = (tabs.find((t) => t.value === params.get('tab'))?.value ?? tabs[0]?.value) as Tab
  return (
    <>
      <PageHeader title={p.can('settings.manage') ? 'الإعدادات' : 'البيانات'} subtitle="القوايم، وجروبات الواتساب، وتنزيل البيانات والنسخ الاحتياطية" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />
      {tab === 'lists' && <Lists />}
      {tab === 'groups' && <Groups />}
      {tab === 'stages' && (p.can('stages.manage') ? <StagesSettings withRules={p.can('rules.manage')} /> : <RulesEditor />)}
      {tab === 'data' && (
        <div className="space-y-6">
          {p.can('data.export') && (
            <section>
              <h2 className="mb-2 font-bold">Excel</h2>
              <DataSection />
            </section>
          )}
          {p.can('backup.manage') && (
            <section>
              <h2 className="mb-2 font-bold">نسخة احتياطية من الموقع</h2>
              <SiteBackup />
            </section>
          )}
          {p.can('settings.manage') && (
            <section>
              <h2 className="mb-2 font-bold">النسخ اليومي على جوجل درايف</h2>
              <Backups />
            </section>
          )}
        </div>
      )}
    </>
  )
}

function useAllLookups() {
  return useQuery({
    queryKey: ['admin', 'lookups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lookups').select('*').order('sort_order').order('value')
      if (error) throw error
      return data as Lookup[]
    },
  })
}

// Status lists are database enums: renaming changes every record, delete only hides.
const ENUM_LISTS = new Set(['حالة المتطوع', 'حالة القبول'])
// Values the app's own rules depend on (filters, the 3-month test, the tree).
const LOCKED: Record<string, string[]> = { 'حالة المتطوع': ['تحت المتابعة', 'خارج المتابعة'], 'حالة القبول': ['اختبار', 'مقبول'] }
const isLocked = (r: Lookup) => LOCKED[r.list]?.includes(r.value) ?? false
const LIST_HINT: Record<string, string> = {
  اللجنة: 'لجان النشاط. التغيير هنا بيتطبق على المتطوعين وليدر اللجان.',
  الحدث: 'أنواع الأنشطة، ومع كل واحد بتختار الخانات اللي بيطلبها.',
  'نوع الحدث': 'المواد وأنواع الأنشطة. بيتضاف لوحده لما حد يسجّل نوع جديد ويتقبل.',
  'السنة الدراسية': 'سنين الطلاب في التدريس والجدول.',
  المكان: 'أماكن الأنشطة.',
  'القائم على المقابلة': 'اللي بيعملوا المقابلات.',
  'حالة المتطوع': 'حالات المتطوعين. تغيير الاسم بيغيّره في كل المتطوعين. القيم اللي عليها قفل السيستم بيعتمد عليها.',
  'نوع الحصة': 'أنواع الحصص في الجدول (حصة، تأسيس، ورشة ثابتة...).',
  'لمين': 'الحصة لمين (الكل، بنات بس، ولاد بس...).',
  'سبب الخروج': 'أسباب الخروج من المتابعة (عمود «الأعمدة» في شيت المتابعة).',
  'السنة الدراسية للمتطوع': 'سنة المتطوع الدراسية (طالب، خريج...).',
  'حالة القبول': 'درجات القبول في المقابلة. تغيير الاسم بيغيّره في كل الملفات. القيم اللي عليها قفل السيستم بيعتمد عليها.',
}
// Which column of the evaluation sheet («اقتراح») an event counts in
const REPORT_COLUMNS: Record<string, string> = {
  classes: 'عدد الحصص',
  foundation: 'حصص التأسيس',
  content: 'تحضير محتوى',
  exam: 'امتحانات شهرية',
  organizers: 'متطوعين التنظيم',
  admin: 'اداريات وانترفيوهات',
  meetings: 'الاجتماعات',
  camps: 'الكامبات',
  workshop: 'ورشة فنية',
  sports: 'يوم رياضي',
  trips: 'رحلات',
  behavior: 'حصص السلوكية',
  religious: 'ندوات دينية',
  quran: 'تحفيظ القرآن',
  calls: 'اتصالات',
  media: 'كرنفالات ودعاية',
  courses: 'كورسات',
  events: 'ايفينتات',
}
const FORM_LABEL = { teaching: 'مادة + سنة + عدد طلاب', optional: 'نوع حدث اختياري', none: 'من غير نوع حدث', calls: 'عدد المكالمات ومدتها' } as const

function Lists() {
  const qc = useQueryClient()
  const q = useAllLookups()
  const listNames = useMemo(() => {
    const names = [...new Set((q.data ?? []).map((r) => r.list))]
    return names.sort((a, b) => a.localeCompare(b, 'ar'))
  }, [q.data])
  const [picked, setPicked] = useState('')
  const current = picked || listNames[0] || ''
  const rows = (q.data ?? []).filter((r) => r.list === current)
  // Move a value up or down: renumber the whole list so the order is always clean
  const swap = async (list: Lookup[], i: number, dir: -1 | 1) => {
    const order = [...list]
    const [x] = order.splice(i, 1)
    order.splice(i + dir, 0, x)
    const changed = order.map((r, k) => ({ id: r.id, sort_order: (k + 1) * 10 })).filter((r, k) => order[k].sort_order !== r.sort_order)
    for (const c of changed) {
      const { error } = await supabase.from('lookups').update({ sort_order: c.sort_order }).eq('id', c.id)
      if (error) return toastError(error)
    }
    refresh()
  }
  const events = (q.data ?? []).filter((r) => r.list === 'الحدث').map((r) => r.value)
  const [value, setValue] = useState('')
  const [parent, setParent] = useState('')
  const [editing, setEditing] = useState<Lookup | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'lookups'] })
    qc.invalidateQueries({ queryKey: ['lookups'] })
  }

  const add = useMutation({
    mutationFn: async () => {
      if (!value.trim()) throw { message: 'اكتب القيمة' }
      const sort = Math.max(0, ...rows.map((r) => r.sort_order)) + 1
      const { error } = await supabase
        .from('lookups')
        .insert({ list: current, value: value.trim(), parent: parent || null, sort_order: sort, form: current === 'الحدث' ? 'optional' : null })
      if (error) throw error
    },
    onSuccess: () => {
      setValue('')
      toast.success('اتضافت')
      refresh()
    },
    onError: (e) => toastError((e as { code?: string }).code === '23505' ? { message: 'القيمة دي موجودة قبل كده' } : e),
  })
  const patch = async (r: Lookup, change: Partial<Lookup>) => {
    const { error } = await supabase.from('lookups').update(change).eq('id', r.id)
    if (error) toastError(error)
    else refresh()
  }

  if (q.isLoading) return <Spinner />
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      {/* list picker: chips on phones, a side list on desktop */}
      <Card className="h-fit p-2">
        <div className="flex gap-1.5 overflow-x-auto lg:flex-col">
          {listNames.map((n) => (
            <button
              key={n}
              onClick={() => {
                setPicked(n)
                setParent('')
              }}
              className={clsx(
                'flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm font-semibold',
                n === current ? 'bg-brand-700 text-white' : 'hover:bg-surface',
              )}
            >
              <span className="flex items-center gap-1.5">
                {n}
              </span>
              <span className={clsx('text-xs', n === current ? 'opacity-80' : 'text-muted')}>{(q.data ?? []).filter((r) => r.list === n).length}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="min-w-0 space-y-3">
        <Card>
          <p className="font-bold">{current}</p>
          <p className="text-xs text-muted">{LIST_HINT[current] ?? 'قيم بتظهر في الاختيارات.'}</p>
          {(
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="قيمة جديدة" onKeyDown={(e) => e.key === 'Enter' && add.mutate()} />
              </div>
              {current === 'نوع الحدث' && (
                <div className="w-44">
                  <Select value={parent} onChange={(e) => setParent(e.target.value)} placeholder="تبع أي حدث؟" options={events} />
                </div>
              )}
              <Button onClick={() => add.mutate()} loading={add.isPending}>
                <Plus className="size-4" /> إضافة
              </Button>
            </div>
          )}
        </Card>

        <Card className="divide-y divide-line p-0">
          {rows.map((r, i) => (
            <div key={r.id} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5', !r.is_active && 'bg-gray-50')}>
              <div className="flex flex-col">
                <button onClick={() => swap(rows, i, -1)} disabled={i === 0} className="text-muted disabled:opacity-30" aria-label="لفوق" title="لفوق">
                  <ArrowUp className="size-4" />
                </button>
                <button onClick={() => swap(rows, i, 1)} disabled={i === rows.length - 1} className="text-muted disabled:opacity-30" aria-label="لتحت" title="لتحت">
                  <ArrowDown className="size-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <p className={clsx('flex items-center gap-1.5 truncate font-semibold', !r.is_active && 'text-muted line-through')}>
                  {isLocked(r) && <Lock className="size-3.5 shrink-0 text-muted" aria-label="ثابتة" />}
                  {r.value}
                </p>
                <div className="flex flex-wrap gap-1 text-xs">
                  {r.parent && <Badge>تبع {r.parent}</Badge>}
                  {current === 'اللجنة' && r.link && (
                    <Badge tone="green">
                      <MessageCircle className="me-1 inline size-3" />
                      ليها جروب
                    </Badge>
                  )}
                  {!r.is_active && <Badge>مخفية من الاختيارات</Badge>}
                </div>
              </div>
              {current === 'الحدث' && (
                <Select
                  className="w-48"
                  value={r.form ?? 'optional'}
                  onChange={(e) => patch(r, { form: e.target.value as Lookup['form'] })}
                  options={Object.entries(FORM_LABEL).map(([v, label]) => ({ value: v, label }))}
                  aria-label="الخانات المطلوبة"
                />
              )}
              {current === 'الحدث' && (
                <Select
                  className="w-44"
                  value={r.report_column ?? ''}
                  onChange={(e) => patch(r, { report_column: e.target.value || null })}
                  placeholder="شيت التقييم: أخرى"
                  options={Object.entries(REPORT_COLUMNS).map(([v, label]) => ({ value: v, label: `شيت التقييم: ${label}` }))}
                  aria-label="عمود شيت التقييم"
                />
              )}
              {!isLocked(r) && (
                <div className="flex items-center">
                  <Button variant="ghost" size="sm" onClick={() => patch(r, { is_active: !r.is_active })} title={r.is_active ? 'إخفاء من الاختيارات' : 'إظهار في الاختيارات'} aria-label="إخفاء أو إظهار">
                    {r.is_active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)} title="تعديل أو مسح" aria-label="تعديل">
                    <Pencil className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
        {(
          <p className="text-xs text-muted">
            <EyeOff className="inline size-3.5" /> الإخفاء بيشيل القيمة من الاختيارات بس. والمسح كمان مش بيمسح حاجة من البيانات المتسجلة: اللي اتسجل بيها بيفضل زي ما هو.
          </p>
        )}
      </div>
      {editing && <EditValue row={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </div>
  )
}

function EditValue({ row, onClose, onDone }: { row: Lookup; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(row.value)
  const [updateData, setUpdateData] = useState(true)
  const usage = useQuery({
    queryKey: ['lookup-usage', row.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('lookup_usage', { p_id: row.id })
      if (error) throw error
      return Number(data ?? 0)
    },
  })
  const rename = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('rename_lookup', { p_id: row.id, p_value: value, p_update_data: updateData })
      if (error) throw error
      return Number((data as { rows: number }).rows)
    },
    onSuccess: (n) => {
      toast.success(n && (updateData || ENUM_LISTS.has(row.list)) ? `اتغيّرت، و${n} سجل اتحدّث` : 'اتغيّرت')
      onDone()
      onClose()
    },
    onError: toastError,
  })
  const [deleting, setDeleting] = useState(false)
  const [moveTo, setMoveTo] = useState('')
  const siblings = useAllLookups().data?.filter((x) => x.list === row.list && x.id !== row.id && x.is_active).map((x) => x.value) ?? []
  const remove = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('delete_lookup', { p_id: row.id, p_replace_with: moveTo || null })
      if (error) throw error
      return Number((data as { rows: number } | null)?.rows ?? 0)
    },
    onSuccess: (moved) => {
      toast.success(moved ? `اتشالت، و${moved} سجل اتنقل لـ «${moveTo}»` : 'اتشالت من القايمة')
      onDone()
      onClose()
    },
    onError: toastError,
  })
  const n = usage.data ?? 0
  const isEnum = ENUM_LISTS.has(row.list)
  return (
    <Modal open onClose={onClose} title={`«${row.value}» في ${row.list}`}>
      <div className="space-y-4">
        <p className="rounded-xl bg-surface px-3 py-2 text-sm">{usage.isLoading ? 'بيعدّ...' : n ? `متسجلة في ${n} سجل في البيانات.` : 'مش مستخدمة في أي بيانات.'}</p>
        <Field label="الاسم الجديد">
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {isEnum && <p className="text-xs text-muted">الاسم الجديد هيتغيّر في كل البيانات مرة واحدة. والمسح هنا بيخفيها من الاختيارات بس.</p>}
        {n > 0 && !isEnum && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={updateData} onChange={(e) => setUpdateData(e.target.checked)} />
            <span>
              غيّرها كمان في الـ {n} سجل القديمة
              <span className="block text-xs text-muted">لو شلت العلامة، السجلات القديمة هتفضل بالاسم القديم.</span>
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" onClick={() => rename.mutate()} loading={rename.isPending} disabled={!value.trim() || value.trim() === row.value}>
            <Check className="size-4" /> حفظ الاسم
          </Button>
          <Button variant="secondary" className="text-red-600" onClick={() => setDeleting((d) => !d)}>
            <Trash2 className="size-4" /> {isEnum ? 'إخفاء' : 'مسح من القايمة'}
          </Button>
        </div>
        {deleting && (
          <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/50 p-3">
            {n > 0 ? (
              <>
                <p className="text-sm font-semibold">الـ {n} سجل اللي فيهم «{row.value}» يحصلهم إيه؟</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="del" className="size-4 accent-brand-700" checked={!moveTo} onChange={() => setMoveTo('')} />
                  يفضلوا زي ما هما بالاسم القديم
                </label>
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="radio" name="del" className="size-4 accent-brand-700" checked={Boolean(moveTo)} onChange={() => setMoveTo(siblings[0] ?? '')} disabled={!siblings.length} />
                  يتنقلوا لـ
                  <Select className="w-48" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} placeholder="اختار..." options={siblings} disabled={!siblings.length} />
                </label>
              </>
            ) : (
              <p className="text-sm">مش مستخدمة في أي بيانات، فمفيش حاجة هتتأثر.</p>
            )}
            <Button className="w-full bg-red-600 hover:bg-red-700" loading={remove.isPending} onClick={() => remove.mutate()}>
              {isEnum ? 'إخفاء' : 'مسح'} «{row.value}»
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Groups() {
  const qc = useQueryClient()
  const lookups = useAllLookups()
  const general = useQuery({
    queryKey: ['setting', 'whatsapp_group_link'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'whatsapp_group_link').maybeSingle()
      if (error) throw error
      return (data?.value as string | null) ?? ''
    },
  })
  const team = useQuery({
    queryKey: ['setting', 'team_group_link'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'team_group_link').maybeSingle()
      if (error) throw error
      return (data?.value as string | null) ?? ''
    },
  })
  const committees = (lookups.data ?? []).filter((r) => r.list === 'اللجنة' && r.value !== 'مسئول نشاط')
  const [draft, setDraft] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: async () => {
      for (const [key, v] of Object.entries(draft)) {
        const link = v.trim() || null
        if (link && !/^https:\/\/(chat\.whatsapp\.com|wa\.me)\//.test(link)) throw { message: 'اللينك لازم يبقى لينك جروب واتساب (chat.whatsapp.com)' }
        if (key === 'general' || key === 'team') {
          const { error } = await supabase.from('app_settings').upsert({ key: key === 'team' ? 'team_group_link' : 'whatsapp_group_link', value: link })
          if (error) throw error
        } else {
          const { error } = await supabase.from('lookups').update({ link }).eq('id', Number(key))
          if (error) throw error
        }
      }
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['setting'] })
      qc.invalidateQueries({ queryKey: ['admin', 'lookups'] })
      qc.invalidateQueries({ queryKey: ['lookups'] })
    },
    onError: toastError,
  })

  if (lookups.isLoading || general.isLoading || team.isLoading) return <Spinner />
  const row = (key: string, label: string, hint: string, current: string) => (
    <div key={key} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link2 className="size-4 shrink-0 text-muted" />
        <Input dir="ltr" placeholder="https://chat.whatsapp.com/..." value={draft[key] ?? current} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
        {(draft[key] ?? current) && (
          <button onClick={() => setDraft((d) => ({ ...d, [key]: '' }))} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="مسح اللينك">
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">كل متطوع بيشوف في الصفحة الرئيسية الجروب العام، وجروب لجنته الأساسية والفرعية. جروب فريق العمل بيظهر للمسئولين وليدر اللجان بس.</p>
      <Card className="divide-y divide-line p-0">
        {row('general', 'الجروب العام', 'لكل المتطوعين', general.data ?? '')}
        {row('team', 'فريق العمل', 'بيظهر لمشروع مسئول ومسئول وليدر اللجان بس', team.data ?? '')}
        {committees.map((c) => row(String(c.id), c.value, `لمتطوعين لجنة ${c.value}`, c.link ?? ''))}
      </Card>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(draft).length}>
        <Check className="size-4" /> حفظ اللينكات
      </Button>
    </div>
  )
}

type BackupRun = { id: number; at: string; ok: boolean; rows: number | null; bytes: number | null; file_name: string | null; error: string | null }

const SCRIPT_URL = 'https://github.com/YasRam/droos-volunteers/blob/main/backup/apps-script/Code.gs'

/** Daily copy of all data into the owner's Google Drive (via an Apps Script there). */
function Backups() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const linked = useQuery({
    queryKey: ['backup-linked'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('backup_linked')
      if (error) throw error
      return Boolean(data)
    },
  })
  const runs = useQuery({
    queryKey: ['backup-runs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('backup_runs').select('*').order('at', { ascending: false }).limit(15)
      if (error) throw error
      return data as BackupRun[]
    },
  })
  const link = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_backup_link', { p_hash: code })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتربط. أول نسخة هتتعمل الساعة 3 الفجر، أو شغّل backup من السكريبت دلوقتي')
      setCode('')
      qc.invalidateQueries({ queryKey: ['backup-linked'] })
    },
    onError: toastError,
  })
  const last = runs.data?.[0]
  const lastOk = runs.data?.find((r) => r.ok)
  const stale = !lastOk || Date.now() - new Date(lastOk.at).getTime() > 2 * 86_400_000
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <HardDrive className="mt-0.5 size-6 shrink-0 text-brand-700" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">نسخة كاملة كل يوم في جوجل درايف</p>
            <p className="mt-1 text-sm text-muted">
              كل البيانات (المتطوعين، المشاركات، المقابلات، الصلاحيات، السجل...) بتتحفظ في ملف في الدرايف بتاعك الساعة 3 الفجر. بيتحفظ آخر 30 يوم + أول نسخة في كل شهر، وصور البطايق بتتنسخ في فولدر لوحدها.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {linked.isLoading ? null : linked.data ? <Badge tone="green">مربوط</Badge> : <Badge tone="orange">لسه مش مربوط</Badge>}
              {lastOk && (
                <span className={clsx('flex items-center gap-1', stale ? 'text-orange-700' : 'text-emerald-700')}>
                  {stale ? <CircleAlert className="size-4" /> : <CircleCheck className="size-4" />} آخر نسخة ناجحة: {fmtDateTime(lastOk.at)}
                </span>
              )}
              {last && !last.ok && <span className="text-red-600">آخر محاولة فشلت</span>}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <p className="mb-2 font-bold">{linked.data ? 'تغيير الربط' : 'الربط (مرة واحدة)'}</p>
        <ol className="mb-3 list-decimal space-y-1 ps-5 text-sm text-muted">
          <li>
            افتح <a className="text-brand-700 underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">مشروع Apps Script جديد</a> بحساب جوجل اللي عايز النسخ تتحفظ فيه.
          </li>
          <li>
            امسح اللي فيه والصق <a className="text-brand-700 underline" href={SCRIPT_URL} target="_blank" rel="noreferrer">كود السكريبت</a>، واحفظ.
          </li>
          <li>اختار الدالة setup ودوس تشغيل، واقبل الصلاحيات.</li>
          <li>هيطبع «كود الربط» (64 حرف). الصقه هنا.</li>
        </ol>
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="كود الربط" dir="ltr" className="font-mono text-xs" />
          <Button onClick={() => link.mutate()} loading={link.isPending} disabled={code.trim().length !== 64}>
            <Link2 className="size-4" /> ربط
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">الكود ده بصمة مش كلمة سر، والسر نفسه بيفضل في السكريبت بس.</p>
      </Card>

      <Card className="p-0">
        <p className="border-b border-line px-4 py-3 font-bold">آخر المحاولات</p>
        {runs.isLoading ? (
          <Spinner />
        ) : !runs.data?.length ? (
          <p className="px-4 py-4 text-sm text-muted">لسه مفيش نسخ.</p>
        ) : (
          <div className="divide-y divide-line">
            {runs.data.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                {r.ok ? <CircleCheck className="size-4 text-emerald-600" /> : <CircleAlert className="size-4 text-red-600" />}
                <span className="font-semibold">{fmtDateTime(r.at)}</span>
                {r.ok ? (
                  <span className="text-muted">
                    {r.rows?.toLocaleString(locale)} صف · {r.bytes ? `${Math.round(r.bytes / 1024).toLocaleString(locale)} ك.ب` : ''}
                  </span>
                ) : (
                  <span className="text-red-600">{r.error}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

type BackupFile = { app: string; exported_at: string; exported_by?: string; rows: number; counts: Record<string, number>; tables: Record<string, unknown[]> }

const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 16).replace(' ', '_').replace(':', '')

async function downloadBackup(): Promise<number> {
  const { data, error } = await supabase.rpc('export_backup')
  if (error) throw error
  const text = JSON.stringify(data)
  const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(gz)
  a.download = `droos-backup-${stamp()}.json.gz`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return (data as BackupFile).rows
}

async function readBackup(file: File): Promise<BackupFile> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const stream = head[0] === 0x1f && head[1] === 0x8b ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream()
  const parsed = JSON.parse(await new Response(stream).text())
  if (parsed?.app !== 'droos-volunteers' || !parsed.tables) throw { message: 'الملف ده مش نسخة احتياطية من الموقع' }
  return parsed as BackupFile
}

const TABLE_LABEL: Record<string, string> = {
  volunteers: 'متطوع',
  participations: 'مشاركة',
  schedule_slots: 'حصة',
  staff_roles: 'صلاحية',
  certificate_requests: 'طلب شهادة',
  audit_log: 'سطر في السجل',
}

/** Download everything as one file, or put a downloaded file back. */
function SiteBackup() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const download = async () => {
    setBusy(true)
    try {
      const n = await downloadBackup()
      toast.success(`اتنزّلت نسخة فيها ${n.toLocaleString(locale)} صف`)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const pick = async (file?: File) => {
    if (!file) return
    try {
      setPending(await readBackup(file))
      setConfirmText('')
    } catch (e) {
      toastError(e)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const restore = useMutation({
    mutationFn: async () => {
      // Safety copy of what is there now, before replacing it.
      await downloadBackup()
      const { data, error } = await supabase.rpc('restore_backup', { p: pending })
      if (error) throw error
      return data as { counts: Record<string, number> }
    },
    onSuccess: (r) => {
      toast.success(`اترجعت النسخة: ${r.counts.volunteers ?? 0} متطوع و${r.counts.participations ?? 0} مشاركة`)
      setPending(null)
      qc.invalidateQueries()
    },
    onError: toastError,
  })

  return (
    <Card className="space-y-4">
      <p className="text-sm text-muted">
        ملف واحد فيه كل حاجة: المتطوعين والأرقام القومية والمقابلات والمشاركات والجدول والصلاحيات والسجل. نفس شكل نسخ جوجل درايف، فأي ملف منهم ينفع يترجع من هنا. فيه بيانات شخصية: احفظه في مكان آمن.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download} loading={busy}>
          <Download className="size-4" /> تنزيل نسخة احتياطية
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> استرجاع نسخة
        </Button>
        <input ref={fileRef} type="file" accept=".gz,.json,application/json,application/gzip" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {pending && (
        <Modal open onClose={() => !restore.isPending && setPending(null)} title="استرجاع نسخة احتياطية">
          <div className="space-y-4">
            <div className="rounded-xl bg-surface px-3 py-2 text-sm">
              <p className="font-semibold">النسخة دي اتعملت {fmtDateTime(pending.exported_at)}</p>
              <p className="mt-1 text-muted">
                {Object.entries(TABLE_LABEL)
                  .filter(([k]) => pending.tables[k])
                  .map(([k, label]) => `${(pending.tables[k]?.length ?? 0).toLocaleString(locale)} ${label}`)
                  .join(' · ')}
              </p>
            </div>
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              كل البيانات اللي في الموقع دلوقتي هتتشال وتتحط مكانها النسخة دي. أي حاجة اتسجلت بعد تاريخ النسخة هتضيع. قبل الاسترجاع هتنزل نسخة من الموجود دلوقتي لوحدها، عشان لو حبيت ترجع.
            </p>
            <Field label='اكتب «استرجاع» للتأكيد'>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </Field>
            <Button className="w-full bg-red-600 hover:bg-red-700" disabled={confirmText.trim() !== 'استرجاع'} loading={restore.isPending} onClick={() => restore.mutate()}>
              استرجع النسخة
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

type StageDef = { key: string; name: string; description: string | null; source: string; self_complete: boolean; sort_order: number; is_active: boolean; is_builtin: boolean }

const SOURCE_LABEL: Record<string, string> = {
  registered: 'بيتعلّم لوحده مع التسجيل',
  interview: 'بيتعلّم لما الـ HR يسجّل المقابلة',
  rules: 'المتطوع بيوافق على القواعد',
  joined_group: 'المتطوع أو ليدر اللجنة',
  committee_test: 'ليدر اللجنة بيعلّمه',
  tshirt: 'بيتعلّم لما طلب التيشيرت يتأكد',
  minicamp: 'بيتعلّم لما يحضر ميني كامب',
  first_activity: 'بيتعلّم مع أول مشاركة مقبولة',
  accepted: 'بيتعلّم لما درجة القبول تبقى «مقبول»',
  manual: 'يدوي',
}

/** The volunteer path: rename, reorder, hide, add stages; and the activity rules text. */
function StagesSettings({ withRules }: { withRules: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'stages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stages').select('*').order('sort_order')
      if (error) throw error
      return data as StageDef[]
    },
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'stages'] })
    qc.invalidateQueries({ queryKey: ['stages'] })
  }
  const patch = async (key: string, change: Partial<StageDef>) => {
    const { error } = await supabase.from('stages').update(change).eq('key', key)
    if (error) toastError(error)
    else refresh()
  }
  const [draft, setDraft] = useState({ name: '', description: '', self_complete: false })
  const add = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw { message: 'اكتب اسم المرحلة' }
      const sort = Math.max(0, ...(q.data ?? []).map((s) => s.sort_order)) + 10
      const { error } = await supabase.from('stages').insert({
        key: `custom_${Date.now()}`,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        source: 'manual',
        self_complete: draft.self_complete,
        sort_order: sort,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setDraft({ name: '', description: '', self_complete: false })
      toast.success('المرحلة اتضافت')
      refresh()
    },
    onError: toastError,
  })
  const move = (i: number, dir: -1 | 1) => {
    const list = q.data ?? []
    const a = list[i]
    const b = list[i + dir]
    if (!a || !b) return
    void Promise.all([patch(a.key, { sort_order: b.sort_order }), patch(b.key, { sort_order: a.sort_order })])
  }
  const remove = async (s: StageDef) => {
    if (!confirm(`تمسح مرحلة «${s.name}»؟`)) return
    const { error } = await supabase.from('stages').delete().eq('key', s.key)
    if (error) toastError(error)
    else refresh()
  }
  if (q.isLoading) return <Spinner />
  return (
    <div className="space-y-4">
      <Card className="p-0">
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          المراحل دي بتظهر لكل متطوع في الصفحة الرئيسية بالترتيب ده، وبيشوف اللي خلصه واللي فاضل. المراحل اليدوية بيعلّمها اللي معاه صلاحية مراحل التطوع من ملف المتطوع، أو المتطوع نفسه لو اخترت كده.
        </p>
        <div className="divide-y divide-line">
          {q.data?.map((s, i) => (
            <div key={s.key} className={clsx('flex flex-wrap items-center gap-2 px-4 py-2.5', !s.is_active && 'bg-gray-50 opacity-70')}>
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted disabled:opacity-30" aria-label="لفوق">
                  <ArrowUp className="size-4" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === (q.data?.length ?? 0) - 1} className="text-muted disabled:opacity-30" aria-label="لتحت">
                  <ArrowDown className="size-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1 basis-48">
                <Input defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && patch(s.key, { name: e.target.value.trim() })} className="h-9 font-semibold" />
                <Input
                  defaultValue={s.description ?? ''}
                  onBlur={(e) => e.target.value !== (s.description ?? '') && patch(s.key, { description: e.target.value.trim() || null })}
                  placeholder="وصف قصير"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <Badge>{SOURCE_LABEL[s.source] ?? s.source}</Badge>
              {s.source === 'manual' && (
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" className="size-4 accent-brand-700" checked={s.self_complete} onChange={(e) => patch(s.key, { self_complete: e.target.checked })} />
                  المتطوع يعلّمها بنفسه
                </label>
              )}
              <Button variant="ghost" size="sm" onClick={() => patch(s.key, { is_active: !s.is_active })} title={s.is_active ? 'إخفاء' : 'إظهار'} aria-label="إخفاء أو إظهار">
                {s.is_active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </Button>
              {!s.is_builtin && (
                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => remove(s)} aria-label="مسح">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <p className="mb-3 font-bold">مرحلة جديدة</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="مثلاً: دورة إسعافات أولية" />
          <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="وصف قصير (اختياري)" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-700" checked={draft.self_complete} onChange={(e) => setDraft({ ...draft, self_complete: e.target.checked })} />
            المتطوع يعلّمها بنفسه
          </label>
          <Button onClick={() => add.mutate()} loading={add.isPending}>
            <Plus className="size-4" /> إضافة
          </Button>
        </div>
      </Card>
      {withRules && <RulesEditor />}
    </div>
  )
}


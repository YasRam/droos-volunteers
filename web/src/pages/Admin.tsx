import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Eye, EyeOff, Link2, Lock, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Lookup } from '@/lib/types'

type Tab = 'lists' | 'groups'

export default function Admin() {
  const [tab, setTab] = useState<Tab>('lists')
  return (
    <>
      <PageHeader title="الإعدادات" subtitle="القوايم اللي بتظهر في الاختيارات، وجروبات الواتساب" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'lists', label: 'القوائم' },
          { value: 'groups', label: 'جروبات الواتساب' },
        ]}
      />
      {tab === 'lists' && <Lists />}
      {tab === 'groups' && <Groups />}
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

const FIXED = new Set(['حالة المتطوع', 'حالة القبول', 'اليوم'])
const LIST_HINT: Record<string, string> = {
  اللجنة: 'لجان النشاط. التغيير هنا بيتطبق على المتطوعين وليدر اللجان.',
  الحدث: 'أنواع الأنشطة، ومع كل واحد بتختار الخانات اللي بيطلبها.',
  'نوع الحدث': 'المواد وأنواع الأنشطة. بيتضاف لوحده لما حد يسجّل نوع جديد ويتقبل.',
  'السنة الدراسية': 'سنين الطلاب في التدريس والجدول.',
  المكان: 'أماكن الأنشطة.',
  'القائم على المقابلة': 'اللي بيعملوا المقابلات.',
}
const FORM_LABEL = { teaching: 'مادة + سنة + عدد طلاب', optional: 'نوع حدث اختياري', none: 'من غير نوع حدث' } as const

function Lists() {
  const qc = useQueryClient()
  const q = useAllLookups()
  const listNames = useMemo(() => {
    const names = [...new Set((q.data ?? []).map((r) => r.list))]
    return names.sort((a, b) => Number(FIXED.has(a)) - Number(FIXED.has(b)) || a.localeCompare(b, 'ar'))
  }, [q.data])
  const [picked, setPicked] = useState('')
  const current = picked || listNames[0] || ''
  const fixed = FIXED.has(current)
  const rows = (q.data ?? []).filter((r) => r.list === current)
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
                {FIXED.has(n) && <Lock className="size-3.5 opacity-70" />}
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
          <p className="text-xs text-muted">{fixed ? 'القايمة دي ثابتة في السيستم ومينفعش تتعدّل.' : LIST_HINT[current] ?? 'قيم بتظهر في الاختيارات.'}</p>
          {!fixed && (
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
          {rows.map((r) => (
            <div key={r.id} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5', !r.is_active && 'bg-gray-50')}>
              <div className="min-w-0 flex-1 basis-40">
                <p className={clsx('truncate font-semibold', !r.is_active && 'text-muted line-through')}>{r.value}</p>
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
              {!fixed && (
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
        {!fixed && (
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
      toast.success(updateData && n ? `اتغيّرت، و${n} سجل اتحدّث` : 'اتغيّرت')
      onDone()
      onClose()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_lookup', { p_id: row.id })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتمسحت من القايمة')
      onDone()
      onClose()
    },
    onError: toastError,
  })
  const n = usage.data ?? 0
  return (
    <Modal open onClose={onClose} title={`«${row.value}» في ${row.list}`}>
      <div className="space-y-4">
        <p className="rounded-xl bg-surface px-3 py-2 text-sm">{usage.isLoading ? 'بيعدّ...' : n ? `متسجلة في ${n} سجل في البيانات.` : 'مش مستخدمة في أي بيانات.'}</p>
        <Field label="الاسم الجديد">
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {n > 0 && (
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
          <Button
            variant="secondary"
            className="text-red-600"
            loading={remove.isPending}
            onClick={() => confirm(n ? `تمسح «${row.value}» من القايمة؟ الـ ${n} سجل القديمة هيفضلوا زي ما هما.` : `تمسح «${row.value}»؟`) && remove.mutate()}
          >
            <Trash2 className="size-4" /> مسح من القايمة
          </Button>
        </div>
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
  const committees = (lookups.data ?? []).filter((r) => r.list === 'اللجنة')
  const [draft, setDraft] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: async () => {
      for (const [key, v] of Object.entries(draft)) {
        const link = v.trim() || null
        if (link && !/^https:\/\/(chat\.whatsapp\.com|wa\.me)\//.test(link)) throw { message: 'اللينك لازم يبقى لينك جروب واتساب (chat.whatsapp.com)' }
        if (key === 'general') {
          const { error } = await supabase.from('app_settings').upsert({ key: 'whatsapp_group_link', value: link })
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

  if (lookups.isLoading || general.isLoading) return <Spinner />
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
      <p className="text-sm text-muted">كل متطوع بيشوف في الصفحة الرئيسية الجروب العام، وجروب لجنته الأساسية والفرعية.</p>
      <Card className="divide-y divide-line p-0">
        {row('general', 'الجروب العام', 'لكل المتطوعين', general.data ?? '')}
        {committees.map((c) => row(String(c.id), c.value, `لمتطوعين لجنة ${c.value}`, c.link ?? ''))}
      </Card>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(draft).length}>
        <Check className="size-4" /> حفظ اللينكات
      </Button>
    </div>
  )
}

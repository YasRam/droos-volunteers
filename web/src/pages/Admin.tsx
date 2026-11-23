import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Lookup } from '@/lib/types'

type Tab = 'lists' | 'settings'

export default function Admin() {
  const [tab, setTab] = useState<Tab>('lists')
  return (
    <>
      <PageHeader
        title="الإعدادات"
        actions={
          <Link to="/permissions">
            <Button variant="secondary">
              <Shield className="size-4" /> الصلاحيات
            </Button>
          </Link>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'lists', label: 'القوائم' },
          { value: 'settings', label: 'الإعدادات العامة' },
        ]}
      />
      {tab === 'lists' && <Lists />}
      {tab === 'settings' && <Settings />}
    </>
  )
}

function useTable<T>(table: string, order: string) {
  return useQuery({
    queryKey: ['admin', table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select('*').order(order)
      if (error) throw error
      return data as T[]
    },
  })
}

const LIST_HINT: Record<string, string> = {
  اللجنة: 'لو غيّرت اسم لجنة، المتطوعين وليدر اللجنة بيتنقلوا للاسم الجديد',
  الحدث: 'لو غيّرت اسم حدث، المشاركات القديمة بتتغير معاه',
  'نوع الحدث': 'الأنواع اللي بتتكتب في المشاركات بتتضاف هنا لوحدها',
}

function Lists() {
  const qc = useQueryClient()
  const q = useTable<Lookup>('lookups', 'sort_order')
  const all = q.data ?? []
  const listNames = useMemo(() => [...new Set(all.map((r) => r.list))].sort((a, b) => a.localeCompare(b, 'ar')), [all])
  const [list, setList] = useState('')
  const [filter, setFilter] = useState('')
  const current = list || listNames[0] || ''
  const rows = all.filter((r) => r.list === current && (!filter || r.value.includes(filter.trim()) || r.parent?.includes(filter.trim())))
  const parents = all.filter((r) => r.list === 'الحدث').map((r) => r.value)
  const [value, setValue] = useState('')
  const [parent, setParent] = useState('')
  const [editing, setEditing] = useState<{ id: number; value: string; parent: string } | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'lookups'] })
    qc.invalidateQueries({ queryKey: ['lookups'] })
    qc.invalidateQueries({ queryKey: ['volunteers'] })
  }
  const add = useMutation({
    mutationFn: async () => {
      if (!value.trim()) throw { message: 'اكتب القيمة' }
      const sort = Math.max(0, ...all.filter((r) => r.list === current).map((r) => r.sort_order)) + 1
      const { error } = await supabase.from('lookups').insert({ list: current, value: value.trim(), parent: parent || null, sort_order: sort })
      if (error) throw error
    },
    onSuccess: () => {
      setValue('')
      toast.success('اتضافت')
      refresh()
    },
    onError: toastError,
  })
  const saveEdit = useMutation({
    mutationFn: async (e: { id: number; value: string; parent: string }) => {
      const before = all.find((r) => r.id === e.id)
      if (!before) return
      if (e.value.trim() !== before.value) {
        const { error } = await supabase.rpc('rename_lookup', { p_id: e.id, p_value: e.value })
        if (error) throw error
      }
      if ((e.parent || null) !== before.parent) {
        const { error } = await supabase.from('lookups').update({ parent: e.parent || null }).eq('id', e.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      setEditing(null)
      toast.success('اتعدّلت')
      refresh()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async (r: Lookup) => {
      const { error } = await supabase.from('lookups').delete().eq('id', r.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتمسحت')
      refresh()
    },
    onError: toastError,
  })
  const patch = async (r: Lookup, change: Partial<Lookup>) => {
    const { error } = await supabase.from('lookups').update(change).eq('id', r.id)
    if (error) toastError(error)
    else refresh()
  }
  const move = async (idx: number, dir: -1 | 1) => {
    const ordered = all.filter((r) => r.list === current)
    const a = ordered[idx]
    const b = ordered[idx + dir]
    if (!a || !b) return
    const [x, y] = await Promise.all([
      supabase.from('lookups').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('lookups').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    if (x.error || y.error) toastError(x.error ?? y.error)
    else refresh()
  }
  if (q.isLoading) return <Spinner />
  const ordered = all.filter((r) => r.list === current)
  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
      <Card className="h-fit p-2">
        <p className="px-2 pb-2 pt-1 text-xs font-bold text-muted">القوائم</p>
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {listNames.map((n) => (
            <button
              key={n}
              onClick={() => {
                setList(n)
                setEditing(null)
                setFilter('')
              }}
              className={clsx(
                'flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm font-semibold',
                n === current ? 'bg-brand-700 text-white' : 'text-ink hover:bg-surface',
              )}
            >
              {n}
              <span className={clsx('text-xs', n === current ? 'text-white/80' : 'text-muted')}>{all.filter((r) => r.list === n).length}</span>
            </button>
          ))}
        </div>
      </Card>
      <div className="min-w-0 space-y-3">
        <div>
          <h2 className="text-lg font-bold">{current}</h2>
          {LIST_HINT[current] && <p className="text-xs text-muted">{LIST_HINT[current]}</p>}
        </div>
        <Card className="flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-48 flex-1">
            <Field label="قيمة جديدة">
              <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add.mutate()} />
            </Field>
          </div>
          {current === 'نوع الحدث' && (
            <div className="w-44">
              <Field label="تبع حدث">
                <Select value={parent} onChange={(e) => setParent(e.target.value)} placeholder="—" options={parents} />
              </Field>
            </div>
          )}
          <Button onClick={() => add.mutate()} loading={add.isPending}>
            <Plus className="size-4" /> إضافة
          </Button>
        </Card>
        {ordered.length > 8 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="دوّر في القائمة" />}
        <Card className="divide-y divide-line p-0">
          {!rows.length && <p className="px-4 py-6 text-center text-sm text-muted">مفيش قيم</p>}
          {rows.map((r) => {
            const idx = ordered.indexOf(r)
            return editing?.id === r.id ? (
              <div key={r.id} className="flex flex-wrap items-center gap-2 bg-brand-50/40 px-3 py-2">
                <Input className="min-w-40 flex-1" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveEdit.mutate(editing)} />
                {current === 'نوع الحدث' && (
                  <Select className="w-40" value={editing.parent} onChange={(e) => setEditing({ ...editing, parent: e.target.value })} placeholder="—" options={parents} />
                )}
                <Button size="sm" loading={saveEdit.isPending} onClick={() => saveEdit.mutate(editing)}>
                  <Check className="size-4" /> حفظ
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  إلغاء
                </Button>
              </div>
            ) : (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex flex-col">
                  <button disabled={idx <= 0 || Boolean(filter)} onClick={() => move(idx, -1)} className="text-muted hover:text-ink disabled:opacity-20" aria-label="لفوق">
                    <ChevronUp className="size-4" />
                  </button>
                  <button disabled={idx >= ordered.length - 1 || Boolean(filter)} onClick={() => move(idx, 1)} className="text-muted hover:text-ink disabled:opacity-20" aria-label="لتحت">
                    <ChevronDown className="size-4" />
                  </button>
                </div>
                <span className={clsx('min-w-0 flex-1 truncate', r.is_active ? 'font-semibold' : 'text-muted line-through')}>
                  {r.value}
                  {r.parent && <span className="ms-2 text-xs font-normal text-muted">({r.parent})</span>}
                </span>
                <button
                  onClick={() => patch(r, { is_active: !r.is_active })}
                  className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', r.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}
                  title={r.is_active ? 'اضغط عشان تخفيها من الاختيارات' : 'اضغط عشان تظهر تاني'}
                >
                  {r.is_active ? 'ظاهرة' : 'مخفية'}
                </button>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ id: r.id, value: r.value, parent: r.parent ?? '' })} aria-label="تعديل">
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600"
                  onClick={() => confirm(`تمسح «${r.value}» من القائمة؟ البيانات القديمة اللي فيها بتفضل زي ما هي.`) && remove.mutate(r)}
                  aria-label="مسح"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )
          })}
        </Card>
        <p className="text-xs text-muted">«مخفية» يعني مش بتظهر في الاختيارات بس. التعديل بيغيّر الاسم في البيانات كمان، والمسح بيشيلها من القائمة والبيانات القديمة بتفضل زي ما هي.</p>
      </div>
    </div>
  )
}

const SETTINGS = [
  { key: 'whatsapp_group_link', label: 'لينك جروب الواتساب', hint: 'بيظهر للمتطوعين في الصفحة الرئيسية', ltr: true },
  { key: 'branch_name', label: 'اسم الفرع', hint: undefined, ltr: false },
]

function Settings() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'app_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*')
      if (error) throw error
      return Object.fromEntries((data as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']))
    },
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(draft).map(([key, value]) => ({ key, value: value.trim() || null }))
      if (!rows.length) return
      const { error } = await supabase.from('app_settings').upsert(rows)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['admin', 'app_settings'] })
      qc.invalidateQueries({ queryKey: ['setting'] })
    },
    onError: toastError,
  })
  if (q.isLoading) return <Spinner />
  return (
    <Card className="space-y-4">
      {SETTINGS.map((s) => (
        <Field key={s.key} label={s.label} hint={s.hint}>
          <Input dir={s.ltr ? 'ltr' : undefined} value={draft[s.key] ?? q.data?.[s.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))} />
        </Field>
      ))}
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(draft).length}>
        حفظ
      </Button>
    </Card>
  )
}

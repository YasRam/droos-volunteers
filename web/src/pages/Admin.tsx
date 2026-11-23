import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, Tabs, Toggle } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ROLE_LABEL, type AppRole, type CommitteeLeader, type Lookup, type StaffRole } from '@/lib/types'

type Tab = 'staff' | 'leaders' | 'lists' | 'settings'

export default function Admin() {
  const [tab, setTab] = useState<Tab>('staff')
  return (
    <>
      <PageHeader title="الإدارة" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'staff', label: 'الصلاحيات' },
          { value: 'leaders', label: 'ليدر اللجان' },
          { value: 'lists', label: 'القوائم' },
          { value: 'settings', label: 'الإعدادات' },
        ]}
      />
      {tab === 'staff' && <Staff />}
      {tab === 'leaders' && <Leaders />}
      {tab === 'lists' && <Lists />}
      {tab === 'settings' && <Settings />}
    </>
  )
}

const normEmail = (e: string) => e.trim().toLowerCase()

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

function Staff() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const q = useTable<StaffRole>('staff_roles', 'role')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<AppRole>('organizer')
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'staff_roles'] })

  const add = useMutation({
    mutationFn: async () => {
      if (!email.includes('@') || !name.trim()) throw { message: 'اكتب الإيميل والاسم' }
      const { error } = await supabase.from('staff_roles').upsert({ email: normEmail(email), full_name: name.trim(), role })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      setEmail('')
      setName('')
      refresh()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async (e: string) => {
      const { error } = await supabase.from('staff_roles').delete().eq('email', e)
      if (error) throw error
    },
    onSuccess: refresh,
    onError: toastError,
  })
  const me = session?.user.email?.toLowerCase()

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
        <Field label="إيميل جوجل">
          <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="الاسم">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="الصلاحية">
          <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Button onClick={() => add.mutate()} loading={add.isPending}>
          <Plus className="size-4" /> إضافة
        </Button>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card className="divide-y divide-line p-0">
          {q.data?.map((s) => (
            <div key={s.email} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.full_name}</p>
                <p className="ltr truncate text-xs text-muted">{s.email}</p>
              </div>
              <Select
                className="w-32"
                value={s.role}
                onChange={async (e) => {
                  const { error } = await supabase.from('staff_roles').update({ role: e.target.value }).eq('email', s.email)
                  if (error) toastError(error)
                  else refresh()
                }}
                options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600"
                disabled={s.email.toLowerCase() === me}
                onClick={() => confirm(`شيل صلاحية ${s.full_name}؟`) && remove.mutate(s.email)}
                aria-label="شيل"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Leaders() {
  const qc = useQueryClient()
  const q = useTable<CommitteeLeader>('committee_leaders', 'committee')
  const committees = useQuery({
    queryKey: ['admin', 'committees'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lookups').select('value').eq('list', 'اللجنة').order('sort_order')
      if (error) throw error
      return data.map((r) => r.value as string)
    },
  })
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [committee, setCommittee] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'committee_leaders'] })
  const add = useMutation({
    mutationFn: async () => {
      if (!email.includes('@') || !name.trim() || !committee) throw { message: 'اكتب الإيميل والاسم واختار اللجنة' }
      const { error } = await supabase.from('committee_leaders').upsert({ email: normEmail(email), full_name: name.trim(), committee })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      setEmail('')
      setName('')
      refresh()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async (r: CommitteeLeader) => {
      const { error } = await supabase.from('committee_leaders').delete().eq('email', r.email).eq('committee', r.committee)
      if (error) throw error
    },
    onSuccess: refresh,
    onError: toastError,
  })
  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
        <Field label="إيميل جوجل">
          <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="الاسم">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="اللجنة">
          <Select value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder="اختار..." options={committees.data ?? []} />
        </Field>
        <Button onClick={() => add.mutate()} loading={add.isPending}>
          <Plus className="size-4" /> إضافة
        </Button>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="مفيش ليدر لجان لسه" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {q.data.map((r) => (
            <div key={r.email + r.committee} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {r.full_name} <span className="text-sm font-normal text-brand-700">· {r.committee}</span>
                </p>
                <p className="ltr truncate text-xs text-muted">{r.email}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => remove.mutate(r)} aria-label="شيل">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Lists() {
  const qc = useQueryClient()
  const q = useTable<Lookup>('lookups', 'sort_order')
  const listNames = useMemo(() => [...new Set((q.data ?? []).map((r) => r.list))].sort((a, b) => a.localeCompare(b, 'ar')), [q.data])
  const [list, setList] = useState('')
  const current = list || listNames[0] || ''
  const rows = (q.data ?? []).filter((r) => r.list === current)
  const parents = (q.data ?? []).filter((r) => r.list === 'الحدث').map((r) => r.value)
  const [value, setValue] = useState('')
  const [parent, setParent] = useState('')
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'lookups'] })
    qc.invalidateQueries({ queryKey: ['lookups'] })
  }
  const add = useMutation({
    mutationFn: async () => {
      if (!value.trim()) throw { message: 'اكتب القيمة' }
      const sort = Math.max(0, ...rows.map((r) => r.sort_order)) + 1
      const { error } = await supabase.from('lookups').insert({ list: current, value: value.trim(), parent: parent || null, sort_order: sort })
      if (error) throw error
    },
    onSuccess: () => {
      setValue('')
      refresh()
    },
    onError: toastError,
  })
  const toggle = async (r: Lookup, is_active: boolean) => {
    const { error } = await supabase.from('lookups').update({ is_active }).eq('id', r.id)
    if (error) toastError(error)
    else refresh()
  }
  if (q.isLoading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="w-60">
        <Select value={current} onChange={(e) => setList(e.target.value)} options={listNames} />
      </div>
      <Card className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Field label={`قيمة جديدة في «${current}»`}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
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
      <Card className="divide-y divide-line p-0">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={r.is_active ? 'flex-1 font-semibold' : 'flex-1 text-muted line-through'}>
              {r.value}
              {r.parent && <span className="ms-2 text-xs font-normal text-muted">({r.parent})</span>}
            </span>
            <Toggle checked={r.is_active} onChange={(v) => toggle(r, v)} label="ظاهرة" />
          </div>
        ))}
      </Card>
      <p className="text-xs text-muted">القيمة اللي بتقفلها بتختفي من الاختيارات بس، والبيانات القديمة اللي فيها بتفضل زي ما هي.</p>
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
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

  const roleOptions = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))
  const grouped = ROLE_ORDER.map((r) => ({ role: r, rows: (q.data ?? []).filter((s) => s.role === r) })).filter((g) => g.rows.length)
  return (
    <div className="space-y-4">
      <RoleGuide />
      <Card>
        <p className="mb-3 font-bold">إضافة صلاحية</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end">
          <Field label="إيميل جوجل">
            <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
          </Field>
          <Field label="الاسم">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="الصلاحية">
            <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)} options={roleOptions} />
          </Field>
          <Button onClick={() => add.mutate()} loading={add.isPending} className="sm:col-span-2 lg:col-span-1">
            <Plus className="size-4" /> إضافة
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">لو الإيميل موجود قبل كده، صلاحيته بتتغير للجديدة.</p>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : (
        grouped.map((g) => (
          <section key={g.role}>
            <h3 className="mb-2 text-sm font-bold text-muted">
              {ROLE_LABEL[g.role]} ({g.rows.length})
            </h3>
            <Card className="divide-y divide-line p-0">
              {g.rows.map((s) => {
                const isMe = s.email.toLowerCase() === me
                return (
                  <div key={s.email} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate font-semibold">
                        {s.full_name}
                        {isMe && <span className="ms-2 text-xs font-normal text-brand-700">(إنت)</span>}
                      </p>
                      <p className="ltr truncate text-start text-xs text-muted">{s.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        className="w-36"
                        value={s.role}
                        disabled={isMe}
                        aria-label="الصلاحية"
                        onChange={async (e) => {
                          const { error } = await supabase.from('staff_roles').update({ role: e.target.value }).eq('email', s.email)
                          if (error) toastError(error)
                          else refresh()
                        }}
                        options={roleOptions}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        disabled={isMe}
                        onClick={() => confirm(`شيل صلاحية ${s.full_name}؟`) && remove.mutate(s.email)}
                        aria-label="شيل الصلاحية"
                        title="شيل الصلاحية"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </Card>
          </section>
        ))
      )}
    </div>
  )
}

const ROLE_ORDER: AppRole[] = ['admin', 'activity_leader', 'hr', 'management', 'organizer']
const ROLE_GUIDE: Record<AppRole, string> = {
  admin: 'كل حاجة، ومنها الإعدادات والصلاحيات',
  activity_leader: 'كل حاجة زي الأدمن',
  hr: 'كل حاجة زي الأدمن، ومنها بيانات المقابلة وملاحظات الـ HR',
  management: 'يشوف كل البيانات والإحصائيات وينزّل Excel، من غير ملاحظات الـ HR ومن غير أي تعديل',
  organizer: 'يسجّل حضور لأي متطوع (آخر 7 أيام) ويوافق على الطلبات، ويشوف الاسم والتليفون بس',
}

function RoleGuide() {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-start font-bold">
        كل صلاحية بتعمل إيه؟
        <ChevronDown className={open ? 'size-5 rotate-180 text-muted transition' : 'size-5 text-muted transition'} />
      </button>
      {open && (
        <dl className="grid grid-cols-1 gap-3 border-t border-line px-4 py-3 text-sm sm:grid-cols-2">
          {ROLE_ORDER.map((r) => (
            <div key={r}>
              <dt className="font-semibold text-brand-800">{ROLE_LABEL[r]}</dt>
              <dd className="text-muted">{ROLE_GUIDE[r]}</dd>
            </div>
          ))}
          <div>
            <dt className="font-semibold text-brand-800">ليدر لجنة</dt>
            <dd className="text-muted">بيتضاف من تبويب «ليدر اللجان»: يشوف متطوعين لجنته ويعدّل بيانات اللجنة</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-800">متطوع</dt>
            <dd className="text-muted">أي حد إيميله متسجل في بياناته: يشوف بياناته ومشاركاته ويسجّل حضوره</dd>
          </div>
        </dl>
      )}
    </Card>
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
  const grouped = [...new Set((q.data ?? []).map((r) => r.committee))].map((c) => ({ committee: c, rows: (q.data ?? []).filter((r) => r.committee === c) }))
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-1 font-bold">إضافة ليدر لجنة</p>
        <p className="mb-3 text-xs text-muted">الشخص ممكن يبقى ليدر لأكتر من لجنة: ضيفه مرة لكل لجنة.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end">
          <Field label="إيميل جوجل">
            <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
          </Field>
          <Field label="الاسم">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="اللجنة">
            <Select value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder="اختار..." options={committees.data ?? []} />
          </Field>
          <Button onClick={() => add.mutate()} loading={add.isPending} className="sm:col-span-2 lg:col-span-1">
            <Plus className="size-4" /> إضافة
          </Button>
        </div>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="مفيش ليدر لجان لسه" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {grouped.map((g) => (
            <Card key={g.committee} className="p-0">
              <p className="border-b border-line px-4 py-2 font-bold text-brand-800">{g.committee}</p>
              <div className="divide-y divide-line">
                {g.rows.map((r) => (
                  <div key={r.email + r.committee} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.full_name}</p>
                      <p className="ltr truncate text-start text-xs text-muted">{r.email}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm(`شيل ${r.full_name} من ليدر ${r.committee}؟`) && remove.mutate(r)} aria-label="شيل" title="شيل">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
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
      <div className="w-full sm:w-60">
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

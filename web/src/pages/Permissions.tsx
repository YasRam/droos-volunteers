import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, KeyRound, LayoutGrid, Lock, Mail, Pause, Pencil, Play, Plus, Search, ShieldCheck, Table2, Trash2, UserRound, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useLookups, useVolunteers, type VolunteerWithStats } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { ALL_PERMISSIONS, PERMISSION_GROUPS, type Permission } from '@/lib/permissions'
import { supabase } from '@/lib/supabase'
import type { CommitteeLeader, Role, StaffRole } from '@/lib/types'
import { useJobs } from '@/lib/jobs'

type Tab = 'people' | 'roles' | 'leaders'

export default function Permissions() {
  const [tab, setTab] = useState<Tab>('people')
  return (
    <>
      <PageHeader title="الصلاحيات" subtitle="مين يقدر يعمل إيه في السيستم" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'people', label: 'الأشخاص' },
          { value: 'roles', label: 'أنواع الصلاحيات' },
          { value: 'leaders', label: 'القيادة واللجان' },
        ]}
      />
      {tab === 'people' && <People />}
      {tab === 'roles' && <Roles />}
      {tab === 'leaders' && <Leaders />}
    </>
  )
}

// ------------------------------------------------------------------ data

function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('*').order('sort_order').order('name')
      if (error) throw error
      return data as Role[]
    },
  })
}

function useStaff() {
  return useQuery({
    queryKey: ['staff_roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_roles').select('*')
      if (error) throw error
      return data as StaffRole[]
    },
  })
}

interface Person {
  email: string
  name: string
  volunteer?: VolunteerWithStats
  roles: string[]
  active: boolean
}

const normEmail = (e: string) => e.trim().toLowerCase()

/** Search box that picks a volunteer (by name, code or phone). */
function VolunteerPicker({ onPick, exclude = [] }: { onPick: (v: VolunteerWithStats) => void; exclude?: string[] }) {
  const vols = useVolunteers()
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    return (vols.data ?? [])
      .filter((v) => !exclude.includes(v.id) && (v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s) || v.email?.includes(s.toLowerCase())))
      .slice(0, 8)
  }, [q, vols.data, exclude])
  return (
    <div className="relative">
      <Search className="absolute start-3 top-2.5 size-5 text-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على المتطوع بالاسم أو الكود أو التليفون" className="ps-10" />
      {matches.length > 0 && (
        <div className="absolute inset-x-0 top-11 z-20 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          {matches.map((v) => (
            <button
              type="button"
              key={v.id}
              onClick={() => {
                onPick(v)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{v.full_name_ar}</span>
                <span className="ltr block truncate text-start text-xs text-muted">{v.email ?? 'مفيش إيميل'}</span>
              </span>
              <span className="ltr shrink-0 text-xs text-muted">{v.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ people

function People() {
  const { jobOf } = useJobs()
  const staff = useStaff()
  const roles = useRoles()
  const vols = useVolunteers()
  const { me } = useAuth()
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const [filter, setFilter] = useState('')

  const people = useMemo(() => {
    const byEmail = new Map<string, Person>()
    for (const s of staff.data ?? []) {
      const email = s.email.toLowerCase()
      const vol = vols.data?.find((v) => v.id === s.volunteer_id) ?? vols.data?.find((v) => v.email?.toLowerCase() === email)
      const p = byEmail.get(email) ?? { email, name: vol?.full_name_ar ?? s.full_name, volunteer: vol, roles: [], active: true }
      p.roles.push(s.role)
      if (s.active === false) p.active = false
      byEmail.set(email, p)
    }
    const order = new Map((roles.data ?? []).map((r, i) => [r.key, i]))
    return [...byEmail.values()]
      .map((p) => ({ ...p, roles: p.roles.sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99)) }))
      .filter((p) => !filter || p.roles.includes(filter))
      .sort((a, b) => (order.get(a.roles[0]) ?? 99) - (order.get(b.roles[0]) ?? 99) || a.name.localeCompare(b.name, 'ar'))
  }, [staff.data, vols.data, roles.data, filter])

  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.name ?? k
  const permsOf = (keys: string[]) => [...new Set(keys.flatMap((k) => roles.data?.find((r) => r.key === k)?.permissions ?? []))]
  if (staff.isLoading || roles.isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" /> صلاحية لشخص
        </Button>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFilter('')} className={clsx('rounded-full px-3 py-1 text-sm', !filter ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-line')}>
            الكل ({new Set((staff.data ?? []).map((s) => s.email.toLowerCase())).size})
          </button>
          {roles.data?.map((r) => {
            const n = (staff.data ?? []).filter((s) => s.role === r.key).length
            return n ? (
              <button key={r.key} onClick={() => setFilter(r.key)} className={clsx('rounded-full px-3 py-1 text-sm', filter === r.key ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-line')}>
                {r.name} ({n})
              </button>
            ) : null
          })}
        </div>
      </div>

      {!people.length ? (
        <Empty title="مفيش حد" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {people.map((p) => {
            const isMe = p.email === me?.email?.toLowerCase()
            return (
              <Card key={p.email} className={clsx('flex items-start gap-3', !p.active && 'bg-gray-50')}>
                <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl', p.volunteer ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500')}>
                  {p.volunteer ? <UserRound className="size-5" /> : <Mail className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {p.volunteer ? <VolunteerName id={p.volunteer.id} name={p.name} /> : p.name}
                    {isMe && <span className="ms-1.5 text-xs font-normal text-brand-700">(إنت)</span>}
                  </p>
                  <p className="ltr truncate text-start text-xs text-muted">{p.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.volunteer ? <Badge tone="brand">{jobOf(p.volunteer)}</Badge> : <Badge>مش متطوع · بيظهر في السجل بس</Badge>}
                    {!p.active && (
                      <Badge tone="orange">
                        <Pause className="me-1 inline size-3" />
                        موقوفة
                      </Badge>
                    )}
                    {p.roles.map((r) => (
                      <Badge key={r} tone={p.active ? 'purple' : 'gray'}>
                        {roleName(r)}
                      </Badge>
                    ))}
                  </div>
                  <GroupIcons perms={permsOf(p.roles)} muted={!p.active} />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(p)} disabled={isMe} title={isMe ? 'مينفعش تعدّل صلاحياتك بنفسك' : 'تعديل'} aria-label="تعديل">
                  <Pencil className="size-4" />
                </Button>
              </Card>
            )
          })}
        </div>
      )}
      {editing && <PersonEditor person={editing === 'new' ? null : editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  )
}

function PersonEditor({ person, roles, onClose }: { person: Person | null; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'volunteer' | 'email'>(person && !person.volunteer ? 'email' : 'volunteer')
  const [vol, setVol] = useState<VolunteerWithStats | undefined>(person?.volunteer)
  const [email, setEmail] = useState(person?.volunteer ? '' : (person?.email ?? ''))
  const [name, setName] = useState(person?.volunteer ? '' : (person?.name ?? ''))
  const [picked, setPicked] = useState<string[]>(person?.roles ?? [])
  const [active, setActive] = useState(person?.active ?? true)

  const save = useMutation({
    mutationFn: async () => {
      const targetEmail = mode === 'volunteer' ? normEmail(vol?.email ?? '') : normEmail(email)
      const targetName = mode === 'volunteer' ? (vol?.full_name_ar ?? '') : name.trim()
      if (mode === 'volunteer' && !vol) throw { message: 'اختار المتطوع' }
      if (!targetEmail.includes('@')) throw { message: mode === 'volunteer' ? 'المتطوع ده مالوش إيميل. ضيف إيميله في ملفه الأول.' : 'اكتب الإيميل' }
      if (!targetName) throw { message: 'اكتب الاسم' }
      if (!picked.length) throw { message: 'اختار صلاحية واحدة على الأقل' }
      const oldEmail = person?.email
      const removed = (person?.roles ?? []).filter((r) => !picked.includes(r) || oldEmail !== targetEmail)
      if (oldEmail && removed.length) {
        const { error } = await supabase.from('staff_roles').delete().eq('email', oldEmail).in('role', removed)
        if (error) throw error
      }
      const rows = picked.map((role) => ({ email: targetEmail, full_name: targetName, role, volunteer_id: mode === 'volunteer' ? vol!.id : null, active }))
      const { error } = await supabase.from('staff_roles').upsert(rows, { onConflict: 'email,role' })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      qc.invalidateQueries({ queryKey: ['staff_roles'] })
      onClose()
    },
    onError: toastError,
  })
  const removeAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('staff_roles').delete().eq('email', person!.email)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الصلاحيات اتشالت')
      qc.invalidateQueries({ queryKey: ['staff_roles'] })
      onClose()
    },
    onError: toastError,
  })

  return (
    <Modal open onClose={onClose} title={person ? `صلاحيات ${person.name}` : 'صلاحية لشخص'}>
      <div className="space-y-4">
        {!person && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-1">
            {(['volunteer', 'email'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={clsx('rounded-lg py-2 text-sm font-semibold', mode === m ? 'bg-white shadow-sm' : 'text-muted')}>
                {m === 'volunteer' ? 'متطوع' : 'إيميل من غير متطوع'}
              </button>
            ))}
          </div>
        )}
        {mode === 'volunteer' ? (
          vol ? (
            <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-brand-800">{vol.full_name_ar}</p>
                <p className="ltr truncate text-start text-xs text-muted">{vol.email ?? 'مفيش إيميل — ضيفه في ملف المتطوع'}</p>
              </div>
              {!person && (
                <Button variant="ghost" size="sm" onClick={() => setVol(undefined)}>
                  غيّر
                </Button>
              )}
            </div>
          ) : (
            <VolunteerPicker onPick={setVol} />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="إيميل جوجل">
              <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
            </Field>
            <Field label="الاسم">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <p className="text-xs text-muted sm:col-span-2">الإيميل اللي مش متطوع بيدخل بصلاحياته، بس مش بيظهر في الهيكل ولا في المتطوعين. بيظهر في السجل بس.</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-bold">الصلاحيات (ممكن أكتر من واحدة)</p>
          <div className="space-y-1.5">
            {roles.map((r) => {
              const on = picked.includes(r.key)
              return (
                <label key={r.key} className={clsx('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2', on ? 'border-brand-500 bg-brand-50' : 'border-line')}>
                  <input type="checkbox" className="mt-1 size-4 accent-brand-700" checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.key] : p.filter((x) => x !== r.key)))} />
                  <span>
                    <span className="block font-semibold">{r.name}</span>
                    {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-1">
          <button type="button" onClick={() => setActive(true)} className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold', active ? 'bg-white text-brand-800 shadow-sm' : 'text-muted')}>
            <Play className="size-4" /> مفعّلة
          </button>
          <button type="button" onClick={() => setActive(false)} className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold', !active ? 'bg-white text-orange-700 shadow-sm' : 'text-muted')}>
            <Pause className="size-4" /> موقوفة
          </button>
        </div>
        {!active && <p className="-mt-2 text-xs text-muted">الصلاحية متسجلة بس مش شغالة: مش هيقدر يعمل بيها حاجة ولا هتوصله إشعاراتها لحد ما تفعّلها.</p>}

        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => save.mutate()} loading={save.isPending}>
            <Check className="size-4" /> حفظ
          </Button>
          {person && (
            <Button variant="secondary" className="text-red-600" loading={removeAll.isPending} onClick={() => confirm(`تشيل كل صلاحيات ${person.name}؟`) && removeAll.mutate()}>
              <Trash2 className="size-4" /> شيل الكل
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ roles

/** Small icons of the permission groups a set of permissions touches (full colour = the whole group). */
function GroupIcons({ perms, muted }: { perms: string[]; muted?: boolean }) {
  const have = new Set(perms)
  const groups = PERMISSION_GROUPS.map((g) => ({ g, n: g.items.filter((i) => have.has(i.key)).length })).filter((x) => x.n)
  if (!groups.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {groups.map(({ g, n }) => {
        const Icon = g.icon
        const all = n === g.items.length
        return (
          <span
            key={g.title}
            title={`${g.title}: ${n} من ${g.items.length}`}
            className={clsx(
              'inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px]',
              muted ? 'bg-gray-100 text-gray-400' : all ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-800',
            )}
          >
            <Icon className="size-3.5" />
            {n}/{g.items.length}
          </span>
        )
      })}
    </div>
  )
}

function Roles() {
  const roles = useRoles()
  const staff = useStaff()
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  if (roles.isLoading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">كل نوع = مجموعة أذونات. الشخص ممكن ياخد أكتر من نوع، وبياخد كل أذوناتهم مع بعض.</p>
        <div className="flex gap-2">
          <div className="flex rounded-xl bg-surface p-1">
            {(
              [
                ['cards', LayoutGrid, 'كروت'],
                ['table', Table2, 'جدول مقارنة'],
              ] as const
            ).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)} className={clsx('flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm', view === v ? 'bg-white font-semibold shadow-sm' : 'text-muted')}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> نوع جديد
          </Button>
        </div>
      </div>
      {view === 'table' ? (
        <Matrix roles={roles.data ?? []} onEdit={setEditing} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {roles.data?.map((r) => {
            const people = new Set((staff.data ?? []).filter((s) => s.role === r.key).map((s) => s.email)).size
            return (
              <Card key={r.key} className="flex flex-col gap-1">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-purple-50 text-purple-700">
                    {r.key === 'admin' ? <Lock className="size-5" /> : <ShieldCheck className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{r.name}</p>
                    <p className="text-xs text-muted">{r.description}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label="تعديل">
                    <Pencil className="size-4" />
                  </Button>
                </div>
                <GroupIcons perms={r.permissions} />
                <div className="mt-1 flex flex-wrap gap-1 text-xs">
                  <Badge tone="brand">
                    <Users className="me-1 inline size-3" />
                    {r.key.startsWith('committee_') ? 'كل اللي في المنصب ده' : `${people} شخص`}
                  </Badge>
                  <Badge>
                    <KeyRound className="me-1 inline size-3" />
                    {r.permissions.filter((p) => ALL_PERMISSIONS.includes(p as Permission)).length} من {ALL_PERMISSIONS.length} إذن
                  </Badge>
                  {r.is_builtin && <Badge>أساسي</Badge>}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {editing && <RoleEditor role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Every permission (rows) × every role (columns). */
function Matrix({ roles, onEdit }: { roles: Role[]; onEdit: (r: Role) => void }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-start font-bold">الإذن</th>
            {roles.map((r) => (
              <th key={r.key} className="px-1 py-2 text-center text-xs font-bold">
                <button onClick={() => onEdit(r)} className="rounded-lg px-1.5 py-1 hover:bg-surface" title="تعديل">
                  {r.name}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUPS.map((g) => {
            const GIcon = g.icon
            return [
              <tr key={g.title} className="bg-brand-50/60">
                <td colSpan={roles.length + 1} className="px-3 py-1.5 font-bold text-brand-800">
                  <GIcon className="me-1.5 inline size-4" />
                  {g.title}
                </td>
              </tr>,
              ...g.items.map((i) => {
                const Icon = i.icon
                return (
                  <tr key={i.key} className="border-b border-line/60">
                    <td className="px-3 py-1.5">
                      <Icon className="me-1.5 inline size-4 text-muted" />
                      {i.label}
                    </td>
                    {roles.map((r) => (
                      <td key={r.key} className="text-center">
                        {r.permissions.includes(i.key) ? <Check className="mx-auto size-4 text-brand-700" /> : <span className="text-line">·</span>}
                      </td>
                    ))}
                  </tr>
                )
              }),
            ]
          })}
        </tbody>
      </table>
    </Card>
  )
}

function RoleEditor({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const qc = useQueryClient()
  const locked = role?.key === 'admin'
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? [])
  const [q, setQ] = useState('')
  const toggle = (keys: string[], on: boolean) => setPerms((p) => (on ? [...new Set([...p, ...keys])] : p.filter((x) => !keys.includes(x))))

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw { message: 'اكتب اسم الصلاحية' }
      const row = { name: name.trim(), description: description.trim() || null, permissions: perms }
      const { error } = role
        ? await supabase.from('roles').update(row).eq('key', role.key)
        : await supabase.from('roles').insert({ ...row, key: `custom_${Date.now().toString(36)}`, sort_order: 50 })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظت')
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      onClose()
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('roles').delete().eq('key', role!.key)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتمسحت')
      qc.invalidateQueries({ queryKey: ['roles'] })
      onClose()
    },
    onError: (e) => toastError((e as { code?: string }).code === '23503' ? { message: 'فيه ناس واخدين الصلاحية دي. شيلها منهم الأول.' } : e),
  })

  const s = q.trim()
  const groups = PERMISSION_GROUPS.map((g) => ({ g, items: g.items.filter((i) => !s || i.label.includes(s) || i.hint.includes(s) || g.title.includes(s)) })).filter((x) => x.items.length)

  return (
    <Modal open onClose={onClose} title={role ? `تعديل «${role.name}»` : 'نوع صلاحية جديد'}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="الاسم">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: مسئول التيشيرتات" />
          </Field>
          <Field label="وصف قصير">
            <Textarea rows={1} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {locked && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">صلاحية الأدمن بتفضل كاملة عشان محدش يقفل السيستم على نفسه. تقدر تغيّر الاسم والوصف بس.</p>}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-2.5 size-5 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على إذن" className="ps-10" />
          </div>
          <Badge tone="brand">
            {perms.filter((p) => ALL_PERMISSIONS.includes(p as Permission)).length}/{ALL_PERMISSIONS.length}
          </Badge>
        </div>
        {groups.map(({ g, items }) => {
          const GIcon = g.icon
          const keys = g.items.map((i) => i.key as string)
          const n = keys.filter((k) => perms.includes(k)).length
          const all = n === keys.length
          return (
            <fieldset key={g.title} disabled={locked} className="rounded-2xl border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
                  <GIcon className="size-4" />
                </span>
                <legend className="flex-1 font-bold text-brand-800">{g.title}</legend>
                <span className="text-xs text-muted">
                  {n}/{keys.length}
                </span>
                {!locked && (
                  <button type="button" onClick={() => toggle(keys, !all)} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                    {all ? 'شيل الكل' : 'الكل'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {items.map((i) => {
                  const Icon = i.icon
                  const on = perms.includes(i.key)
                  return (
                    <label key={i.key} className={clsx('flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm', on ? 'border-brand-500 bg-brand-50' : 'border-line', locked && 'cursor-default opacity-80')}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => toggle([i.key], e.target.checked)} />
                      <span className={clsx('grid size-7 shrink-0 place-items-center rounded-lg', on ? 'bg-brand-700 text-white' : 'bg-surface text-muted')}>
                        {on ? <Check className="size-4" /> : <Icon className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{i.label}</span>
                        {i.hint && <span className="block text-xs text-muted">{i.hint}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => save.mutate()} loading={save.isPending}>
            <Check className="size-4" /> حفظ
          </Button>
          {role && !role.is_builtin && (
            <Button variant="secondary" className="text-red-600" loading={remove.isPending} onClick={() => confirm(`تمسح «${role.name}»؟`) && remove.mutate()}>
              <Trash2 className="size-4" /> مسح
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ committee leaders

function Leaders() {
  const qc = useQueryClient()
  const lookups = useLookups()
  const q = useQuery({
    queryKey: ['committee_leaders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('committee_leaders').select('*').order('committee')
      if (error) throw error
      return data as CommitteeLeader[]
    },
  })
  const [vol, setVol] = useState<VolunteerWithStats>()
  const [committees, setCommittees] = useState<string[]>([])
  const [role, setRole] = useState<'ليدر' | 'نائب'>('ليدر')
  const refresh = () => qc.invalidateQueries({ queryKey: ['committee_leaders'] })

  const add = useMutation({
    mutationFn: async () => {
      if (!vol) throw { message: 'اختار المتطوع' }
      if (!vol.email) throw { message: 'المتطوع ده مالوش إيميل. ضيف إيميله في ملفه الأول.' }
      if (!committees.length) throw { message: 'اختار لجنة واحدة على الأقل' }
      const rows = committees.map((committee) => ({ email: normEmail(vol.email!), full_name: vol.full_name_ar, committee, volunteer_id: vol.id, role }))
      const { error } = await supabase.from('committee_leaders').upsert(rows, { onConflict: 'email,committee' })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      setVol(undefined)
      setCommittees([])
      refresh()
      qc.invalidateQueries({ queryKey: ['volunteers'] })
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

  const grouped = [...new Set((q.data ?? []).map((r) => r.committee))].map((c) => ({
    committee: c,
    rows: (q.data ?? []).filter((r) => r.committee === c).sort((a, b) => (a.role === 'نائب' ? 1 : 0) - (b.role === 'نائب' ? 1 : 0)),
  }))
  return (
    <div className="space-y-4">
      <Leadership />
      <Card>
        <p className="mb-1 font-bold">إضافة ليدر أو نائب للجنة</p>
        <p className="mb-3 text-xs text-muted">اختار المتطوع واللجان. الليدر والنائب ليهم نفس الصلاحيات على لجنتهم.</p>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {(['ليدر', 'نائب'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRole(r)} className={clsx('rounded-full px-4 py-1 text-sm font-semibold', role === r ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-line')}>
                {r}
              </button>
            ))}
          </div>
          {vol ? (
            <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2">
              <span className="font-semibold text-brand-800">{vol.full_name_ar}</span>
              <Button variant="ghost" size="sm" onClick={() => setVol(undefined)}>
                غيّر
              </Button>
            </div>
          ) : (
            <VolunteerPicker onPick={setVol} />
          )}
          <div className="flex flex-wrap gap-1.5">
            {(lookups.data?.list('اللجنة') ?? []).map((c) => {
              const on = committees.includes(c)
              return (
                <button key={c} type="button" onClick={() => setCommittees((x) => (on ? x.filter((y) => y !== c) : [...x, c]))} className={clsx('rounded-full px-3 py-1 text-sm', on ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-line')}>
                  {c}
                </button>
              )
            })}
          </div>
          <Button onClick={() => add.mutate()} loading={add.isPending}>
            <Plus className="size-4" /> إضافة
          </Button>
        </div>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : !grouped.length ? (
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
                      <p className="truncate font-semibold">{r.volunteer_id ? <VolunteerName id={r.volunteer_id} name={r.full_name} /> : r.full_name}</p>
                      <p className="ltr truncate text-start text-xs text-muted">{r.email}</p>
                    </div>
                    <Badge tone={r.role === 'نائب' ? 'gray' : 'brand'}>{r.role ?? 'ليدر'}</Badge>
                    {!r.volunteer_id && <Badge tone="orange">مش مربوط بمتطوع</Badge>}
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm(`تشيل ${r.full_name} من ليدر ${r.committee}؟`) && remove.mutate(r)} aria-label="شيل">
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

/** The activity has one leader and one deputy: jobs on the volunteer, not committees. */
function Leadership() {
  const qc = useQueryClient()
  const vols = useVolunteers()
  const current = (pos: string) => vols.data?.find((v) => v.position === pos)
  const setPos = useMutation({
    mutationFn: async ({ pos, v }: { pos: 'ليدر النشاط' | 'نائب ليدر النشاط'; v?: VolunteerWithStats }) => {
      const old = current(pos)
      if (old) {
        const { error } = await supabase.from('volunteers').update({ position: 'متطوع' }).eq('id', old.id)
        if (error) throw error
      }
      if (v) {
        const { error } = await supabase.from('volunteers').update({ position: pos }).eq('id', v.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  return (
    <Card className="border-brand-200 bg-brand-50/60">
      <p className="mb-1 font-bold text-brand-800">قيادة النشاط</p>
      <p className="mb-3 text-xs text-muted">شخص واحد ليدر النشاط وشخص واحد نائب. دي وظيفة مش لجنة، والصلاحيات بتتحدد من «الأنواع».</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(['ليدر النشاط', 'نائب ليدر النشاط'] as const).map((pos) => {
          const v = current(pos)
          return (
            <div key={pos}>
              <p className="mb-1 text-sm font-semibold">{pos}</p>
              {v ? (
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-line">
                  <VolunteerName id={v.id} name={v.full_name_ar} className="font-semibold" />
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm(`تشيل ${v.full_name_ar} من «${pos}»؟`) && setPos.mutate({ pos })}>
                    شيل
                  </Button>
                </div>
              ) : (
                <VolunteerPicker onPick={(picked) => setPos.mutate({ pos, v: picked })} />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

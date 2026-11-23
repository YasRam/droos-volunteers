import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BadgeCheck, Mail, Pencil, Plus, Search, Shield, Trash2, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useLookups, useVolunteers, type VolunteerWithStats } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { POSITION_ROLE, POSITIONS, ROLE_LABEL, type AppRole, type CommitteeLeader, type StaffRole, type VolunteerPosition } from '@/lib/types'

const ROLES = Object.keys(ROLE_LABEL) as AppRole[]
const ROLE_HINT: Record<AppRole, string> = {
  admin: 'كل حاجة',
  activity_leader: 'كل حاجة في النشاط',
  hr: 'المتطوعين والمقابلات والقوائم والسجل',
  organizer: 'تسجيل الحضور والموافقة عليه (آخر 7 أيام)',
}
const normEmail = (e?: string | null) => (e ?? '').trim().toLowerCase()

interface Person {
  key: string
  email: string | null
  name: string
  volunteer: VolunteerWithStats | null
  roles: AppRole[]
  committees: string[]
}

function usePeople() {
  return useQuery({
    queryKey: ['permissions'],
    queryFn: async () => {
      const [staff, leaders] = await Promise.all([supabase.from('staff_roles').select('*'), supabase.from('committee_leaders').select('*')])
      if (staff.error) throw staff.error
      if (leaders.error) throw leaders.error
      return { staff: staff.data as StaffRole[], leaders: leaders.data as CommitteeLeader[] }
    },
  })
}

export default function Permissions() {
  const vols = useVolunteers()
  const q = usePeople()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Person | 'new' | null>(null)

  const people = useMemo(() => {
    const byEmail = new Map<string, Person>()
    const volByEmail = new Map((vols.data ?? []).filter((v) => v.email).map((v) => [normEmail(v.email), v]))
    const get = (email: string, name: string) => {
      const e = normEmail(email)
      let p = byEmail.get(e)
      if (!p) {
        const v = volByEmail.get(e) ?? null
        p = { key: e, email: e, name: v?.full_name_ar ?? name, volunteer: v, roles: [], committees: [] }
        byEmail.set(e, p)
      }
      return p
    }
    for (const s of q.data?.staff ?? []) get(s.email, s.full_name).roles.push(s.role)
    for (const l of q.data?.leaders ?? []) get(l.email, l.full_name).committees.push(l.committee)
    const list = [...byEmail.values()]
    // Volunteers with a position but no permissions (or no email) still belong on this screen
    for (const v of vols.data ?? []) {
      if (v.position !== 'متطوع' && !(v.email && byEmail.has(normEmail(v.email)))) {
        list.push({ key: v.id, email: v.email ? normEmail(v.email) : null, name: v.full_name_ar, volunteer: v, roles: [], committees: [] })
      }
    }
    for (const p of list) p.roles.sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b))
    const s = search.trim()
    return list
      .filter((p) => !s || p.name.includes(s) || p.email?.includes(s.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [q.data, vols.data, search])

  const volunteers = people.filter((p) => p.volunteer)
  const outsiders = people.filter((p) => !p.volunteer)

  if (q.isLoading || vols.isLoading) return <Spinner />
  return (
    <>
      <PageHeader
        title="الصلاحيات"
        subtitle="مين يقدر يعمل إيه في السيستم"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> إضافة
          </Button>
        }
      />
      <Card className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex gap-3">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-purple-700" />
          <p>
            <b>الوظيفة</b> واحدة بس لكل متطوع: {POSITIONS.join('، ')}. بتظهر في الهيكل وملف المتطوع.
          </p>
        </div>
        <div className="flex gap-3">
          <Shield className="mt-0.5 size-5 shrink-0 text-brand-700" />
          <p>
            <b>الصلاحيات</b> ممكن تبقى أكتر من واحدة لنفس الشخص. وممكن تدّيها لإيميل مش متطوع، وده بيظهر في السجل بس.
          </p>
        </div>
      </Card>
      <div className="relative mb-4">
        <Search className="absolute start-3 top-2.5 size-5 text-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو الإيميل" className="ps-10" />
      </div>

      <Section title="متطوعين" icon={UserRound} people={volunteers} onEdit={setEditing} empty="مفيش متطوعين ليهم وظيفة أو صلاحية" />
      <Section title="إيميلات مش متطوعين" icon={Mail} people={outsiders} onEdit={setEditing} empty="مفيش" hint="بيظهروا في السجل بس، مش في الهيكل ولا القوائم" />

      {editing && <Editor person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function Section({ title, icon: Icon, people, onEdit, empty, hint }: { title: string; icon: typeof Mail; people: Person[]; onEdit: (p: Person) => void; empty: string; hint?: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <Icon className="size-4 text-muted" /> {title} <span className="text-sm font-normal text-muted">({people.length})</span>
      </h2>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      {!people.length ? (
        <Empty title={empty} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {people.map((p) => (
            <Card key={p.key} className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="ltr truncate text-start text-xs text-muted">{p.email ?? 'مالوش إيميل'}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => onEdit(p)}>
                  <Pencil className="size-4" /> تعديل
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.volunteer && <Badge tone="purple">{p.volunteer.position}</Badge>}
                {p.roles.map((r) => (
                  <Badge key={r} tone="brand">
                    {ROLE_LABEL[r]}
                  </Badge>
                ))}
                {p.committees.map((c) => (
                  <Badge key={c} tone="orange">
                    ليدر {c}
                  </Badge>
                ))}
                {!p.roles.length && !p.committees.length && <span className="text-xs text-muted">من غير صلاحيات</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

function Editor({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const vols = useVolunteers()
  const lookups = useLookups()
  const committees = lookups.data?.list('اللجنة') ?? []
  const [kind, setKind] = useState<'volunteer' | 'email'>(person && !person.volunteer ? 'email' : 'volunteer')
  const [volunteerId, setVolunteerId] = useState(person?.volunteer?.id ?? '')
  const [find, setFind] = useState('')
  const [email, setEmail] = useState(person?.email ?? '')
  const [name, setName] = useState(person?.name ?? '')
  const [position, setPosition] = useState<VolunteerPosition>(person?.volunteer?.position ?? 'متطوع')
  const [roles, setRoles] = useState<Set<AppRole>>(new Set(person?.roles ?? []))
  const [leads, setLeads] = useState<Set<string>>(new Set(person?.committees ?? []))
  const rolesState = roles
  const leadsState = leads
  const positionState = position
  const current = usePeople()
  const v = (vols.data ?? []).find((x) => x.id === volunteerId) ?? null
  const isNew = !person

  const matches = useMemo(() => {
    const s = find.trim()
    if (!s) return []
    return (vols.data ?? []).filter((x) => x.full_name_ar.includes(s) || x.code.includes(s.toUpperCase()) || x.email?.includes(s.toLowerCase())).slice(0, 6)
  }, [find, vols.data])

  const flip = <T,>(set: Set<T>, x: T) => {
    const n = new Set(set)
    if (n.has(x)) n.delete(x)
    else n.add(x)
    return n
  }
  const choosePosition = (p: VolunteerPosition) => {
    setPosition(p)
    const r = POSITION_ROLE[p]
    if (r) setRoles((s) => new Set([...s, r]))
  }

  const save = useMutation({
    mutationFn: async (clear?: boolean) => {
      const roles = clear ? new Set<AppRole>() : rolesState
      const leads = clear ? new Set<string>() : leadsState
      const position: VolunteerPosition = clear ? 'متطوع' : positionState
      const targetEmail = normEmail(kind === 'volunteer' ? v?.email : email)
      const displayName = kind === 'volunteer' ? (v?.full_name_ar ?? '') : name.trim()
      if (kind === 'volunteer' && !v) throw { message: 'اختار المتطوع' }
      if (kind === 'email' && (!targetEmail.includes('@') || !displayName)) throw { message: 'اكتب الإيميل والاسم' }
      if ((roles.size || leads.size) && !targetEmail) throw { message: 'المتطوع ده مالوش إيميل في بياناته، ضيفه الأول عشان الصلاحيات تشتغل' }
      if (position === 'ليدر لجنة' && !leads.size) throw { message: 'اختار اللجنة اللي بيقودها' }

      if (kind === 'volunteer' && v && v.position !== position) {
        const { error } = await supabase.from('volunteers').update({ position }).eq('id', v.id)
        if (error) throw error
      }
      if (!targetEmail) return
      const [curRoles, curLeads] = await Promise.all([
        supabase.from('staff_roles').select('role').eq('email', targetEmail),
        supabase.from('committee_leaders').select('committee').eq('email', targetEmail),
      ])
      if (curRoles.error) throw curRoles.error
      if (curLeads.error) throw curLeads.error
      const hadRoles = new Set((curRoles.data as { role: AppRole }[]).map((r) => r.role))
      const hadLeads = new Set((curLeads.data as { committee: string }[]).map((r) => r.committee))

      if (isNew && kind === 'email' && (hadRoles.size || hadLeads.size)) throw { message: 'الإيميل ده ليه صلاحيات قبل كده، عدّله من القائمة' }
      const addRoles = [...roles].filter((r) => !hadRoles.has(r))
      const dropRoles = [...hadRoles].filter((r) => !roles.has(r))
      const addLeads = [...leads].filter((c) => !hadLeads.has(c))
      const dropLeads = [...hadLeads].filter((c) => !leads.has(c))

      if (targetEmail === normEmail(me?.email) && dropRoles.some((r) => r !== 'organizer') && ![...roles].some((r) => r !== 'organizer')) {
        throw { message: 'مينفعش تشيل صلاحية الإدارة من نفسك. خلّي حد تاني يعملها' }
      }
      const steps = [
        addRoles.length ? supabase.from('staff_roles').insert(addRoles.map((role) => ({ email: targetEmail, full_name: displayName, role }))) : null,
        dropRoles.length ? supabase.from('staff_roles').delete().eq('email', targetEmail).in('role', dropRoles) : null,
        addLeads.length ? supabase.from('committee_leaders').insert(addLeads.map((committee) => ({ email: targetEmail, full_name: displayName, committee }))) : null,
        dropLeads.length ? supabase.from('committee_leaders').delete().eq('email', targetEmail).in('committee', dropLeads) : null,
        kind === 'email' && !isNew && displayName !== person?.name ? supabase.from('staff_roles').update({ full_name: displayName }).eq('email', targetEmail) : null,
      ]
      for (const step of steps) {
        if (!step) continue
        const { error } = await step
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      qc.invalidateQueries({ queryKey: ['permissions'] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['tree-people'] })
      onClose()
    },
    onError: toastError,
  })

  const removeAll = () => {
    if (!confirm(`تشيل كل صلاحيات ${person?.name}${person?.volunteer ? ' وترجّع وظيفته «متطوع»' : ''}؟`)) return
    save.mutate(true)
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'إضافة صلاحية' : (person?.name ?? '')}>
      <div className="space-y-4">
        {isNew && (
          <div className="flex rounded-xl bg-surface p-1">
            {(['volunteer', 'email'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={clsx('flex-1 rounded-lg py-2 text-sm font-semibold', kind === k ? 'bg-white shadow-sm' : 'text-muted')}
              >
                {k === 'volunteer' ? 'متطوع' : 'إيميل مش متطوع'}
              </button>
            ))}
          </div>
        )}

        {kind === 'volunteer' ? (
          isNew && !v ? (
            <Field label="المتطوع">
              <div className="relative">
                <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="اكتب الاسم أو الكود" />
                {matches.length > 0 && (
                  <div className="absolute inset-x-0 top-11 z-10 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                    {matches.map((x) => (
                      <button key={x.id} type="button" onClick={() => choose(x)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface">
                        <span className="text-sm font-semibold">{x.full_name_ar}</span>
                        <span className="ltr truncate text-xs text-muted">{x.email ?? 'مالوش إيميل'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          ) : (
            v && (
              <div className="rounded-xl bg-surface px-3 py-2">
                <p className="font-semibold">{v.full_name_ar}</p>
                <p className="ltr text-start text-xs text-muted">{v.email ?? 'مالوش إيميل: الصلاحيات محتاجة إيميل جوجل في بياناته'}</p>
                {isNew && (
                  <button type="button" onClick={() => setVolunteerId('')} className="mt-1 text-xs font-semibold text-brand-700">
                    اختار حد تاني
                  </button>
                )}
              </div>
            )
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="إيميل جوجل">
              <Input type="email" dir="ltr" value={email} disabled={!isNew} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="الاسم" hint="ده اللي بيظهر في السجل">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        )}

        {kind === 'volunteer' && (
          <Field label="الوظيفة (واحدة بس)">
            <Select value={position} onChange={(e) => choosePosition(e.target.value as VolunteerPosition)} options={POSITIONS} />
          </Field>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">الصلاحيات (ممكن أكتر من واحدة)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((r) => (
              <label key={r} className={clsx('flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2', roles.has(r) ? 'border-brand-500 bg-brand-50' : 'border-line')}>
                <input type="checkbox" checked={roles.has(r)} onChange={() => setRoles((s) => flip(s, r))} className="mt-1 size-4 accent-brand-700" />
                <span>
                  <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                  <span className="block text-xs text-muted">{ROLE_HINT[r]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold">ليدر لجنة</p>
          <p className="mb-2 text-xs text-muted">بيشوف متطوعين اللجان دي ويعدّل بيانات اللجنة بتاعتهم</p>
          <div className="flex flex-wrap gap-2">
            {committees.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setLeads((s) => flip(s, c))}
                className={clsx('rounded-full px-3 py-1 text-sm font-semibold ring-1', leads.has(c) ? 'bg-orange-50 text-orange-800 ring-orange-300' : 'text-muted ring-line')}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" loading={save.isPending} onClick={() => save.mutate(false)}>
            حفظ
          </Button>
          {!isNew && (
            <Button variant="ghost" className="text-red-600" onClick={removeAll}>
              <Trash2 className="size-4" /> شيل الكل
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )

  function choose(x: VolunteerWithStats) {
    setVolunteerId(x.id)
    setFind('')
    setPosition(x.position)
    // Start from what this person already has, so saving never drops it by mistake
    const e = normEmail(x.email)
    setRoles(new Set(e ? (current.data?.staff ?? []).filter((r) => normEmail(r.email) === e).map((r) => r.role) : []))
    setLeads(new Set(e ? (current.data?.leaders ?? []).filter((r) => normEmail(r.email) === e).map((r) => r.committee) : []))
  }
}

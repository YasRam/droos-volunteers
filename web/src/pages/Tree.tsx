import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, Crown, Search, Shield, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ContactLinks, VolunteerName } from '@/components/VolunteerLink'
import { Badge, Card, Input, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { useLookups, useVolunteers, type VolunteerWithStats } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import type { CommitteeLeader } from '@/lib/types'
import { useJobs } from '@/lib/jobs'

const NO_COMMITTEE = 'من غير لجنة'

/** ليدر النشاط ← ليدر اللجان ← متطوعين كل لجنة (اللي مش خارج المتابعة). */
export default function Tree() {
  const p = usePermissions()
  const lookups = useLookups()
  const vols = useVolunteers()
  const [search, setSearch] = useState('')
  // Committee leaders count only when linked to a volunteer: the tree is people, not accounts.
  const people = useQuery({
    queryKey: ['tree-people'],
    queryFn: async () => {
      const { data, error } = await supabase.from('committee_leaders').select('*').not('volunteer_id', 'is', null)
      if (error) throw error
      return { leaders: data as CommitteeLeader[] }
    },
  })

  const committees = useMemo(() => {
    const active = (vols.data ?? []).filter((v) => v.status !== 'خارج المتابعة')
    const names = [...new Set([...(lookups.data?.list('اللجنة') ?? []), ...active.flatMap((v) => [v.main_committee, v.sub_committee]).filter((c): c is string => Boolean(c))])]
    const s = search.trim()
    const match = (v: VolunteerWithStats) => !s || v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase())
    const list = names.map((name) => ({
      name,
      leaders: (people.data?.leaders ?? []).filter((l) => l.committee === name),
      main: active.filter((v) => v.main_committee === name && match(v)),
      sub: active.filter((v) => v.sub_committee === name && v.main_committee !== name && match(v)),
    }))
    const orphans = active.filter((v) => !v.main_committee && !v.sub_committee && match(v))
    if (orphans.length) list.push({ name: NO_COMMITTEE, leaders: [], main: orphans, sub: [] })
    // A committee leader may only see their own committees
    return list.filter((c) => p.viewAll || c.main.length || c.sub.length)
  }, [vols.data, lookups.data, people.data, search, p.viewAll])

  const byPosition = (pos: string) => (vols.data ?? []).filter((v) => v.position === pos)
  const top = [...byPosition('ليدر النشاط'), ...byPosition('نائب ليدر النشاط')]
  const total = committees.reduce((n, c) => n + c.main.length, 0)

  if (vols.isLoading || people.isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="الهيكل" subtitle="ليدر النشاط، وتحته ليدر كل لجنة، وتحت كل لجنة متطوعينها اللي مش خارج المتابعة" />
      <div className="relative mb-4">
        <Search className="absolute start-3 top-2.5 size-5 text-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر على متطوع في الشجرة" className="ps-10" />
      </div>

      {/* Root: the activity leader and deputy only */}
      <Card className="border-brand-200 bg-brand-50/60">
        <p className="mb-2 flex items-center gap-2 font-bold text-brand-800">
          <Crown className="size-5" /> قيادة النشاط
        </p>
        <div className="flex flex-wrap gap-2">
          {top.length ? (
            top.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1">
                <span className="text-xs text-muted">{v.position === 'ليدر النشاط' ? 'ليدر النشاط:' : 'النائب:'}</span>
                <Person v={v} tone={v.position === 'ليدر النشاط' ? 'purple' : 'brand'} />
              </span>
            ))
          ) : (
            <span className="text-sm text-muted">لسه محدش متحدد. حددهم من الصلاحيات ← القيادة واللجان.</span>
          )}
        </div>
      </Card>

      {/* Branches */}
      <div className="ms-4 border-s-2 border-brand-200 ps-4 pt-4 sm:ms-6 sm:ps-6">
        <p className="mb-3 text-xs text-muted">
          {committees.length} لجنة · {total} متطوع في لجنتهم الأساسية
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {committees.map((c) => (
            <CommitteeNode key={c.name} {...c} openByDefault={Boolean(search.trim())} />
          ))}
        </div>
      </div>
    </>
  )
}

function CommitteeNode({
  name,
  leaders,
  main,
  sub,
  openByDefault,
}: {
  name: string
  leaders: CommitteeLeader[]
  main: VolunteerWithStats[]
  sub: VolunteerWithStats[]
  openByDefault: boolean
}) {
  const [open, setOpen] = useState(false)
  const shown = open || openByDefault
  return (
    <Card className="relative p-0 before:absolute before:-start-[18px] before:top-6 before:h-0.5 before:w-4 before:bg-brand-200 sm:before:-start-[26px] sm:before:w-6">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-start">
        <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', name === NO_COMMITTEE ? 'bg-gray-100 text-gray-500' : 'bg-brand-50 text-brand-700')}>
          <Users className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{name}</span>
          <span className="block truncate text-xs text-muted">
            {name === NO_COMMITTEE ? 'متطوعين مالهمش لجنة' : leaders.length ? leaders.map((l) => `${l.role ?? 'ليدر'}: ${l.full_name}`).join(' · ') : 'مفيش ليدر للجنة دي'}
          </span>
        </span>
        <Badge tone="brand">{main.length}</Badge>
        {sub.length > 0 && <Badge>+{sub.length} فرعي</Badge>}
        <ChevronDown className={clsx('size-5 shrink-0 text-muted transition', shown && 'rotate-180')} />
      </button>
      {shown && (
        <div className="border-t border-line px-4 py-3">
          {leaders.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {leaders.map((l) => (
                <span key={l.email} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  <Shield className="size-3.5" /> {l.role ?? 'ليدر'}: <VolunteerName id={l.volunteer_id!} name={l.full_name} />
                </span>
              ))}
            </div>
          )}
          <div className="ms-2 space-y-0.5 border-s border-line ps-3">
            {main.map((v) => (
              <Leaf key={v.id} v={v} />
            ))}
            {!main.length && <p className="text-sm text-muted">مفيش متطوعين اللجنة دي لجنتهم الأساسية</p>}
          </div>
          {sub.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-xs font-bold text-muted">لجنة فرعية ليهم</p>
              <div className="ms-2 space-y-0.5 border-s border-dashed border-line ps-3">
                {sub.map((v) => (
                  <Leaf key={v.id} v={v} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function Person({ v, tone }: { v: VolunteerWithStats; tone: 'purple' | 'brand' | 'gray' }) {
  const { jobOf } = useJobs()
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white py-1 ps-3 pe-1.5 text-sm font-semibold ring-1 ring-brand-200">
      <VolunteerName id={v.id} name={v.full_name_ar} />
      <Badge tone={tone}>{jobOf(v)}</Badge>
    </span>
  )
}

function Leaf({ v }: { v: VolunteerWithStats }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <VolunteerName id={v.id} name={v.full_name_ar} className="min-w-0 flex-1 truncate text-sm font-semibold" />
      {v.status !== 'تحت المتابعة' && <StatusBadge status={v.status} />}
      <ContactLinks phone={v.phone} whatsapp={v.whatsapp} showNumber={false} />
    </div>
  )
}

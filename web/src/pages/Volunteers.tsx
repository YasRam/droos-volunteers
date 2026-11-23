import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Filter, Info, LayoutList, MessageCircle, Phone, Plus, Search, Star, Table2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AcceptanceBadge, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { ageFrom, fmtShort, useDirectory, useHrRows, useLookups, useVolunteers, whatsappLink, type VolunteerWithStats } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ACCEPTANCE, STATUSES, type VolunteerHr, type VolunteerStatus } from '@/lib/types'
import { PersonalFields, personalSchema, toPersonalPayload, type PersonalValues } from './MyProfile'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

interface Filters {
  status: string
  acceptance: string
  committee: string
  gender: string
  birthMonth: string
  job: string
  qualification: string
  inactive: boolean
}
const EMPTY: Filters = { status: '', acceptance: '', committee: '', gender: '', birthMonth: '', job: '', qualification: '', inactive: false }

export default function Volunteers() {
  const p = usePermissions()
  if (!p.full && !p.leader) return <Directory />
  return <FullList />
}

function useWide() {
  const query = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

type SortKey = 'name' | 'this_month' | 'total' | 'last'
const DAY = 864e5
const isStale = (v: VolunteerWithStats) =>
  v.status !== 'خارج المتابعة' && (!v.stats?.last_participation || Date.now() - Date.parse(v.stats.last_participation) > 30 * DAY)

function FullList() {
  const p = usePermissions()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const vols = useVolunteers()
  const hr = useHrRows(p.full)
  const lookups = useLookups()
  const wide = useWide()
  const [view, setView] = useState<'auto' | 'table' | 'cards'>('auto')
  const asTable = view === 'table' || (view === 'auto' && wide)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY, status: params.get('status') ?? '', inactive: params.get('inactive') === '1' }))
  const [showFilters, setShowFilters] = useState(Boolean(params.get('status') || params.get('inactive')))
  const [showLegend, setShowLegend] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [adding, setAdding] = useState(false)
  const active = Object.entries(filters).filter(([, v]) => v).length

  const rows = useMemo(() => {
    const s = search.trim()
    const month30 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)
    const list = (vols.data ?? []).filter((v) => {
      if (s && !(v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s) || v.full_name_en?.toLowerCase().includes(s.toLowerCase())))
        return false
      if (filters.status && v.status !== filters.status) return false
      if (filters.acceptance && (hr.data?.get(v.id)?.acceptance ?? 'لسه') !== filters.acceptance) return false
      if (filters.committee && v.main_committee !== filters.committee && v.sub_committee !== filters.committee) return false
      if (filters.gender && v.gender !== filters.gender) return false
      if (filters.birthMonth && Number(v.birth_date?.slice(5, 7)) !== Number(filters.birthMonth)) return false
      if (filters.job && !v.job?.includes(filters.job)) return false
      if (filters.qualification && !v.qualification?.includes(filters.qualification)) return false
      if (filters.inactive && (v.status === 'خارج المتابعة' || (v.stats?.last_participation ?? '') >= month30)) return false
      return true
    })
    const val = (v: VolunteerWithStats): string | number =>
      sort.key === 'name' ? v.full_name_ar : sort.key === 'last' ? (v.stats?.last_participation ?? '') : (v.stats?.[sort.key] ?? 0)
    return list.sort((a, b) => {
      const x = val(a)
      const y = val(b)
      return (typeof x === 'string' ? x.localeCompare(String(y), 'ar') : x - Number(y)) * sort.dir
    })
  }, [vols.data, hr.data, search, filters, sort])

  const groups = useMemo(() => {
    const order: VolunteerStatus[] = ['مسئول', 'مشروع مسئول', 'مدرب', 'تحت المتابعة', 'خارج المتابعة']
    return order.map((s) => ({ status: s, rows: rows.filter((r) => r.status === s) })).filter((g) => g.rows.length)
  }, [rows])

  const set = (k: keyof Filters, v: string | boolean) => setFilters((f) => ({ ...f, [k]: v }))
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'name' ? 1 : -1 }))

  return (
    <>
      <PageHeader
        title="المتطوعين"
        subtitle={vols.data ? `بيظهر ${rows.length} من ${vols.data.length}` : undefined}
        actions={
          p.full && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" /> متطوع جديد
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-3 top-2.5 size-5 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو الكود أو الرقم" className="ps-10" />
        </div>
        <Button variant={active ? 'primary' : 'secondary'} onClick={() => setShowFilters((s) => !s)}>
          <Filter className="size-4" /> فلاتر{active ? ` (${active})` : ''}
        </Button>
        <Button variant="secondary" onClick={() => setShowLegend((s) => !s)}>
          <Info className="size-4" /> الألوان
        </Button>
        <div className="flex rounded-xl bg-white p-1 ring-1 ring-line">
          <button onClick={() => setView('cards')} className={clsx('rounded-lg p-1.5', !asTable ? 'bg-brand-700 text-white' : 'text-muted')} aria-label="عرض كروت" title="عرض كروت">
            <LayoutList className="size-4" />
          </button>
          <button onClick={() => setView('table')} className={clsx('rounded-lg p-1.5', asTable ? 'bg-brand-700 text-white' : 'text-muted')} aria-label="عرض جدول" title="عرض جدول">
            <Table2 className="size-4" />
          </button>
        </div>
      </div>

      {showLegend && <Legend full={p.full} />}

      {showFilters && (
        <Card className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="حالة المتطوع">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)} placeholder="الكل" options={STATUSES} />
          </Field>
          {p.full && (
            <Field label="درجة القبول">
              <Select value={filters.acceptance} onChange={(e) => set('acceptance', e.target.value)} placeholder="الكل" options={[...ACCEPTANCE, 'لسه']} />
            </Field>
          )}
          <Field label="اللجنة">
            <Select value={filters.committee} onChange={(e) => set('committee', e.target.value)} placeholder="الكل" options={lookups.data?.list('اللجنة') ?? []} />
          </Field>
          <Field label="النوع">
            <Select value={filters.gender} onChange={(e) => set('gender', e.target.value)} placeholder="الكل" options={['ذكر', 'أنثى']} />
          </Field>
          <Field label="شهر الميلاد">
            <Select value={filters.birthMonth} onChange={(e) => set('birthMonth', e.target.value)} placeholder="الكل" options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          </Field>
          <Field label="الوظيفة فيها">
            <Input value={filters.job} onChange={(e) => set('job', e.target.value)} />
          </Field>
          <Field label="المؤهل فيه">
            <Input value={filters.qualification} onChange={(e) => set('qualification', e.target.value)} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
            <input type="checkbox" checked={filters.inactive} onChange={(e) => set('inactive', e.target.checked)} className="size-4 accent-brand-700" />
            مشاركوش آخر 30 يوم
          </label>
          {active > 0 && (
            <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
              مسح الفلاتر
            </Button>
          )}
        </Card>
      )}

      {vols.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title="مفيش نتايج" />
      ) : asTable ? (
        <VolunteerTable rows={rows} hr={hr.data} full={p.full} sort={sort} onSort={sortBy} onOpen={(id) => navigate(`/volunteers/${id}`)} />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-xs text-muted">
            ترتيب:
            {(['name', 'this_month', 'total', 'last'] as SortKey[]).map((k) => (
              <button key={k} onClick={() => sortBy(k)} className={clsx('rounded-full px-2 py-0.5', sort.key === k ? 'bg-brand-50 font-bold text-brand-800' : 'hover:bg-surface')}>
                {SORT_LABEL[k]}
                {sort.key === k && (sort.dir === 1 ? ' ↑' : ' ↓')}
              </button>
            ))}
          </div>
          {groups.map((g) => (
            <section key={g.status}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted">
                <StatusBadge status={g.status} /> {g.rows.length}
              </h2>
              <Card className="divide-y divide-line p-0">
                {g.rows.map((v) => (
                  <VolunteerRow key={v.id} v={v} acceptance={p.full ? hr.data?.get(v.id)?.acceptance : undefined} onOpen={() => navigate(`/volunteers/${v.id}`)} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
      {adding && <AddVolunteer onClose={() => setAdding(false)} />}
    </>
  )
}

const SORT_LABEL: Record<SortKey, string> = { name: 'الاسم', this_month: 'الشهر ده', total: 'الإجمالي', last: 'آخر مشاركة' }

function Legend({ full }: { full: boolean }) {
  return (
    <Card className="mb-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <p className="mb-2 font-bold">حالة المتطوع</p>
        <ul className="space-y-1.5">
          {STATUSES.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <StatusBadge status={s} />
              <span className="text-xs text-muted">{STATUS_MEANING[s]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 font-bold">العلامات جنب الاسم</p>
        <ul className="space-y-1.5">
          <li className="flex items-center gap-2">
            <Star className="size-4 fill-purple-700 text-purple-700" />
            <span className="text-xs text-muted">مسئول (الاسم بنفسجي)</span>
          </li>
          <li className="flex items-center gap-2">
            <Star className="size-4 fill-blue-700 text-blue-700" />
            <span className="text-xs text-muted">مشروع مسئول (الاسم أزرق)</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-orange-500" />
            <span className="text-xs text-muted">مشاركش آخر 30 يوم</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge tone="green">3 الشهر ده</Badge>
            <span className="text-xs text-muted">عدد مشاركاته المقبولة الشهر ده</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-gray-400">الاسم الرمادي</span>
            <span className="text-xs text-muted">خارج المتابعة</span>
          </li>
          <li className="flex items-center gap-2">
            <MessageCircle className="size-4 text-emerald-600" />
            <span className="text-xs text-muted">يفتح واتساب على رقمه</span>
          </li>
        </ul>
      </div>
      {full && (
        <div>
          <p className="mb-2 font-bold">درجة القبول (بيانات المقابلة)</p>
          <ul className="space-y-1.5">
            {[...ACCEPTANCE, null].map((a) => (
              <li key={a ?? 'none'} className="flex items-center gap-2">
                <AcceptanceBadge value={a} />
                <span className="text-xs text-muted">{a ? ACCEPTANCE_MEANING[a] : 'لسه مفيش تقييم'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

const STATUS_MEANING: Record<VolunteerStatus, string> = {
  'تحت المتابعة': 'متطوع شغال معانا',
  'مشروع مسئول': 'بيتجهز يبقى مسئول',
  مسئول: 'مسئول في النشاط',
  مدرب: 'بيدرّب المتطوعين',
  'خارج المتابعة': 'مشاركش 3 شهور أو أكتر',
}
const ACCEPTANCE_MEANING: Record<string, string> = {
  اختبار: 'لسه تحت الاختبار، بيبقى مقبول بعد 3 شهور',
  مقبول: 'عدّى الاختبار',
  'رفض الانترفيو': 'مكملش بعد المقابلة',
  مرفوض: 'اترفض',
  معتذر: 'اعتذر مؤقتًا',
  'معتذر نهائى': 'اعتذر ومش هيكمل',
  مفصول: 'اتفصل من النشاط',
}

function nameClass(v: VolunteerWithStats) {
  return clsx(
    v.status === 'مسئول' && 'text-purple-700',
    v.status === 'مشروع مسئول' && 'text-blue-700',
    v.status === 'خارج المتابعة' && 'text-gray-400',
  )
}

function NameCell({ v }: { v: VolunteerWithStats }) {
  const responsible = v.status === 'مسئول' || v.status === 'مشروع مسئول'
  return (
    <span className={clsx('flex min-w-0 items-center gap-1 font-semibold', nameClass(v))}>
      {responsible && <Star className="size-4 shrink-0 fill-current" />}
      <span className="truncate">{v.full_name_ar}</span>
      {isStale(v) && <span className="size-2 shrink-0 rounded-full bg-orange-500" title="مشاركش آخر 30 يوم" />}
    </span>
  )
}

function VolunteerRow({ v, acceptance, onOpen }: { v: VolunteerWithStats; acceptance?: VolunteerHr['acceptance']; onOpen: () => void }) {
  const wa = whatsappLink(v.whatsapp ?? v.phone)
  const age = ageFrom(v.birth_date)
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
      <button onClick={onOpen} className="min-w-0 flex-1 text-start">
        <NameCell v={v} />
        <p className="mt-0.5 truncate text-xs text-muted">
          <span className="ltr">{v.code}</span>
          {v.main_committee && ` · ${v.main_committee}`}
          {v.sub_committee && ` + ${v.sub_committee}`}
          {age !== null && ` · ${age} سنة`}
          {v.stats?.last_participation ? ` · آخر مشاركة ${fmtShort(v.stats.last_participation)}` : ' · مفيش مشاركات'}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {acceptance !== undefined && <AcceptanceBadge value={acceptance} />}
          {v.stats && v.stats.this_month > 0 && <Badge tone="green">{v.stats.this_month} الشهر ده</Badge>}
          {v.stats && v.stats.total > 0 && <Badge>{v.stats.total} إجمالي</Badge>}
        </div>
      </button>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50" aria-label="واتساب">
          <MessageCircle className="size-5" />
        </a>
      )}
    </div>
  )
}

function VolunteerTable({
  rows,
  hr,
  full,
  sort,
  onSort,
  onOpen,
}: {
  rows: VolunteerWithStats[]
  hr?: Map<string, VolunteerHr>
  full: boolean
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (k: SortKey) => void
  onOpen: (id: string) => void
}) {
  const [limit, setLimit] = useState(200)
  const Th = ({ k, children, className }: { k?: SortKey; children: ReactNode; className?: string }) => (
    <th className={clsx('whitespace-nowrap px-3 py-2 text-start font-semibold', className)}>
      {k ? (
        <button onClick={() => onSort(k)} className="hover:text-brand-700">
          {children}
          {sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
        </button>
      ) : (
        children
      )}
    </th>
  )
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-xs text-muted">
          <tr>
            <Th>الكود</Th>
            <Th k="name">الاسم</Th>
            <Th>الحالة</Th>
            {full && <Th>القبول</Th>}
            <Th>اللجنة</Th>
            <Th>التليفون</Th>
            <Th>السن</Th>
            <Th k="this_month" className="text-center">الشهر ده</Th>
            <Th k="total" className="text-center">الإجمالي</Th>
            <Th k="last">آخر مشاركة</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, limit).map((v) => {
            const wa = whatsappLink(v.whatsapp ?? v.phone)
            return (
              <tr key={v.id} onClick={() => onOpen(v.id)} className="cursor-pointer hover:bg-surface">
                <td className="ltr px-3 py-2 text-xs text-muted">{v.code}</td>
                <td className="max-w-64 px-3 py-2">
                  <NameCell v={v} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={v.status} />
                </td>
                {full && (
                  <td className="px-3 py-2">
                    <AcceptanceBadge value={hr?.get(v.id)?.acceptance} />
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {v.main_committee ?? '—'}
                  {v.sub_committee && <span className="text-muted"> + {v.sub_committee}</span>}
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  {v.phone ? (
                    <span className="flex items-center gap-1">
                      <a href={`tel:${v.phone}`} className="ltr text-xs hover:text-brand-700">
                        {v.phone}
                      </a>
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer" className="text-emerald-600" aria-label="واتساب">
                          <MessageCircle className="size-4" />
                        </a>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{ageFrom(v.birth_date) ?? '—'}</td>
                <td className="px-3 py-2 text-center font-bold text-emerald-700">{v.stats?.this_month || ''}</td>
                <td className="px-3 py-2 text-center">{v.stats?.total || ''}</td>
                <td className={clsx('whitespace-nowrap px-3 py-2 text-xs', isStale(v) ? 'text-orange-600' : 'text-muted')}>{fmtShort(v.stats?.last_participation)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <Button variant="ghost" onClick={() => setLimit((l) => l + 300)}>
            اعرض أكتر ({rows.length - limit} باقيين)
          </Button>
        </div>
      )}
    </Card>
  )
}

function Directory() {
  const dir = useDirectory()
  const [search, setSearch] = useState('')
  const rows = (dir.data ?? []).filter((v) => !search || v.full_name_ar.includes(search) || v.phone?.includes(search) || v.code.includes(search.toUpperCase()))
  return (
    <>
      <PageHeader title="المتطوعين" subtitle="الاسم والرقم بس" />
      <div className="relative mb-3">
        <Search className="absolute start-3 top-2.5 size-5 text-muted" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو الرقم" className="ps-10" />
      </div>
      {dir.isLoading ? (
        <Spinner />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{v.full_name_ar}</p>
                <p className="ltr text-start text-xs text-muted">{v.phone}</p>
              </div>
              {v.phone && (
                <a href={`tel:${v.phone}`} className="rounded-lg p-2 text-brand-700 hover:bg-brand-50" aria-label="اتصال">
                  <Phone className="size-5" />
                </a>
              )}
              {whatsappLink(v.whatsapp) && (
                <a href={whatsappLink(v.whatsapp)!} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50" aria-label="واتساب">
                  <MessageCircle className="size-5" />
                </a>
              )}
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

function AddVolunteer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const lookups = useLookups()
  const form = useForm<PersonalValues>({ resolver: zodResolver(personalSchema), defaultValues: { full_name_ar: '', phone: '' } })
  const [extra, setExtra] = useState({ national_id: '', main_committee: '', sub_committee: '' })
  const save = useMutation({
    mutationFn: async (v: PersonalValues) => {
      if (extra.national_id && !/^[23]\d{13}$/.test(extra.national_id)) throw { message: 'الرقم القومي 14 رقم ويبدأ بـ 2 أو 3' }
      const { data, error } = await supabase
        .from('volunteers')
        .insert({ ...toPersonalPayload(v), main_committee: extra.main_committee || null, sub_committee: extra.sub_committee || null })
        .select('id')
        .single()
      if (error) throw error
      if (extra.national_id) {
        const r = await supabase.from('volunteer_private').update({ national_id: extra.national_id }).eq('volunteer_id', data.id)
        if (r.error) throw r.error
      }
      return data.id as string
    },
    onSuccess: (id) => {
      toast.success('المتطوع اتضاف')
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      onClose()
      navigate(`/volunteers/${id}`)
    },
    onError: toastError,
  })
  const committees = lookups.data?.list('اللجنة') ?? []
  return (
    <Modal open onClose={onClose} title="متطوع جديد">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <PersonalFields form={form} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="الرقم القومي">
            <Input value={extra.national_id} onChange={(e) => setExtra({ ...extra, national_id: e.target.value })} dir="ltr" inputMode="numeric" />
          </Field>
          <Field label="اللجنة الأساسية">
            <Select value={extra.main_committee} onChange={(e) => setExtra({ ...extra, main_committee: e.target.value })} placeholder="—" options={committees} />
          </Field>
          <Field label="اللجنة الفرعية">
            <Select value={extra.sub_committee} onChange={(e) => setExtra({ ...extra, sub_committee: e.target.value })} placeholder="—" options={committees} />
          </Field>
        </div>
        <Button type="submit" className="w-full" loading={save.isPending}>
          إضافة
        </Button>
        <p className="text-center text-xs text-muted">
          بيانات المقابلة تتكمّل من صفحة المتطوع. <Link to="/admin" className="text-brand-700">القوايم</Link>
        </p>
      </form>
    </Modal>
  )
}

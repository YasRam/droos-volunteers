import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Filter, MessageCircle, Phone, Plus, Search, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtShort, useDirectory, useHrRows, useLookups, useVolunteers, whatsappLink, type VolunteerWithStats } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ACCEPTANCE, STATUSES, type VolunteerStatus } from '@/lib/types'
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

function FullList() {
  const p = usePermissions()
  const navigate = useNavigate()
  const vols = useVolunteers()
  const hr = useHrRows(p.full)
  const lookups = useLookups()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const [adding, setAdding] = useState(false)
  const active = Object.entries(filters).filter(([, v]) => v).length

  const rows = useMemo(() => {
    const s = search.trim()
    const month30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
    return (vols.data ?? []).filter((v) => {
      if (s && !(v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s) || v.full_name_en?.toLowerCase().includes(s.toLowerCase())))
        return false
      if (filters.status && v.status !== filters.status) return false
      if (filters.acceptance && hr.data?.get(v.id)?.acceptance !== filters.acceptance) return false
      if (filters.committee && v.main_committee !== filters.committee && v.sub_committee !== filters.committee) return false
      if (filters.gender && v.gender !== filters.gender) return false
      if (filters.birthMonth && Number(v.birth_date?.slice(5, 7)) !== Number(filters.birthMonth)) return false
      if (filters.job && !v.job?.includes(filters.job)) return false
      if (filters.qualification && !v.qualification?.includes(filters.qualification)) return false
      if (filters.inactive && (v.status !== 'تحت المتابعة' || (v.stats?.last_participation ?? '') >= month30)) return false
      return true
    })
  }, [vols.data, hr.data, search, filters])

  const groups = useMemo(() => {
    const order: VolunteerStatus[] = ['مسئول', 'مشروع مسئول', 'مدرب', 'تحت المتابعة', 'خارج المتابعة']
    return order.map((s) => ({ status: s, rows: rows.filter((r) => r.status === s) })).filter((g) => g.rows.length)
  }, [rows])

  const set = (k: keyof Filters, v: string | boolean) => setFilters((f) => ({ ...f, [k]: v }))

  return (
    <>
      <PageHeader
        title="المتطوعين"
        subtitle={vols.data ? `${rows.length} من ${vols.data.length}` : undefined}
        actions={
          p.full && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" /> متطوع جديد
            </Button>
          )
        }
      />
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-2.5 size-5 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو الكود أو الرقم" className="ps-10" />
        </div>
        <Button variant={active ? 'primary' : 'secondary'} onClick={() => setShowFilters((s) => !s)}>
          <Filter className="size-4" /> فلاتر{active ? ` (${active})` : ''}
        </Button>
      </div>

      {showFilters && (
        <Card className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="حالة المتطوع">
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)} placeholder="الكل" options={STATUSES} />
          </Field>
          {p.full && (
            <Field label="درجة القبول">
              <Select value={filters.acceptance} onChange={(e) => set('acceptance', e.target.value)} placeholder="الكل" options={ACCEPTANCE} />
            </Field>
          )}
          <Field label="اللجنة">
            <Select value={filters.committee} onChange={(e) => set('committee', e.target.value)} placeholder="الكل" options={lookups.data?.list('اللجنة') ?? []} />
          </Field>
          <Field label="النوع">
            <Select value={filters.gender} onChange={(e) => set('gender', e.target.value)} placeholder="الكل" options={['ذكر', 'أنثى']} />
          </Field>
          <Field label="شهر الميلاد">
            <Select
              value={filters.birthMonth}
              onChange={(e) => set('birthMonth', e.target.value)}
              placeholder="الكل"
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
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
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.status}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted">
                <StatusBadge status={g.status} /> {g.rows.length}
              </h2>
              <Card className="divide-y divide-line p-0">
                {g.rows.map((v) => (
                  <VolunteerRow key={v.id} v={v} onOpen={() => navigate(`/volunteers/${v.id}`)} />
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

function VolunteerRow({ v, onOpen }: { v: VolunteerWithStats; onOpen: () => void }) {
  const responsible = v.status === 'مسئول' || v.status === 'مشروع مسئول'
  const out = v.status === 'خارج المتابعة'
  const stale = v.status === 'تحت المتابعة' && (!v.stats?.last_participation || Date.now() - Date.parse(v.stats.last_participation) > 30 * 864e5)
  const wa = whatsappLink(v.whatsapp ?? v.phone)
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
      <button onClick={onOpen} className="min-w-0 flex-1 text-start">
        <p
          className={clsx(
            'flex items-center gap-1 truncate font-semibold',
            v.status === 'مسئول' && 'text-purple-700',
            v.status === 'مشروع مسئول' && 'text-blue-700',
            out && 'text-muted',
          )}
        >
          {responsible && <Star className="size-4 fill-current" />}
          {v.full_name_ar}
          {stale && <span className="size-2 shrink-0 rounded-full bg-orange-500" title="مشاركش من شهر" />}
        </p>
        <p className="truncate text-xs text-muted">
          <span className="ltr">{v.code}</span>
          {v.main_committee && ` · ${v.main_committee}`}
          {v.stats?.last_participation ? ` · آخر مشاركة ${fmtShort(v.stats.last_participation)}` : ' · مفيش مشاركات'}
        </p>
      </button>
      {v.stats && v.stats.this_month > 0 && <Badge tone="green">{v.stats.this_month} الشهر ده</Badge>}
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50" aria-label="واتساب">
          <MessageCircle className="size-5" />
        </a>
      )}
    </div>
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

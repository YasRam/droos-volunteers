import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, UserPlus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import ActivityFields, { activitySchema, checkActivity, eventForm, toActivityPayload, type ActivityValues } from '@/components/ActivityFields'
import { Button, Card, Input, PageHeader } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { addDays, cairoToday, useDirectory, useLookups } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

const fmtNames = (ids: string[], names: Map<string, string>) => ids.map((id) => names.get(id) ?? id).join('، ')

interface Outcome {
  inserted: number
  skipped: string[]
  pending: boolean
}

/**
 * One screen for «حضرت النهارده» and «تسجيل نشاط».
 * A volunteer registers only themselves, for today, and waits for approval.
 * Anyone with registration rights (staff) picks any number of people, themselves included.
 */
export default function RegisterActivity() {
  const p = usePermissions()
  const { me } = useAuth()
  const qc = useQueryClient()
  const today = cairoToday()
  const canPickOthers = p.canRegisterActivity
  const dir = useDirectory(canPickOthers)
  const lookups = useLookups()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>(() => (p.volunteerId ? [p.volunteerId] : []))
  const defaults = { activity_date: today, event: '', place: 'الفرع', with_content: true, content_date: today }
  const form = useForm<ActivityValues>({ resolver: zodResolver(activitySchema), defaultValues: defaults })

  const names = useMemo(() => {
    const m = new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar]))
    if (p.volunteerId && me?.full_name) m.set(p.volunteerId, me.full_name)
    return m
  }, [dir.data, p.volunteerId, me?.full_name])

  const matches = useMemo(() => {
    const s = search.trim()
    if (!s) return []
    return (dir.data ?? [])
      .filter((v) => !selected.includes(v.id) && (v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s)))
      .slice(0, 8)
  }, [search, dir.data, selected])

  const save = useMutation({
    mutationFn: async (v: ActivityValues): Promise<Outcome> => {
      const out = await saveOne(v)
      // «حضّرت محتوى الحصة دي كمان»: the same class counted once more as content preparation
      if (v.with_content && eventForm(lookups.data?.rows, v.event) === 'teaching') {
        await saveOne({ ...v, event: 'تحضير محتوى', activity_date: v.content_date || v.activity_date, beneficiaries: '', with_content: false }, true)
      }
      return out
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['followups'] })
      qc.invalidateQueries({ queryKey: ['my-activities'] })
      qc.invalidateQueries({ queryKey: ['my-stats'] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['lookups'] })
      const skipped = r.skipped.length ? `اتخطّينا (متسجلين قبل كده): ${fmtNames(r.skipped, names)}` : undefined
      if (r.pending) toast.success('طلبك وصل، والإدارة هتوافق عليه', { description: skipped })
      else if (r.inserted) toast.success(r.inserted === 1 && !canPickOthers ? 'اتسجل حضورك' : `اتسجل ${r.inserted}`, { description: skipped })
      else toast.info('مفيش جديد، كلهم متسجلين نفس النشاط قبل كده')
      again()
    },
    onError: toastError,
  })

  async function saveOne(v: ActivityValues, extra = false): Promise<Outcome> {
    const kind = extra ? 'teaching' : eventForm(lookups.data?.rows, v.event)
    {
      if (!canPickOthers) {
        const { data, error } = await supabase
          .from('participations')
          .insert({ ...toActivityPayload(v, kind), volunteer_id: p.volunteerId })
          .select('status')
          .single()
        if (error) throw error
        return { inserted: 1, skipped: [], pending: data.status === 'pending' }
      }
      if (!selected.length) throw { message: 'اختار متطوع واحد على الأقل' }
      const { data, error } = await supabase.rpc('register_activity', { p_activity: toActivityPayload(v, kind), p_volunteer_ids: selected })
      if (error) throw error
      const r = data as { inserted: number; skipped_ids: string[] }
      return { inserted: r.inserted, skipped: r.skipped_ids, pending: false }
    }
  }

  function again() {
    setSelected(p.volunteerId && !canPickOthers ? [p.volunteerId] : [])
    form.reset(defaults)
  }

  return (
    <>
      <PageHeader
        title="تسجيل حضور"
        subtitle={
          canPickOthers
            ? 'سجّل لنفسك أو لأي عدد من المتطوعين. المشاركة بتتقبل على طول، واللي متسجل نفس النشاط قبل كده بيتخطّى.'
            : 'بتسجّل لنفسك (آخر 6 أيام)، والطلب بيستنى موافقة الإدارة'
        }
      />
      <form onSubmit={form.handleSubmit((v) => checkActivity(form, lookups.data?.rows) && save.mutate(v))} className="space-y-4">
        <Card>
          <p className="mb-3 font-bold">مين حضر؟ {canPickOthers && <span className="font-normal text-muted">({selected.length})</span>}</p>
          {canPickOthers ? (
            <>
              <div className="relative">
                <Search className="absolute start-3 top-2.5 size-5 text-muted" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتب اسم أو كود أو تليفون" className="ps-10" />
                {matches.length > 0 && (
                  <div className="absolute inset-x-0 top-11 z-10 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                    {matches.map((v) => (
                      <button
                        type="button"
                        key={v.id}
                        onClick={() => {
                          setSelected((s) => [...s, v.id])
                          setSearch('')
                        }}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-start hover:bg-surface"
                      >
                        <span className="text-sm font-semibold">{v.full_name_ar}</span>
                        <span className="ltr text-xs text-muted">{v.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {p.volunteerId && !selected.includes(p.volunteerId) && (
                <button type="button" onClick={() => setSelected((s) => [p.volunteerId!, ...s])} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                  <UserPlus className="size-4" /> ضيفني أنا كمان
                </button>
              )}
              {selected.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selected.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 ps-3 pe-1 text-sm font-semibold text-brand-800">
                      {id === p.volunteerId ? 'أنا' : names.get(id)}
                      <button type="button" onClick={() => setSelected((s) => s.filter((x) => x !== id))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="شيل">
                        <X className="size-4" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="rounded-xl bg-surface px-3 py-2 font-semibold">{me?.full_name ?? 'أنا'}</p>
          )}
        </Card>
        <Card>
          <ActivityFields
            form={form}
            dateMin={canPickOthers && !p.organizer ? undefined : addDays(today, -6)}
            dateMax={today}
          />
        </Card>
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>
          {canPickOthers ? `سجّل ${selected.length > 1 ? selected.length + ' متطوعين' : ''}` : 'سجّل حضوري'}
        </Button>
      </form>
    </>
  )
}

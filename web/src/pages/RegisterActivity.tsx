import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Search, UserPlus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import ActivityFields, { activitySchema, toActivityPayload, type ActivityValues } from '@/components/ActivityFields'
import { Button, Card, Input, PageHeader } from '@/components/ui'
import { useAuth, usePermissions } from '@/lib/auth'
import { addDays, cairoToday, fmtDate, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

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
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>(() => (p.volunteerId ? [p.volunteerId] : []))
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const defaults = { activity_date: today, event: '', place: 'الفرع' }
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
      if (!canPickOthers) {
        const { data, error } = await supabase
          .from('participations')
          .insert({ ...toActivityPayload(v), activity_date: today, volunteer_id: p.volunteerId })
          .select('status')
          .single()
        if (error) throw error
        return { inserted: 1, skipped: [], pending: data.status === 'pending' }
      }
      if (!selected.length) throw { message: 'اختار متطوع واحد على الأقل' }
      const { data, error } = await supabase.rpc('register_activity', { p_activity: toActivityPayload(v), p_volunteer_ids: selected })
      if (error) throw error
      const r = data as { inserted: number; skipped_ids: string[] }
      return { inserted: r.inserted, skipped: r.skipped_ids, pending: false }
    },
    onSuccess: (r) => {
      setOutcome(r)
      qc.invalidateQueries({ queryKey: ['followups'] })
      qc.invalidateQueries({ queryKey: ['my-activities'] })
      qc.invalidateQueries({ queryKey: ['my-stats'] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      qc.invalidateQueries({ queryKey: ['lookups'] })
      if (r.inserted) toast.success(r.pending ? 'اتبعت الطلب، مستني موافقة' : `اتسجل ${r.inserted}`)
    },
    onError: toastError,
  })

  const again = () => {
    setOutcome(null)
    setSelected(p.volunteerId && !canPickOthers ? [p.volunteerId] : [])
    form.reset(defaults)
  }

  if (outcome) {
    return (
      <Card className="mx-auto mt-6 max-w-md text-center">
        <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
        <h1 className="mt-3 text-xl font-bold">
          {outcome.pending ? 'طلبك وصل' : outcome.inserted ? `اتسجل ${outcome.inserted === 1 && !canPickOthers ? 'حضورك' : outcome.inserted}` : 'مفيش جديد'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {outcome.pending ? 'الإدارة هتوافق عليه، وهيوصلك إشعار.' : outcome.inserted ? 'المشاركة اتحسبت على طول.' : 'كلهم متسجلين نفس النشاط قبل كده.'}
        </p>
        {outcome.skipped.length > 0 && (
          <div className="mt-3 rounded-xl bg-surface p-3 text-start text-sm">
            <p className="text-muted">اتخطّينا دول لأنهم متسجلين نفس النشاط قبل كده:</p>
            <ul className="mt-1 list-disc ps-5">
              {outcome.skipped.map((id) => (
                <li key={id}>{names.get(id) ?? id}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={again}>
            تسجيل تاني
          </Button>
          {p.volunteerId && (
            <Link to="/me/activities">
              <Button>أنشطتي</Button>
            </Link>
          )}
        </div>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="تسجيل حضور"
        subtitle={
          canPickOthers
            ? 'سجّل لنفسك أو لأي عدد من المتطوعين. المشاركة بتتقبل على طول، واللي متسجل نفس النشاط قبل كده بيتخطّى.'
            : `${fmtDate(today)} · بتسجّل لنفسك، والطلب بيستنى موافقة الإدارة`
        }
      />
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
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
            dateLocked={!canPickOthers}
            dateMin={canPickOthers && p.organizer && !p.full ? addDays(today, -7) : undefined}
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

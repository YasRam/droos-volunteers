import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import ActivityFields, { activitySchema, toActivityPayload, type ActivityValues } from '@/components/ActivityFields'
import { Button, Card, Input, PageHeader } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { addDays, cairoToday, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

interface Result {
  inserted: number
  skipped_ids: string[]
}

export default function RegisterActivity() {
  const p = usePermissions()
  const qc = useQueryClient()
  const today = cairoToday()
  const dir = useDirectory()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const form = useForm<ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: { activity_date: today, event: '', place: 'الفرع' },
  })

  const names = useMemo(() => new Map((dir.data ?? []).map((v) => [v.id, v.full_name_ar])), [dir.data])
  const matches = useMemo(() => {
    const s = search.trim()
    if (!s) return []
    return (dir.data ?? [])
      .filter((v) => !selected.includes(v.id) && (v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s)))
      .slice(0, 8)
  }, [search, dir.data, selected])

  const save = useMutation({
    mutationFn: async (v: ActivityValues) => {
      if (!selected.length) throw { message: 'اختار متطوع واحد على الأقل' }
      const { data, error } = await supabase.rpc('register_activity', { p_activity: toActivityPayload(v), p_volunteer_ids: selected })
      if (error) throw error
      return data as Result
    },
    onSuccess: (r) => {
      setResult(r)
      qc.invalidateQueries({ queryKey: ['followups'] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
      toast.success(`اتسجل ${r.inserted} ${r.inserted === 1 ? 'متطوع' : 'متطوعين'}`)
      setSelected([])
      setSearch('')
    },
    onError: toastError,
  })

  const add = (id: string) => {
    setSelected((s) => [...s, id])
    setSearch('')
  }

  return (
    <>
      <PageHeader title="تسجيل نشاط" subtitle="لمتطوع واحد أو أكتر. اللي متسجل نفس النشاط قبل كده بيتخطّى لوحده." />
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Card>
          <p className="mb-3 font-bold">المتطوعين ({selected.length})</p>
          <div className="relative">
            <Search className="absolute start-3 top-2.5 size-5 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتب اسم أو كود" className="ps-10" />
            {matches.length > 0 && (
              <div className="absolute inset-x-0 top-11 z-10 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                {matches.map((v) => (
                  <button type="button" key={v.id} onClick={() => add(v.id)} className="flex w-full items-center justify-between px-3 py-2 text-start hover:bg-surface">
                    <span className="text-sm font-semibold">{v.full_name_ar}</span>
                    <span className="ltr text-xs text-muted">{v.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 ps-3 pe-1 text-sm font-semibold text-brand-800">
                  {names.get(id)}
                  <button type="button" onClick={() => setSelected((s) => s.filter((x) => x !== id))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="شيل">
                    <X className="size-4" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <ActivityFields form={form} dateMin={p.organizer && !p.full ? addDays(today, -7) : undefined} dateMax={today} />
        </Card>
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>
          سجّل {selected.length > 1 ? `${selected.length} متطوعين` : ''}
        </Button>
      </form>

      {result && (
        <Card className="mt-4">
          <p className="flex items-center gap-2 font-bold text-emerald-700">
            <Check className="size-5" /> اتسجل {result.inserted}
          </p>
          {result.skipped_ids.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="text-muted">اتخطّينا دول لأنهم متسجلين نفس النشاط قبل كده:</p>
              <ul className="mt-1 list-disc ps-5">
                {result.skipped_ids.map((id) => (
                  <li key={id}>{names.get(id) ?? id}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </>
  )
}

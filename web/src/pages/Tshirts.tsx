import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Search, Shirt, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Empty, Input, PageHeader, Spinner, Tabs } from '@/components/ui'
import { useVolunteers } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** Record many T-shirt purchases at once instead of opening each volunteer. */
export default function Tshirts() {
  const qc = useQueryClient()
  const vols = useVolunteers()
  const [tab, setTab] = useState<'add' | 'bought'>('add')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const byId = useMemo(() => new Map((vols.data ?? []).map((v) => [v.id, v])), [vols.data])
  const bought = (vols.data ?? []).filter((v) => v.bought_tshirt)

  const matches = useMemo(() => {
    const s = search.trim()
    if (!s) return []
    return (vols.data ?? [])
      .filter((v) => !v.bought_tshirt && !selected.includes(v.id) && (v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s)))
      .slice(0, 8)
  }, [search, vols.data, selected])

  const save = useMutation({
    mutationFn: async ({ ids, value }: { ids: string[]; value: boolean }) => {
      const { data, error } = await supabase.from('volunteers').update({ bought_tshirt: value }).in('id', ids).select('id')
      if (error) throw error
      return { count: data.length, value }
    },
    onSuccess: ({ count, value }) => {
      toast.success(value ? `اتسجل ${count} اشتروا التيشيرت` : 'اتشال')
      setSelected([])
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })

  if (vols.isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="تسجيل التيشيرت" subtitle="دوّر على اللي اشتروا وضيفهم مرة واحدة، من غير ما تدخل على كل متطوع" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'add', label: 'تسجيل شراء' },
          { value: 'bought', label: 'اشتروا', count: bought.length },
        ]}
      />
      {tab === 'add' ? (
        <div className="space-y-4">
          <Card>
            <p className="mb-3 font-bold">
              مين اشترى؟ <span className="font-normal text-muted">({selected.length})</span>
            </p>
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
            <p className="mt-2 text-xs text-muted">اللي متسجل إنه اشترى قبل كده مش بيظهر في البحث.</p>
            {selected.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 ps-3 pe-1 text-sm font-semibold text-brand-800">
                    {byId.get(id)?.full_name_ar}
                    <button type="button" onClick={() => setSelected((s) => s.filter((x) => x !== id))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="شيل">
                      <X className="size-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Card>
          <Button size="lg" className="w-full" disabled={!selected.length} loading={save.isPending} onClick={() => save.mutate({ ids: selected, value: true })}>
            <Shirt className="size-5" /> سجّل {selected.length || ''} اشتروا التيشيرت
          </Button>
        </div>
      ) : !bought.length ? (
        <Empty title="لسه محدش متسجل إنه اشترى" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {bought.map((v) => (
            <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v.full_name_ar}</span>
              <span className="ltr text-xs text-muted">{v.code}</span>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm(`تشيل إن ${v.full_name_ar} اشترى التيشيرت؟`) && save.mutate({ ids: [v.id], value: false })}>
                شيل
              </Button>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

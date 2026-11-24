import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui'
import { useVolunteers, type VolunteerWithStats } from '@/lib/data'

/** Type-ahead over the volunteers the user can see. */
export function VolunteerSearch({ onPick, exclude = [], placeholder = 'دوّر بالاسم أو الكود أو التليفون' }: { onPick: (v: VolunteerWithStats) => void; exclude?: string[]; placeholder?: string }) {
  const vols = useVolunteers()
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    return (vols.data ?? [])
      .filter((v) => !exclude.includes(v.id) && (v.full_name_ar.includes(s) || v.code.includes(s.toUpperCase()) || v.phone?.includes(s)))
      .slice(0, 8)
  }, [q, vols.data, exclude])
  return (
    <div className="relative">
      <Search className="absolute start-3 top-2.5 size-5 text-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="ps-10" />
      {matches.length > 0 && (
        <div className="absolute inset-x-0 top-11 z-30 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
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
              <span className="truncate text-sm font-semibold">{v.full_name_ar}</span>
              <span className="ltr shrink-0 text-xs text-muted">{v.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One volunteer (or none). */
export function VolunteerSelect({ value, onChange, disabled }: { value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean }) {
  const vols = useVolunteers()
  const picked = value ? vols.data?.find((v) => v.id === value) : null
  if (value)
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-xl border border-line bg-white px-3">
        <span className="truncate text-sm font-semibold">{picked?.full_name_ar ?? '…'}</span>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1 text-muted hover:bg-surface" aria-label="شيل">
            <X className="size-4" />
          </button>
        )}
      </div>
    )
  return disabled ? <div className="flex h-10 items-center rounded-xl border border-line bg-gray-50 px-3 text-sm text-muted">—</div> : <VolunteerSearch onPick={(v) => onChange(v.id)} />
}

/** Several volunteers, shown as removable chips. */
export function VolunteerChips({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const vols = useVolunteers()
  const name = (id: string) => vols.data?.find((v) => v.id === id)?.full_name_ar ?? '…'
  return (
    <div className="space-y-2">
      <VolunteerSearch onPick={(v) => onChange([...value, v.id])} exclude={value} />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 ps-3 pe-1 text-sm font-semibold text-brand-800">
              {name(id)}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="شيل">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

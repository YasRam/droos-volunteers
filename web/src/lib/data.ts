import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { ACCEPTANCE, STATUSES, type Lookup, type Volunteer, type VolunteerDirectoryRow, type VolunteerHr, type VolunteerStats } from './types'

/** Today in Cairo as YYYY-MM-DD (the database uses the same calendar). */
export function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const dateFmt = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })
const shortFmt = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' })
export const fmtDate = (iso?: string | null) => (iso ? dateFmt.format(new Date(iso.slice(0, 10) + 'T00:00:00')) : '—')
export const fmtShort = (iso?: string | null) => (iso ? shortFmt.format(new Date(iso.slice(0, 10) + 'T00:00:00')) : '—')
/** «HH:MM:SS» from the database → 12-hour clock, e.g. «3:15 م». */
export function fmtTime(t?: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`
}
/** «HH:MM» for <input type="time">. */
export const timeInput = (t?: string | null) => (t ? t.slice(0, 5) : '')
const dateTimeFmt = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' })
/** Timestamp → «٢٣ نوفمبر، ٣:١٥ م» in Cairo time. */
export const fmtDateTime = (iso?: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : '—')

export function ageFrom(birth?: string | null): number | null {
  if (!birth) return null
  const b = new Date(birth)
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--
  return age
}

export function whatsappLink(phone?: string | null, text?: string) {
  if (!phone) return null
  const intl = phone.startsWith('0') ? '2' + phone : phone
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

// ---------- shared queries ----------

export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('lookups').select('*').eq('is_active', true).order('sort_order')
      if (error) throw error
      const rows = data as Lookup[]
      const list = (name: string, parent?: string | null) =>
        rows.filter((r) => r.list === name && (parent === undefined || r.parent === parent)).map((r) => r.value)
      return { rows, list }
    },
  })
}

export function useSetting(key: string) {
  return useQuery({
    queryKey: ['setting', key],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
      if (error) throw error
      return (data?.value as string | null) ?? null
    },
  })
}

/** Every row the person may read. The API returns at most 1000 rows per request. */
export async function selectAll<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(order).range(from, from + 999)
    if (error) throw error
    out.push(...(data as T[]))
    if (data.length < 1000) return out
  }
}

/** Volunteers the signed-in person may read, with their participation numbers. */
export function useVolunteers(enabled = true) {
  return useQuery({
    queryKey: ['volunteers'],
    enabled,
    queryFn: async () => {
      const [vols, stats] = await Promise.all([selectAll<Volunteer>('volunteers', 'full_name_ar'), selectAll<VolunteerStats>('volunteer_stats', 'volunteer_id')])
      const byId = new Map(stats.map((s) => [s.volunteer_id, s]))
      return vols.map((v) => ({ ...v, stats: byId.get(v.id) ?? null }))
    },
  })
}
export type VolunteerWithStats = Volunteer & { stats: VolunteerStats | null }

/** Name and phone only — what organizers see. */
export function useDirectory(enabled = true) {
  return useQuery({
    queryKey: ['directory'],
    enabled,
    queryFn: async () => {
      return selectAll<VolunteerDirectoryRow>('volunteer_directory', 'full_name_ar')
    },
  })
}

export function useHrRows(enabled: boolean) {
  return useQuery({
    queryKey: ['volunteer_hr'],
    enabled,
    queryFn: async () => {
      const rows = await selectAll<VolunteerHr>('volunteer_hr_read', 'volunteer_id')
      return new Map(rows.map((h) => [h.volunteer_id, h]))
    },
  })
}

/** Volunteer statuses and acceptance grades: editable lists, with the defaults as fallback. */
export function useStatusOptions() {
  const l = useLookups()
  const statuses = l.data?.list('حالة المتطوع') ?? []
  const acceptance = l.data?.list('حالة القبول') ?? []
  return {
    statuses: statuses.length ? statuses : STATUSES,
    acceptance: acceptance.length ? acceptance : ACCEPTANCE,
  }
}

/** Options for a select that must still show the record's current value, even if hidden from the list. */
export const withCurrent = (options: string[], current: string | null | undefined) => (current && !options.includes(current) ? [...options, current] : options)

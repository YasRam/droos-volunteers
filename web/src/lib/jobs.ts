import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'

/** Positions a person can filter by; everything else is just «متطوع». */
export const JOB_KINDS = ['ليدر النشاط', 'نائب ليدر النشاط', 'ليدر لجنة', 'نائب ليدر لجنة', 'متطوع'] as const

interface LeaderRow {
  volunteer_id: string | null
  committee: string
  role: 'ليدر' | 'نائب'
}

/**
 * The job is not typed in by hand: it comes from the structure.
 * ليدر/نائب ليدر النشاط (from الصلاحيات ← قيادة النشاط), else ليدر/نائب ليدر لجنة X, else متطوع.
 */
export function useJobs() {
  const q = useQuery({
    queryKey: ['committee_leaders', 'jobs'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('committee_leaders').select('volunteer_id, committee, role').not('volunteer_id', 'is', null)
      if (error) throw error
      return data as LeaderRow[]
    },
  })
  const jobOf = useCallback(
    (v: { id: string; position?: string | null } | null | undefined): string => {
      if (!v) return 'متطوع'
      if (v.position === 'ليدر النشاط' || v.position === 'نائب ليدر النشاط') return v.position
      const mine = (q.data ?? []).filter((l) => l.volunteer_id === v.id)
      const lead = mine.filter((l) => l.role === 'ليدر').map((l) => l.committee)
      if (lead.length) return `ليدر لجنة ${lead.join(' و')}`
      const dep = mine.filter((l) => l.role === 'نائب').map((l) => l.committee)
      if (dep.length) return `نائب ليدر لجنة ${dep.join(' و')}`
      return 'متطوع'
    },
    [q.data],
  )
  /** ليدر لجنة / نائب ليدر لجنة / … without the committee name, for filters. */
  const kindOf = useCallback(
    (v: { id: string; position?: string | null }) => {
      const j = jobOf(v)
      return j.startsWith('نائب ليدر لجنة') ? 'نائب ليدر لجنة' : j.startsWith('ليدر لجنة') ? 'ليدر لجنة' : j
    },
    [jobOf],
  )
  return { jobOf, kindOf }
}

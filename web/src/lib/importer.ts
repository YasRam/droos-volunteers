import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import type { ParsedRow } from '@/lib/excel'

export interface ImportResult {
  inserted: number
  skipped: { line: number; reason: string }[]
  failed: { line: number; reason: string }[]
}

const VOLUNTEER_FIELDS = [
  'full_name_ar', 'full_name_en', 'phone', 'whatsapp', 'email', 'qualification', 'job', 'area',
  'availability_notes', 'referral_source', 'registered_at', 'status', 'main_committee', 'sub_committee',
  'contacted', 'passed_committee_test', 'joined_group', 'is_active', 'bought_tshirt', 'attended_minicamp', 'minicamp_date',
] as const
const HR_FIELDS = ['acceptance', 'interview_date', 'interviewer', 'hr_notes'] as const

const pick = (values: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => values[k] !== null && values[k] !== undefined).map((k) => [k, values[k]]))

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order of results. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onProgress?: (done: number) => void) {
  const out: R[] = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
        onProgress?.(++done)
      }
    }),
  )
  return out
}

async function fetchColumn(table: string, column: string) {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(column).not(column, 'is', null).range(from, from + 999)
    if (error) throw error
    out.push(...(data as unknown as Record<string, string>[]).map((r) => String(r[column]).toLowerCase()))
    if (data.length < 1000) return out
  }
}

export async function importVolunteers(rows: ParsedRow[], onProgress: (done: number) => void): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, skipped: [], failed: [] }
  const [phones, emails, nids] = await Promise.all([fetchColumn('volunteers', 'phone'), fetchColumn('volunteers', 'email'), fetchColumn('volunteer_private', 'national_id')])
  const seen = { phone: new Set(phones), email: new Set(emails), nid: new Set(nids) }

  const todo: ParsedRow[] = []
  for (const r of rows) {
    const v = r.values
    const dup = v.phone && seen.phone.has(String(v.phone))
      ? 'التليفون متسجل قبل كده'
      : v.email && seen.email.has(String(v.email))
        ? 'الإيميل متسجل قبل كده'
        : v.national_id && seen.nid.has(String(v.national_id))
          ? 'الرقم القومي متسجل قبل كده'
          : null
    if (dup) {
      result.skipped.push({ line: r.line, reason: dup })
      continue
    }
    if (v.phone) seen.phone.add(String(v.phone))
    if (v.email) seen.email.add(String(v.email))
    if (v.national_id) seen.nid.add(String(v.national_id))
    todo.push(r)
  }

  await pool(todo, 4, async (r) => {
    const v = r.values
    const { data, error } = await supabase.from('volunteers').insert(pick(v, VOLUNTEER_FIELDS)).select('id').single()
    if (error) return result.failed.push({ line: r.line, reason: errorMessage(error) })
    const id = (data as { id: string }).id
    const problems: string[] = []
    if (v.national_id) {
      const { error: e } = await supabase.from('volunteer_private').update({ national_id: v.national_id }).eq('volunteer_id', id)
      if (e) problems.push('الرقم القومي: ' + errorMessage(e))
    }
    const hr = pick(v, HR_FIELDS)
    if (Object.keys(hr).length) {
      const { error: e } = await supabase.from('volunteer_hr').update(hr).eq('volunteer_id', id)
      if (e) problems.push('بيانات المقابلة: ' + errorMessage(e))
    }
    result.inserted++
    if (problems.length) result.failed.push({ line: r.line, reason: 'اتضاف، بس: ' + problems.join(' · ') })
  }, onProgress)
  return result
}

export async function importParticipations(rows: ParsedRow[], onProgress: (done: number) => void): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, skipped: [], failed: [] }
  const ids = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('volunteers').select('id, code').range(from, from + 999)
    if (error) throw error
    for (const r of data) ids.set(String(r.code).toUpperCase(), r.id)
    if (data.length < 1000) break
  }

  await pool(rows, 6, async (r) => {
    const v = r.values
    const volunteerId = ids.get(String(v.volunteer_code))
    if (!volunteerId) return result.failed.push({ line: r.line, reason: `مفيش متطوع بالكود ${v.volunteer_code}` })
    const payload = { ...pick(v, ['activity_date', 'event', 'subject', 'grade', 'place', 'beneficiaries', 'notes']), volunteer_id: volunteerId }
    const { error } = await supabase.from('participations').insert(payload)
    if (!error) return result.inserted++
    if (error.code === '23505') return result.skipped.push({ line: r.line, reason: 'متسجلة قبل كده' })
    result.failed.push({ line: r.line, reason: errorMessage(error) })
  }, onProgress)
  return result
}

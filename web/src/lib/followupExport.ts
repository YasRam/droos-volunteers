// «شيت المتابعة» in the exact layout the branch sends: the template is the branch's own file with
// no data in it (public/templates/followup.xlsx). Row 5 is the prototype row (styles + formulas).
//
// Per volunteer: personal columns A..AC, then six month blocks of 31 day cells
// (1 = في الفرع, 2 = من المنزل) with their totals, then the competition columns IJ..JM.
import { selectAll } from './data'
import { supabase } from './supabase'
import type { Volunteer, VolunteerHr, VolunteerPrivate } from './types'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر']
const MONTHS_HAMZA = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const BLOCK_START = 32 // AF
const BLOCK_WIDTH = 35 // 31 days + من المنزل + في الفرع + الإجمالي + فاصل
const COMPETITION_FIRST = 244 // IJ: first month of the old competition (14 months), then IX..JC = the six blocks
const PROTO = 5

type Row = Volunteer & { national_id?: string | null; acceptance?: string | null }

/** First month of the season that contains `iso` (seasons start in August, like the branch file). */
export function seasonStart(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${m >= 8 ? y : y - 1}-08-01`
}

const addMonths = (iso: string, n: number) => {
  const [y, m] = iso.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}
const monthName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]

function classify(v: Row) {
  const out = v.status === 'خارج المتابعة'
  const D = v.out_reason ? null : v.status === 'مدرب' ? 'مدرب' : out ? 'خارج المتابعة' : 'داخل المتابعة'
  const Q = v.status === 'مسئول' ? 'مسئول' : v.status === 'مشروع مسئول' ? 'مشروع مسئول' : v.acceptance === 'اختبار' ? 'جديد بلا درجة' : 'عادى'
  const R = v.acceptance === 'معتذر' ? 'اجازة' : v.acceptance === 'معتذر نهائى' ? 'مستقيل' : v.acceptance === 'مفصول' ? 'وقف دائم' : 'سارى'
  const recent = v.registered_at && Date.now() - new Date(v.registered_at).getTime() < 90 * 86_400_000
  const S = out || v.out_reason ? 'خارج المتابعة' : recent ? 'جديد' : 'داخل المتابعة'
  return { D, E: v.out_reason ?? null, Q, R, S }
}

const phone = (p?: string | null) => (p && /^\d+$/.test(p) ? Number(p) : p ?? null)
const age = (birth?: string | null) => {
  if (!birth) return null
  const b = new Date(birth)
  const n = new Date()
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
}

/** Builds the file for the season starting `start` (YYYY-MM-01), filling days up to `until` (YYYY-MM-DD). */
export async function exportFollowup(start: string, until: string): Promise<{ blob: Blob; name: string; people: number }> {
  const ExcelJS = (await import('exceljs')).default
  const [vols, priv, hr, tpl] = await Promise.all([
    selectAll<Volunteer>('volunteers', 'full_name_ar'),
    selectAll<VolunteerPrivate>('volunteer_private', 'volunteer_id').catch(() => [] as VolunteerPrivate[]),
    selectAll<VolunteerHr>('volunteer_hr_read', 'volunteer_id').catch(() => [] as VolunteerHr[]),
    fetch(`${import.meta.env.BASE_URL}templates/followup.xlsx`).then((r) => {
      if (!r.ok) throw { message: 'مقدرتش أجيب نموذج شيت المتابعة' }
      return r.arrayBuffer()
    }),
  ])
  const from = addMonths(start, -14)
  const { data: days, error } = await supabase.rpc('report_followup_days', { p_from: from, p_to: until })
  if (error) throw error

  const privBy = new Map(priv.map((r) => [r.volunteer_id, r.national_id]))
  const hrBy = new Map(hr.map((r) => [r.volunteer_id, r.acceptance]))
  const nameBy = new Map(vols.map((v) => [v.id, v.full_name_ar]))
  const dayBy = new Map<string, Map<string, number>>() // volunteer -> 'YYYY-MM-DD' -> 1/2
  for (const d of days as { volunteer_id: string; day: string; code: number }[]) {
    if (!dayBy.has(d.volunteer_id)) dayBy.set(d.volunteer_id, new Map())
    dayBy.get(d.volunteer_id)!.set(d.day, d.code)
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(tpl)
  const ws = wb.getWorksheet('شيت المتابعة')!
  const proto = ws.getRow(PROTO)
  const width = ws.columnCount

  // Month labels: the six blocks, then the 20 competition months
  for (let b = 0; b < 6; b++) ws.getCell(1, BLOCK_START + b * BLOCK_WIDTH).value = monthName(addMonths(start, b))
  for (let i = 0; i < 20; i++) ws.getCell(1, COMPETITION_FIRST + i).value = MONTHS_HAMZA[Number(addMonths(from, i).slice(5, 7)) - 1]

  const protoFormulas = new Map<number, string>()
  const protoStyles = new Map<number, Partial<import('exceljs').Style>>()
  for (let c = 1; c <= width; c++) {
    const cell = proto.getCell(c)
    const v = cell.value as { formula?: string; sharedFormula?: string } | null
    const f = v && typeof v === 'object' ? (v.formula ?? null) : null
    if (f) protoFormulas.set(c, f)
    protoStyles.set(c, { ...cell.style })
  }
  const shift = (f: string, row: number) => f.replace(/(\$?[A-Z]{1,3})5(?!\d)/g, `$1${row}`)

  const rows: Row[] = vols.map((v) => ({ ...v, national_id: privBy.get(v.id) ?? null, acceptance: hrBy.get(v.id) ?? null }))
  rows.forEach((v, i) => {
    const r = PROTO + i
    const row = ws.getRow(r)
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c)
      cell.style = protoStyles.get(c) ?? {}
      cell.value = null
      const f = protoFormulas.get(c)
      if (f) cell.value = { formula: shift(f, r) }
    }
    const k = classify(v)
    const set = (col: string, value: unknown) => (ws.getCell(`${col}${r}`).value = value as never)
    set('A', i + 1)
    set('B', v.full_name_ar)
    set('C', phone(v.phone))
    set('D', k.D)
    set('E', k.E)
    set('H', v.follower_id ? nameBy.get(v.follower_id) : null)
    set('I', v.follower_trainee_id ? nameBy.get(v.follower_trainee_id) : null)
    set('J', v.follow_head_id ? nameBy.get(v.follow_head_id) : null)
    set('K', v.follow_notes_1)
    set('L', v.follow_notes_2)
    set('M', v.follow_notes_3)
    set('N', 'دروس التقويه')
    set('O', 'الاسكندريه')
    set('P', v.gender === 'أنثى' ? 'انثى' : v.gender)
    set('Q', k.Q)
    set('R', k.R)
    set('S', k.S)
    set('T', age(v.birth_date))
    set('U', v.study_year)
    set('V', v.birth_date ? new Date(v.birth_date) : null)
    set('W', v.national_id ? Number(v.national_id) : null)
    set('X', v.registered_at ? new Date(v.registered_at.slice(0, 10)) : null)
    set('Y', v.facebook)
    set('Z', phone(v.whatsapp))
    set('AA', v.email)
    set('AB', v.bought_tshirt ? 1 : null)
    set('AC', v.attended_minicamp ? 1 : null)

    const mine = dayBy.get(v.id)
    if (!mine) return
    for (let b = 0; b < 6; b++) {
      const m = addMonths(start, b)
      for (let d = 1; d <= 31; d++) {
        const code = mine.get(`${m.slice(0, 8)}${String(d).padStart(2, '0')}`)
        if (code) row.getCell(BLOCK_START + b * BLOCK_WIDTH + d - 1).value = code
      }
    }
    // Old competition months (14 before the season): participation days, like the branch file
    for (let i2 = 0; i2 < 14; i2++) {
      const m = addMonths(from, i2).slice(0, 7)
      let n = 0
      mine.forEach((_, day) => day.startsWith(m) && n++)
      if (n) row.getCell(COMPETITION_FIRST + i2).value = n
    }
  })

  const buf = await wb.xlsx.writeBuffer()
  const half = Number(until.slice(8, 10)) <= 15 ? 'نص اول' : 'نص تاني'
  const name = `دروس تقوية .. الاسكندرية شهر ${Number(until.slice(5, 7))} ${half}.xlsx`
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name, people: rows.length }
}

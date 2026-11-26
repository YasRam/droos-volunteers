/**
 * Reads the students' workbook (the Google Sheet downloaded as .xlsx) into the payload of
 * students.import_sheet. Everything happens in the browser; nothing is uploaded but the result.
 *
 * Sheets it understands:
 *   «بيانات الطلاب»  the admission form answers (one row a student)
 *   «1 ب» … «3 ع»    one sheet a grade: the students and a column a class (subject, kind, date, marks)
 *   «انتظار»         the waiting list
 */
import type { Workbook } from 'exceljs'

export interface SheetStudent {
  key: string
  name: string
  gender?: string | null
  school?: string | null
  shift?: string | null
  notes?: string | null
  grade?: string | null
  status?: string
  is_new?: boolean
  papers?: string
  national_id?: string | null
  private?: Record<string, string | number | null>
  guardian?: { name: string; national_id: string | null; valid_until: string | null; job: string | null; phone: string | null }
  phones?: { number: string; label: string; is_whatsapp: boolean }[]
}
export interface SheetSession {
  key: string
  grade: string
  date: string
  subject: string
  subjects: string[]
  kind: string
  note?: string
  marks: { student: string; mark: string }[]
}
export interface SheetReport {
  grades: { grade: string; students: number; classes: number }[]
  rosterOnly: { grade: string; name: string }[]          // in an attendance sheet, not in «بيانات الطلاب»
  fuzzy: { grade: string; name: string; matched: string }[] // matched despite another spelling
  formOnly: number                                        // in «بيانات الطلاب», in no attendance sheet
  waiting: number
  guessedDates: { grade: string; subject: string; date: string }[]
  badNationalIds: number
  duplicateForms: number
  unknownMarks: string[]
  skipped: string[]                                       // sheets it did not understand
}
export interface SheetPayload {
  term: { name: string; starts_on: string; ends_on: string }
  students: SheetStudent[]
  sessions: SheetSession[]
}

type Grid = string[][]
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function cellText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown; error?: unknown }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if ('result' in o) return cellText(o.result)
    if ('text' in o) return cellText(o.text)
  }
  return ''
}

function grid(ws: Workbook['worksheets'][number]): Grid {
  const out: Grid = []
  const cols = ws.columnCount
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c).value).trim())
    out.push(cells)
  }
  return out
}

/** Same name whatever the spelling (kept in step with students.norm_name in the database). */
export function normName(s: string | null | undefined) {
  return (s ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/(^|\s)(عبد|ابو)\s+/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ratcliff/Obershelp (as Python's difflib): 2 × matching characters ÷ both lengths. */
function similarity(a: string, b: string) {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const matching = (a0: number, a1: number, b0: number, b1: number): number => {
    let best = 0
    let bi = 0
    let bj = 0
    for (let i = a0; i < a1; i++) {
      for (let j = b0; j < b1; j++) {
        let k = 0
        while (i + k < a1 && j + k < b1 && a[i + k] === b[j + k]) k++
        if (k > best) {
          best = k
          bi = i
          bj = j
        }
      }
    }
    if (!best) return 0
    return best + matching(a0, bi, b0, bj) + matching(bi + best, a1, bj + best, b1)
  }
  return (2 * matching(0, a.length, 0, b.length)) / (a.length + b.length)
}

/** d/m/yyyy, yyyy/m/d or yyyy-mm-dd (with or without a time after it). */
function parseDate(s: string): Date | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return valid(+m[3], +m[2], +m[1])
  return null
}
function valid(y: number, mo: number, d: number) {
  if (y < 1900 || y > 2100) return null
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null
}

let badIds = 0
function nationalId(s: string | undefined): string | null {
  const t = (s ?? '').replace(/\D/g, '')
  if (!/^[23]\d{13}$/.test(t)) return null
  if (!valid((t[0] === '2' ? 1900 : 2000) + +t.slice(1, 3), +t.slice(3, 5), +t.slice(5, 7))) {
    badIds++
    return null
  }
  return t
}

function phones(...vals: (string | undefined)[]): string[] {
  const out: string[] = []
  for (const v of vals) {
    for (const m of (v ?? '').replace(/-/g, ' - ').match(/\d[\d\s]{8,13}\d/g) ?? []) {
      let d = m.replace(/\D/g, '')
      if (d.length === 10 && d[0] === '1') d = '0' + d
      if (d.length === 12 && d.startsWith('20')) d = '0' + d.slice(2)
      if (/^01[0125]\d{8}$/.test(d) && !out.includes(d)) out.push(d)
    }
  }
  return out
}

const count = (s: string | undefined) => {
  const t = (s ?? '').trim()
  return /^\d+$/.test(t) && +t <= 20 ? +t : null
}
const shift = (s: string | undefined) => (/صباح/.test(s ?? '') ? 'صباحي' : /مسائ/.test(s ?? '') ? 'مسائي' : null)
const gradeCode = (s: string) => {
  const m = s.replace(/\s+/g, '').match(/^(\d)([بع])$/)
  return m ? `${m[1]} ${m[2]}` : null
}
const NEXT: Record<string, string> = {
  '1 ب': '2 ب', '2 ب': '3 ب', '3 ب': '4 ب', '4 ب': '5 ب', '5 ب': '6 ب', '6 ب': '1 ع', '1 ع': '2 ع', '2 ع': '3 ع', '3 ع': '3 ع',
}
const STATUSES = ['انتظار', 'لم يمتحن', 'انتظار التصحيح', 'إعادة امتحان', 'مقبول', 'مرفوض', 'بلاك ليست']
const status = (s: string) => {
  const t = s.trim().replace(/^اعادة/, 'إعادة')
  return STATUSES.includes(t) ? t : 'انتظار'
}
const KINDS = new Set(['اساسى', 'أساسي', 'اساسي', 'تأسيس', 'ازهرى', 'امتحان', 'غير دراسى', 'ملغى'])
/** Names a weekly class may carry for a subject written in the sheet. */
const ALIASES: Record<string, string[]> = {
  'تربية دينية/قرأن': ['تربية دينية', 'قرآن', 'قرأن', 'تربية دينية/قرأن'],
  'رياضيات': ['رياضيات', 'رياضة'],
}

interface GradeSheet {
  grade: string
  students: string[]
  sessions: { date: Date | null; subject: string; kind: string; marks: Map<string, string> }[]
}

function readGrade(grade: string, g: Grid): GradeSheet | null {
  const label = (t: string) => g.findIndex((r) => (r[1] ?? '') === t)
  const di = label('التاريخ')
  if (di < 0) return null
  const si = label('المادة')
  const ki = label('نوع الحصة')
  const studs = g
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => /^\d+$/.test(r[0] ?? '') && r[1] && !['الاسم', 'عدد الحصص'].includes(r[1]))
  const width = Math.min(204, Math.max(...g.map((r) => r.length)))
  const sessions: GradeSheet['sessions'] = []
  for (let c = 4; c < width; c++) {
    const marks = new Map<string, string>()
    for (const { r } of studs) if (r[c]) marks.set(r[1], r[c])
    const date = parseDate(g[di][c] ?? '')
    if (!marks.size && !date) continue
    let subject: string
    let kind: string
    if (si >= 0) {
      subject = g[si][c] ?? ''
      kind = ki >= 0 ? (g[ki][c] ?? '') : ''
    } else {
      const a = g[di - 2]?.[c] ?? ''
      const b = g[di - 1]?.[c] ?? ''
      ;[subject, kind] = KINDS.has(a) ? [b, a] : [a, b]
    }
    sessions.push({ date, subject, kind, marks })
  }
  return { grade, students: studs.map(({ r }) => r[1]), sessions }
}

export async function readStudentWorkbook(
  file: File,
  term: SheetPayload['term'],
  knownMarks: string[],
): Promise<{ payload: SheetPayload; report: SheetReport }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  badIds = 0

  const report: SheetReport = {
    grades: [], rosterOnly: [], fuzzy: [], formOnly: 0, waiting: 0, guessedDates: [], badNationalIds: 0,
    duplicateForms: 0, unknownMarks: [], skipped: [],
  }
  const termYear = +term.starts_on.slice(0, 4)

  // the form answers
  let form: Record<string, string>[] = []
  const formWs = wb.worksheets.find((w) => normName(w.name) === normName('بيانات الطلاب'))
  if (formWs) {
    const g = grid(formWs)
    const hi = g.findIndex((r) => r[0] === 'طابع زمني')
    if (hi >= 0) {
      const head = g[hi]
      form = g.slice(hi + 1).filter((r) => r[1]).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
    }
  }
  // one row a student: the last answer wins
  const byKey = new Map<string, Record<string, string>>()
  for (const f of form) {
    const k = nationalId(f['الرقم القومى للطالب']) ?? normName(f['اسم الطالب'])
    if (byKey.has(k)) report.duplicateForms++
    byKey.set(k, f)
  }
  const forms = [...byKey.values()]
  const formByName = new Map(forms.map((f) => [normName(f['اسم الطالب']), f]))

  const match = (name: string): [Record<string, string> | null, string] => {
    const k = normName(name)
    if (formByName.has(k)) return [formByName.get(k)!, 'exact']
    const first = k.split(' ')[0]
    const pre = [...formByName.keys()].filter((x) => x.split(' ')[0] === first && (x.startsWith(k) || k.startsWith(x)))
    if (pre.length === 1) return [formByName.get(pre[0])!, 'prefix']
    const scored = [...formByName.keys()]
      .filter((x) => x.split(' ')[0] === first)
      .map((x) => [similarity(k, x), x] as const)
      .sort((a, b) => b[0] - a[0])
    if (scored.length && scored[0][0] >= 0.85 && (scored.length === 1 || scored[1][0] < scored[0][0] - 0.05))
      return [formByName.get(scored[0][1])!, 'fuzzy']
    return [null, 'none']
  }

  // the students
  const students: SheetStudent[] = []
  const seen = new Map<string, string>() // national id or name -> key
  const used = new Set<Record<string, string>>()
  const add = (name: string, f: Record<string, string> | null, extra: Partial<SheetStudent>) => {
    const nid = f ? nationalId(f['الرقم القومى للطالب']) : (extra.national_id ?? null)
    const k = nid ?? normName(name)
    if (seen.has(k)) return seen.get(k)!
    const key = `s${students.length + 1}`
    seen.set(k, key)
    const s: SheetStudent = { key, name: name.trim(), national_id: nid, ...extra }
    if (f) {
      used.add(f)
      const gender = (f['النوع'] ?? '').replace('انثى', 'أنثى')
      s.gender = ['ذكر', 'أنثى'].includes(gender) ? gender : null
      s.school = f['اسم المدرسة'] || null
      s.shift = shift(f['مواعيد المدرسة'])
      const fatherId = nationalId(f['الرقم القومى لولى الامر'])
      let motherId = nationalId(f['الرقم القومى للام'])
      if (motherId && motherId === fatherId) motherId = null
      const d = (v: string) => {
        const x = parseDate(v ?? '')
        return x && x.getFullYear() > 1900 ? iso(x) : null
      }
      s.private = {
        address: f['العنوان'] || null,
        father_name: f['اسم الاب'] || null,
        father_national_id: fatherId,
        father_id_valid_until: d(f['بطاقة ولى الامر سارية حتى']),
        father_job: f['وظيفة ولى الامر'] || null,
        mother_name: f['اسم الام'] || null,
        mother_national_id: motherId,
        mother_id_valid_until: d(f['بطاقة الام سارية حتى']),
        mother_job: f['وظيفة الام'] || null,
        kids_under_5: count(f['عدد الابناء اقل من 5 سنوات']),
        kids_5_to_10: count(f['عدد الابناء من 5 سنوات الى 10 سنوات']),
        boys_over_10: count(f['عدد الاولاد اكبر من 10 سنوات']),
        girls_over_10: count(f['عدد البنات اكبر من 10 سنوات']),
        important_notes: f['ملاحظات هامة'] || null,
      }
      const ph = phones(f['رقم الهاتف'], f['رقم محمول'])
      if (f['اسم الاب'])
        s.guardian = { name: f['اسم الاب'], national_id: fatherId, valid_until: d(f['بطاقة ولى الامر سارية حتى']), job: f['وظيفة ولى الامر'] || null, phone: ph[0] ?? null }
      const list: SheetStudent['phones'] = []
      for (const [col, label] of [['رقم الهاتف', 'البيت/ولي الأمر'], ['رقم محمول', 'محمول'], ['رقم احد الاقارب', 'قريب']] as const)
        for (const p of phones(f[col])) if (!list.some((x) => x.number === p)) list.push({ number: p, label, is_whatsapp: /واتس/.test(f[col] ?? '') })
      s.phones = list
      const paper = (f['ملاحظات'] ?? '').trim()
      s.papers = paper === 'تم' ? 'تم' : /التحقق/.test(paper) ? 'التحقق من الورق' : 'ناقص'
    }
    students.push(s)
    return key
  }

  // attendance sheets
  const sheets: GradeSheet[] = []
  for (const ws of wb.worksheets) {
    const code = gradeCode(ws.name)
    if (!code) {
      if (!['بيانات الطلاب', 'انتظار', 'Database'].some((n) => normName(n) === normName(ws.name))) report.skipped.push(ws.name)
      continue
    }
    const gs = readGrade(code, grid(ws))
    if (gs) sheets.push(gs)
    else report.skipped.push(ws.name)
  }
  const keyOf = new Map<string, string>() // grade|name -> key
  for (const gs of sheets) {
    for (const name of gs.students) {
      const [f, how] = match(name)
      if (!f) report.rosterOnly.push({ grade: gs.grade, name })
      if (how === 'fuzzy') report.fuzzy.push({ grade: gs.grade, name, matched: f!['اسم الطالب'] })
      const key = add(f ? f['اسم الطالب'] : name, f, {
        grade: gs.grade, status: 'مقبول', is_new: f ? f['حاله الطالب'] === 'مستجد' : undefined,
      })
      keyOf.set(`${gs.grade}|${name}`, key)
    }
  }

  // in the form, in no attendance sheet: an application only
  for (const f of forms) {
    if (used.has(f)) continue
    const year = +((f['طابع زمني'] ?? '').match(/(20\d\d)/)?.[1] ?? termYear)
    const g = gradeCode(f['المرحلة الدراسية'] ?? '') ?? ''
    const was = (f['القبول'] ?? '').trim()
    if (year < termYear)
      add(f['اسم الطالب'], f, {
        grade: NEXT[g] ?? g, status: 'انتظار', is_new: false,
        notes: `من استمارة ${year} (كان في ${g || '—'}): ${was || 'من غير حالة'}`,
      })
    else add(f['اسم الطالب'], f, { grade: g, status: status(was), is_new: f['حاله الطالب'] === 'مستجد' })
    report.formOnly++
  }

  // the waiting list
  const waitWs = wb.worksheets.find((w) => normName(w.name) === normName('انتظار'))
  if (waitWs) {
    for (const r of grid(waitWs)) {
      if (!r[0] || r[0] === 'الاسم') continue
      const nid = nationalId(r[1])
      if ((nid && seen.has(nid)) || seen.has(normName(r[0]))) continue
      const before = students.length
      add(r[0], null, { grade: gradeCode(r[4] ?? '') ?? null, status: 'انتظار', is_new: true, notes: 'من شيت الانتظار', national_id: nid })
      if (students.length > before) {
        students[students.length - 1].phones = phones(r[2], r[3]).map((number) => ({ number, label: '', is_whatsapp: false }))
        report.waiting++
      }
    }
  }

  // classes
  const sessions: SheetSession[] = []
  const unknown = new Set<string>()
  for (const gs of sheets) {
    const dates = gs.sessions.map((s) => s.date)
    const ord = new Map<string, number>()
    let classes = 0
    gs.sessions.forEach((s, i) => {
      if (!s.marks.size) return
      let date = s.date
      let note: string | undefined
      if (!date) {
        const prev = [...dates.slice(0, i)].reverse().find(Boolean) ?? null
        const next = dates.slice(i + 1).find(Boolean) ?? null
        date = prev && next ? new Date((prev.getTime() + next.getTime()) / 2) : (prev ?? next)
        if (!date) return
        date = new Date(date.getFullYear(), date.getMonth(), date.getDate())
        note = 'التاريخ تقريبي: مكانش مكتوب في الشيت'
        report.guessedDates.push({ grade: gs.grade, subject: s.subject || 'من غير مادة', date: iso(date) })
      }
      const subject = s.subject || 'حصة'
      const base = `${gs.grade.replace(' ', '')}|${iso(date)}|${subject}`
      const n = (ord.get(base) ?? 0) + 1
      ord.set(base, n)
      const marks: SheetSession['marks'] = []
      for (const [name, mark] of s.marks) {
        if (!knownMarks.includes(mark)) {
          unknown.add(mark)
          continue
        }
        marks.push({ student: keyOf.get(`${gs.grade}|${name}`)!, mark })
      }
      sessions.push({
        key: `${base}|${n}`, grade: gs.grade, date: iso(date), subject, subjects: ALIASES[subject] ?? [subject],
        kind: s.kind === 'امتحان' ? 'امتحان' : 'حصة', note, marks,
      })
      classes++
    })
    report.grades.push({ grade: gs.grade, students: gs.students.length, classes })
  }
  report.unknownMarks = [...unknown]
  report.badNationalIds = badIds
  return { payload: { term, students, sessions }, report }
}

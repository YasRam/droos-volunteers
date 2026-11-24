import { supabase } from '@/lib/supabase'
import { ACCEPTANCE, REQUEST_LABEL, STATUSES, WEEKDAYS, type Participation, type ScheduleSlot, type Volunteer, type VolunteerHr, type VolunteerPrivate } from '@/lib/types'

/**
 * One column of an Excel sheet. `key` is the field in the row object, `header` is what the
 * person sees. `kind` drives both writing (cell type) and reading (parsing back).
 */
export interface Column {
  key: string
  header: string
  kind?: 'text' | 'date' | 'bool' | 'number'
  width?: number
  /** Only on export (derived or system values that an import must not set). */
  readOnly?: boolean
  required?: boolean
}

export const VOLUNTEER_COLUMNS: Column[] = [
  { key: 'code', header: 'الكود', readOnly: true, width: 9 },
  { key: 'full_name_ar', header: 'الاسم بالعربي', required: true, width: 30 },
  { key: 'full_name_en', header: 'الاسم بالإنجليزي', width: 26 },
  { key: 'phone', header: 'التليفون', required: true, width: 14 },
  { key: 'whatsapp', header: 'واتساب', width: 14 },
  { key: 'email', header: 'الإيميل', width: 28 },
  { key: 'national_id', header: 'الرقم القومي', width: 17 },
  { key: 'qualification', header: 'المؤهل', width: 20 },
  { key: 'job', header: 'الوظيفة', width: 18 },
  { key: 'area', header: 'المنطقة', width: 14 },
  { key: 'availability_notes', header: 'المواعيد المتاحة', width: 22 },
  { key: 'referral_source', header: 'عرفتنا منين', width: 16 },
  { key: 'birth_date', header: 'تاريخ الميلاد', kind: 'date', readOnly: true, width: 12 },
  { key: 'gender', header: 'النوع', readOnly: true, width: 7 },
  { key: 'registered_at', header: 'تاريخ التسجيل', kind: 'date', width: 12 },
  { key: 'status', header: 'الحالة', width: 14 },
  { key: 'position', header: 'الوظيفة في النشاط', readOnly: true, width: 14 },
  { key: 'main_committee', header: 'اللجنة الأساسية', width: 14 },
  { key: 'sub_committee', header: 'اللجنة الفرعية', width: 14 },
  { key: 'contacted', header: 'اتواصلنا معاه', kind: 'bool', width: 10 },
  { key: 'passed_committee_test', header: 'عدّى اختبار اللجنة', kind: 'bool', width: 12 },
  { key: 'joined_group', header: 'دخل الجروب', kind: 'bool', width: 10 },
  { key: 'is_active', header: 'نشط', kind: 'bool', width: 7 },
  { key: 'bought_tshirt', header: 'اشترى التيشيرت', kind: 'bool', width: 11 },
  { key: 'attended_minicamp', header: 'حضر الميني كامب', kind: 'bool', width: 11 },
  { key: 'minicamp_date', header: 'تاريخ الميني كامب', kind: 'date', width: 12 },
  { key: 'attended_camp', header: 'حضر الكامب', kind: 'bool', width: 11, readOnly: true },
  { key: 'attended_graduation', header: 'حضر حفلة التخرج', kind: 'bool', width: 11, readOnly: true },
  { key: 'acceptance', header: 'درجة القبول', width: 12 },
  { key: 'interview_date', header: 'تاريخ المقابلة', kind: 'date', width: 12 },
  { key: 'interviewer', header: 'القائم على المقابلة', width: 16 },
  { key: 'hr_notes', header: 'ملاحظات HR', width: 30 },
]

export const PARTICIPATION_COLUMNS: Column[] = [
  { key: 'volunteer_code', header: 'كود المتطوع', required: true, width: 10 },
  { key: 'volunteer_name', header: 'اسم المتطوع', readOnly: true, width: 28 },
  { key: 'activity_date', header: 'التاريخ', kind: 'date', required: true, width: 12 },
  { key: 'event', header: 'الحدث', required: true, width: 16 },
  { key: 'subject', header: 'نوع الحدث', width: 16 },
  { key: 'grade', header: 'السنة الدراسية', width: 12 },
  { key: 'place', header: 'المكان', width: 12 },
  { key: 'beneficiaries', header: 'عدد الطلاب', kind: 'number', width: 9 },
  { key: 'notes', header: 'ملاحظات', width: 30 },
  { key: 'status_label', header: 'الحالة', readOnly: true, width: 10 },
  { key: 'method_label', header: 'الطريقة', readOnly: true, width: 8 },
]

const SCHEDULE_COLUMNS: Column[] = [
  { key: 'day', header: 'اليوم', width: 10 },
  { key: 'starts_at', header: 'من', width: 7 },
  { key: 'ends_at', header: 'إلى', width: 7 },
  { key: 'grade', header: 'السنة الدراسية', width: 12 },
  { key: 'subject', header: 'المادة', width: 16 },
  { key: 'teacher_name', header: 'المدرس', width: 24 },
]

type Row = Record<string, unknown>

// ------------------------------------------------------------------ writing

const HEADER_STYLE = { fontWeight: 'bold', backgroundColor: '#E0F2F1', color: '#004D52' } as const

function toCell(value: unknown, kind: Column['kind']) {
  if (value === null || value === undefined || value === '') return null
  if (kind === 'bool') return { value: value ? 'نعم' : 'لا', type: String }
  if (kind === 'date') {
    const d = new Date(String(value).slice(0, 10) + 'T00:00:00Z')
    return Number.isNaN(d.getTime()) ? String(value) : { value: d, type: Date, format: 'yyyy-mm-dd' }
  }
  if (kind === 'number') return { value: Number(value), type: Number }
  return { value: String(value), type: String }
}

function sheet(name: string, columns: Column[], rows: Row[]) {
  return {
    sheet: name,
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width ?? 14 })),
    data: [columns.map((c) => ({ value: c.header, ...HEADER_STYLE })), ...rows.map((r) => columns.map((c) => toCell(r[c.key], c.kind)))],
  }
}

async function save(sheets: ReturnType<typeof sheet>[], fileName: string) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  // The library's types model each sheet loosely; our cells follow its documented shapes.
  await (writeExcelFile as unknown as (s: unknown, o: unknown) => { toFile: (n: string) => Promise<void> })(sheets, { fontFamily: 'Arial', fontSize: 11 }).toFile(fileName)
}

/** Fetches every row of a table/view, 1000 at a time (the API's page size). */
async function fetchAll<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(order).range(from, from + 999)
    if (error) throw error
    out.push(...(data as T[]))
    if (data.length < 1000) return out
  }
}

export async function exportAll(today: string) {
  const [vols, priv, hr, parts, slots] = await Promise.all([
    fetchAll<Volunteer>('volunteers', 'code'),
    fetchAll<VolunteerPrivate>('volunteer_private', 'volunteer_id'),
    fetchAll<VolunteerHr>('volunteer_hr_read', 'volunteer_id'),
    fetchAll<Participation>('participations', 'activity_date'),
    fetchAll<ScheduleSlot>('schedule_slots', 'starts_at'),
  ])
  const privBy = new Map(priv.map((r) => [r.volunteer_id, r]))
  const hrBy = new Map(hr.map((r) => [r.volunteer_id, r]))
  const volBy = new Map(vols.map((v) => [v.id, v]))

  const volunteerRows = vols.map((v) => ({ ...v, ...hrBy.get(v.id), national_id: privBy.get(v.id)?.national_id }))
  const participationRows = parts
    .slice()
    .reverse()
    .map((p) => ({
      ...p,
      volunteer_code: volBy.get(p.volunteer_id)?.code,
      volunteer_name: volBy.get(p.volunteer_id)?.full_name_ar,
      status_label: REQUEST_LABEL[p.status],
      method_label: p.method === 'group' ? 'جماعي' : 'فردي',
    }))
  const scheduleRows = slots
    .slice()
    .sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.starts_at.localeCompare(b.starts_at))
    .map((s) => ({ ...s, starts_at: s.starts_at.slice(0, 5), ends_at: s.ends_at.slice(0, 5) }))

  await save(
    [sheet('المتطوعين', VOLUNTEER_COLUMNS, volunteerRows), sheet('المشاركات', PARTICIPATION_COLUMNS, participationRows), sheet('جدول الحصص', SCHEDULE_COLUMNS, scheduleRows)],
    `بيانات دروس التقوية ${today}.xlsx`,
  )
  return { volunteers: vols.length, participations: parts.length, slots: slots.length }
}

export type ImportKind = 'volunteers' | 'participations'

const SAMPLE: Record<ImportKind, Row> = {
  volunteers: { full_name_ar: 'محمد أحمد علي', phone: '01012345678', email: 'example@gmail.com', status: 'تحت المتابعة', acceptance: 'اختبار' },
  participations: { volunteer_code: 'V0001', activity_date: '2026-11-20', event: 'تدريس', subject: 'رياضيات', grade: '3 ع', place: 'الفرع', beneficiaries: 12 },
}

export function importColumns(kind: ImportKind) {
  return (kind === 'volunteers' ? VOLUNTEER_COLUMNS : PARTICIPATION_COLUMNS).filter((c) => !c.readOnly)
}

export async function downloadTemplate(kind: ImportKind) {
  const cols = importColumns(kind)
  const notes: Row[] = [
    { a: 'املا شيت «البيانات» صف لكل ' + (kind === 'volunteers' ? 'متطوع' : 'مشاركة') + '، وسيب عناوين الأعمدة زي ما هي.' },
    { a: 'الأعمدة اللي عليها * لازم تتملا. الصف الأول في «البيانات» مثال: امسحه قبل الرفع.' },
    ...(kind === 'volunteers'
      ? [
          { a: 'التليفون والواتساب: 11 رقم يبدأوا بـ 01.' },
          { a: 'الحالة: ' + STATUSES.join(' / ') },
          { a: 'درجة القبول: ' + ACCEPTANCE.join(' / ') },
          { a: 'الخانات اللي إجابتها نعم أو لا: اكتب «نعم» أو «لا».' },
          { a: 'تاريخ الميلاد والنوع بيتحسبوا من الرقم القومي لوحدهم.' },
          { a: 'لو التليفون أو الإيميل أو الرقم القومي متسجل قبل كده، الصف ده بيتخطّى.' },
        ]
      : [
          { a: 'كود المتطوع زي اللي في الموقع (V0029 مثلًا).' },
          { a: 'التاريخ بالشكل ده: 2026-11-20.' },
          { a: 'التدريس وتحضير المحتوى محتاجين نوع الحدث والسنة الدراسية.' },
          { a: 'المشاركة المتسجلة قبل كده (نفس المتطوع واليوم والحدث والمادة والسنة) بتتخطّى.' },
        ]),
  ]
  const headed = cols.map((c) => ({ ...c, header: c.required ? `${c.header} *` : c.header }))
  await save(
    [sheet('البيانات', headed, [SAMPLE[kind]]), { ...sheet('تعليمات', [{ key: 'a', header: 'تعليمات', width: 90 }], notes), stickyRowsCount: 0 }],
    kind === 'volunteers' ? 'نموذج إضافة متطوعين.xlsx' : 'نموذج إضافة مشاركات.xlsx',
  )
}

// ------------------------------------------------------------------ reading

const ARABIC_DIGITS = /[٠-٩]/g
const toLatin = (s: string) => s.replace(ARABIC_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

/** 01xxxxxxxxx from whatever Excel gives back (number without the leading 0, spaces, +20). */
export function normalizePhone(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  let s = toLatin(String(v)).replace(/\D/g, '')
  if (s.startsWith('20') && s.length === 12) s = s.slice(1)
  if (s.length === 10 && s.startsWith('1')) s = '0' + s
  return s
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = toLatin(String(v)).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return 'invalid'
}

function parseBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['نعم', 'اه', 'أيوه', 'ايوه', 'yes', 'true', '1', 'صح', '✓'].includes(s)) return true
  if (['لا', 'لأ', 'no', 'false', '0'].includes(s)) return false
  return null
}

export interface ParsedRow {
  line: number
  values: Row
  errors: string[]
}

/** Reads the first sheet (or the one named «البيانات») and maps its headers to our columns. */
export async function readImport(file: File, kind: ImportKind): Promise<ParsedRow[]> {
  const { default: readExcelFile } = await import('read-excel-file/browser')
  const sheets = (await readExcelFile(file)) as { sheet: string; data: unknown[][] }[]
  const data = (sheets.find((s) => s.sheet === 'البيانات') ?? sheets[0])?.data ?? []
  if (!data.length) return []
  const cols = importColumns(kind)
  const clean = (h: unknown) => String(h ?? '').replace('*', '').trim()
  const headerIndex = new Map(data[0].map((h, i) => [clean(h), i]))
  const missing = cols.filter((c) => c.required && !headerIndex.has(c.header))
  if (missing.length) throw new Error('الأعمدة دي ناقصة من الشيت: ' + missing.map((c) => c.header).join('، '))

  const out: ParsedRow[] = []
  data.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === '')) return
    const values: Row = {}
    const errors: string[] = []
    for (const c of cols) {
      const idx = headerIndex.get(c.header)
      const raw = idx === undefined ? null : cells[idx]
      let v: unknown = raw === undefined ? null : raw
      if (typeof v === 'string') v = v.trim() || null
      if (c.kind === 'date') {
        v = parseDate(v)
        if (v === 'invalid') errors.push(`${c.header}: تاريخ مش مفهوم`)
      } else if (c.kind === 'bool') v = parseBool(v)
      else if (c.kind === 'number') v = v === null ? null : Number(toLatin(String(v)))
      else if (v !== null) v = String(v)
      if (c.required && (v === null || v === '')) errors.push(`${c.header} فاضي`)
      values[c.key] = v
    }
    if (kind === 'volunteers') {
      values.phone = normalizePhone(values.phone)
      values.whatsapp = normalizePhone(values.whatsapp)
      if (values.phone && !/^01\d{9}$/.test(String(values.phone))) errors.push('التليفون لازم 11 رقم يبدأ بـ 01')
      if (values.whatsapp && !/^01\d{9}$/.test(String(values.whatsapp))) errors.push('الواتساب لازم 11 رقم يبدأ بـ 01')
      if (values.national_id) {
        values.national_id = toLatin(String(values.national_id)).replace(/\D/g, '')
        if (!/^[23]\d{13}$/.test(String(values.national_id))) errors.push('الرقم القومي لازم 14 رقم')
      }
      if (values.email) values.email = String(values.email).toLowerCase()
      if (values.status && !STATUSES.includes(values.status as never)) errors.push('الحالة مش من القايمة')
      if (values.acceptance && !ACCEPTANCE.includes(values.acceptance as never)) errors.push('درجة القبول مش من القايمة')
    } else {
      if (values.volunteer_code) values.volunteer_code = String(values.volunteer_code).toUpperCase()
      if (values.beneficiaries !== null && !(Number(values.beneficiaries) > 0)) errors.push('عدد الطلاب لازم رقم أكبر من صفر')
      if (['تدريس', 'تحضير محتوى'].includes(String(values.event)) && (!values.subject || !values.grade)) errors.push('التدريس محتاج نوع الحدث والسنة')
    }
    out.push({ line: i + 2, values, errors })
  })
  return out
}

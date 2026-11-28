import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, Download, Eye, FileSpreadsheet, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, PageHeader } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { readStudentWorkbook, type SheetPayload, type SheetReport } from '@/lib/studentSheet'
import { sdb, useCurrentTerm, useGrades, useMarks } from '@/lib/students'
import { downloadStudentTemplate } from '@/lib/studentTemplate'

type Result = Record<string, number | boolean>

const LABELS: [string, string][] = [
  ['students_new', 'طلاب جداد'],
  ['students_updated', 'طلاب موجودين (بيتكمّل اللي ناقص بس)'],
  ['guardians_new', 'أولياء أمور جداد'],
  ['phones_new', 'أرقام تليفونات جديدة'],
  ['applications_new', 'طلبات قبول جديدة'],
  ['accepted_now', 'اتقبلوا دلوقتي'],
  ['sessions_new', 'حصص جديدة'],
  ['sessions_linked', 'منها اتربطت بحصة الجدول'],
  ['marks_new', 'علامات حضور جديدة'],
  ['marks_changed', 'علامات اتغيرت في الشيت'],
  ['marks_kept', 'علامات زي ما هي'],
  ['warnings', 'هياخدوا «تحذير» (من غير إشعار)'],
  ['over_dismiss', 'وصلوا لحد الفصل (مفيش طلب فصل بيتعمل)'],
]

/** الطلاب ← رفع شيت: read the Google Sheet (.xlsx), preview, then write. */
export default function StudentImport() {
  const qc = useQueryClient()
  const current = useCurrentTerm()
  const marks = useMarks()
  const grades = useGrades()
  const file = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState<SheetPayload['term'] | null>(null)
  const [parsed, setParsed] = useState<{ name: string; payload: SheetPayload; report: SheetReport } | null>(null)
  const [preview, setPreview] = useState<Result | null>(null)
  const [done, setDone] = useState<Result | null>(null)
  const [reading, setReading] = useState(false)

  const t = term ?? (current.data ? { name: current.data.name, starts_on: current.data.starts_on, ends_on: current.data.ends_on } : { name: 'الترم الأول 2026-2027', starts_on: '2026-09-01', ends_on: '2027-01-31' })

  const read = async (f: File) => {
    setReading(true)
    setPreview(null)
    setDone(null)
    try {
      const r = await readStudentWorkbook(f, t, (marks.data ?? []).map((m) => m.code))
      setParsed({ name: f.name, ...r })
      run.mutate({ payload: r.payload, apply: false })
    } catch (e) {
      toastError({ message: `مقدرتش أقرا الملف: ${(e as Error).message}. نزّله من جوجل شيت بصيغة Excel (.xlsx).` })
    } finally {
      setReading(false)
    }
  }

  const run = useMutation({
    mutationFn: async ({ payload, apply }: { payload: SheetPayload; apply: boolean }) => {
      const { data, error } = await sdb().rpc('import_sheet', { p: { ...payload, term: t }, p_apply: apply })
      if (error) throw error
      return data as Result
    },
    onSuccess: (r) => {
      if (r.applied) {
        setDone(r)
        setPreview(null)
        toast.success('البيانات اتضافت')
        qc.invalidateQueries({ queryKey: ['students'] })
      } else setPreview(r)
    },
    onError: toastError,
  })

  const rep = parsed?.report

  return (
    <div className="space-y-4">
      <PageHeader
        title="رفع شيت الطلاب"
        subtitle="بيانات الطلاب والحضور من شيت جوجل. تقدر ترفعه تاني بعد ما يتحدّث: اللي موجود مش بيتكرر."
        actions={
          <>
          <Button variant="secondary" disabled={!grades.data || !marks.data} onClick={() => downloadStudentTemplate(grades.data ?? [], (marks.data ?? []).map((m) => m.code)).catch(toastError)}>
            <Download className="size-4" /> نزّل الشيت الفاضي
          </Button>
          <Link to="/students">
            <Button variant="secondary">
              <ArrowRight className="size-4" /> الطلاب
            </Button>
          </Link>
          </>
        }
      />

      <Card className="space-y-3">
        <p className="text-sm font-bold">1. الترم</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="الاسم">
            <Input value={t.name} onChange={(e) => setTerm({ ...t, name: e.target.value })} />
          </Field>
          <Field label="من">
            <Input type="date" value={t.starts_on} onChange={(e) => setTerm({ ...t, starts_on: e.target.value })} />
          </Field>
          <Field label="لحد">
            <Input type="date" value={t.ends_on} onChange={(e) => setTerm({ ...t, ends_on: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-muted">لو الترم ده مش موجود هيتعمل. الطلاب اللي في شيتات الحضور بيتقبلوا فيه على سنة الشيت.</p>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold">2. الملف</p>
        <p className="text-xs text-muted">
          من جوجل شيت: ملف ← تنزيل ← Microsoft Excel (.xlsx). الملف بيتقري هنا على جهازك، ومفيش حاجة بتتبعت غير البيانات نفسها.
        </p>
        <input
          ref={file}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) read(f)
            e.target.value = ''
          }}
        />
        <Button onClick={() => file.current?.click()} loading={reading || (run.isPending && !preview)} disabled={marks.isLoading}>
          <Upload className="size-4" /> {parsed ? 'اختار ملف تاني' : 'اختار الملف'}
        </Button>
        {parsed && (
          <p className="flex items-center gap-2 text-sm">
            <FileSpreadsheet className="size-4 text-brand-700" /> {parsed.name}
          </p>
        )}
      </Card>

      {rep && (
        <Card className="space-y-3">
          <p className="text-sm font-bold">3. اللي اتقري من الشيت</p>
          <div className="flex flex-wrap gap-2">
            {rep.grades.map((g) => (
              <Badge key={g.grade} tone="brand">
                {g.grade}: {g.students} طالب · {g.classes} حصة
              </Badge>
            ))}
          </div>
          <ul className="space-y-1 text-sm">
            <li>في «بيانات الطلاب» ومش في أي شيت حضور: <b>{rep.formOnly}</b> (بيدخلوا القبول بس)</li>
            <li>من شيت الانتظار: <b>{rep.waiting}</b></li>
            {rep.duplicateForms > 0 && <li>استمارات متكررة لنفس الطالب: <b>{rep.duplicateForms}</b> (اتاخد آخر واحدة)</li>}
            {rep.badNationalIds > 0 && <li className="text-orange-700">أرقام قومية فيها تاريخ ميلاد غلط: <b>{rep.badNationalIds}</b> (اتسابت فاضية)</li>}
          </ul>
          {rep.unknownMarks.length > 0 && (
            <Warn title="علامات حضور مش في القايمة (اتسابت):">{rep.unknownMarks.join('، ')}</Warn>
          )}
          {rep.skipped.length > 0 && <Warn title="شيتات متفهمتش:">{rep.skipped.join('، ')}</Warn>}
          {rep.guessedDates.length > 0 && (
            <Details title={`${rep.guessedDates.length} حصة من غير تاريخ: اتحط لها تاريخ تقريبي وملاحظة`}>
              {rep.guessedDates.map((g, i) => (
                <li key={i}>
                  {g.grade} · {g.subject} · {g.date}
                </li>
              ))}
            </Details>
          )}
          {rep.fuzzy.length > 0 && (
            <Details title={`${rep.fuzzy.length} اسم اتطابق رغم اختلاف الكتابة`}>
              {rep.fuzzy.map((f, i) => (
                <li key={i}>
                  {f.grade}: {f.name} ← {f.matched}
                </li>
              ))}
            </Details>
          )}
          {rep.rosterOnly.length > 0 && (
            <Details title={`${rep.rosterOnly.length} طالب في الحضور ملوش بيانات في «بيانات الطلاب» (هيدخل بالاسم بس)`}>
              {rep.rosterOnly.map((f, i) => (
                <li key={i}>
                  {f.grade}: {f.name}
                </li>
              ))}
            </Details>
          )}
        </Card>
      )}

      {(preview || done) && (
        <Card className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-bold">
            {done ? <CheckCircle2 className="size-5 text-green-600" /> : <Eye className="size-5 text-brand-700" />}
            {done ? '4. اتضاف' : '4. اللي هيحصل لو دوست «نفّذ»'}
          </p>
          <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {LABELS.filter(([k]) => Number((done ?? preview)![k] ?? 0) > 0).map(([k, label]) => (
              <li key={k} className="flex justify-between gap-2 rounded-lg bg-surface px-3 py-1.5">
                <span>{label}</span>
                <b>{String((done ?? preview)![k])}</b>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            الغياب القديم مش بيبعت إشعارات ولا بيعمل طلبات فصل. علامة حضور اتعدلت في الموقع مش بتتغير من الشيت، وخانة فاضية في الشيت مش بتمسح حاجة.
          </p>
          {preview && parsed && (
            <Button onClick={() => run.mutate({ payload: parsed.payload, apply: true })} loading={run.isPending}>
              <CheckCircle2 className="size-4" /> نفّذ
            </Button>
          )}
        </Card>
      )}
    </div>
  )
}

function Warn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {title} {children}
      </span>
    </p>
  )
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <ul className="mt-2 max-h-60 list-disc space-y-0.5 overflow-auto ps-5 text-muted">{children}</ul>
    </details>
  )
}

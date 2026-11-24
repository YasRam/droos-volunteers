import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Tabs } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { cairoToday } from '@/lib/data'
import { downloadTemplate, exportAll, importColumns, readImport, type ImportKind, type ParsedRow } from '@/lib/excel'
import { toastError } from '@/lib/errors'
import { importParticipations, importVolunteers, type ImportResult } from '@/lib/importer'

/** Excel export / import, shown in the settings «البيانات والنسخ الاحتياطية» tab. */
export function DataSection() {
  const { can } = usePermissions()
  return (
    <div className="space-y-4">
      <ExportCard />
      {can('data.import') && <ImportCard />}
    </div>
  )
}

function ExportCard() {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const n = await exportAll(cairoToday())
      toast.success(`اتنزّل: ${n.volunteers} متطوع و${n.participations} مشاركة و${n.slots} حصة`)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <FileSpreadsheet className="size-8 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">تنزيل كل البيانات</p>
          <p className="text-sm text-muted">ملف Excel فيه 3 شيتات: المتطوعين (بالرقم القومي وبيانات المقابلة)، والمشاركات، وجدول الحصص.</p>
        </div>
        <Button onClick={run} loading={busy}>
          <Download className="size-4" /> تنزيل Excel
        </Button>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
        <AlertTriangle className="size-3.5" /> الملف فيه بيانات شخصية. متبعتهوش لحد ومتسيبهوش على جهاز مش بتاعك.
      </p>
    </Card>
  )
}

const KIND_LABEL: Record<ImportKind, string> = { volunteers: 'متطوعين', participations: 'مشاركات' }

function ImportCard() {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<ImportKind>('volunteers')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const reset = () => {
    setRows(null)
    setResult(null)
    setFileName('')
    if (input.current) input.current.value = ''
  }
  const pickFile = async (file?: File) => {
    if (!file) return
    setResult(null)
    setFileName(file.name)
    try {
      setRows(await readImport(file, kind))
    } catch (e) {
      setRows(null)
      toast.error(e instanceof Error ? e.message : 'الملف ده مش Excel مفهوم')
    }
  }

  const valid = rows?.filter((r) => !r.errors.length) ?? []
  const invalid = rows?.filter((r) => r.errors.length) ?? []

  const run = async () => {
    setProgress(0)
    try {
      const r = kind === 'volunteers' ? await importVolunteers(valid, setProgress) : await importParticipations(valid, setProgress)
      setResult(r)
      setRows(null)
      qc.invalidateQueries()
      toast.success(`اتضاف ${r.inserted}`)
    } catch (e) {
      toastError(e)
    } finally {
      setProgress(null)
    }
  }

  return (
    <Card>
      <p className="mb-3 font-bold">إضافة من Excel</p>
      <Tabs
        value={kind}
        onChange={(k) => {
          setKind(k)
          reset()
        }}
        tabs={[
          { value: 'volunteers', label: 'متطوعين جداد' },
          { value: 'participations', label: 'مشاركات' },
        ]}
      />
      <ol className="mb-4 list-decimal space-y-1 ps-5 text-sm text-muted">
        <li>نزّل النموذج واملاه (فيه شيت تعليمات).</li>
        <li>ارفعه هنا، وهتشوف الصفوف السليمة والغلط قبل أي إضافة.</li>
        <li>
          اضغط «إضافة». {kind === 'volunteers' ? 'المتطوع اللي تليفونه أو إيميله أو رقمه القومي متسجل بيتخطّى.' : 'المشاركة المتسجلة قبل كده بتتخطّى.'}
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => downloadTemplate(kind).catch(toastError)}>
          <Download className="size-4" /> نموذج {KIND_LABEL[kind]}
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          <Upload className="size-4" /> {fileName ? 'ملف تاني' : 'ارفع الملف'}
        </Button>
        <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      </div>
      <p className="mt-2 text-xs text-muted">الأعمدة: {importColumns(kind).map((c) => c.header + (c.required ? ' *' : '')).join('، ')}</p>

      {rows && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <p className="text-sm">
            <span className="font-semibold">{fileName}</span>: {rows.length} صف · <span className="font-bold text-emerald-700">{valid.length} سليم</span>
            {invalid.length > 0 && <span className="font-bold text-red-600"> · {invalid.length} فيه غلط</span>}
          </p>
          {invalid.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs text-red-700">
              {invalid.slice(0, 100).map((r) => (
                <li key={r.line}>
                  صف {r.line}: {r.errors.join('، ')}
                </li>
              ))}
            </ul>
          )}
          {valid.length > 0 && (
            <>
              <p className="mt-2 text-xs text-muted">
                أول صفوف: {valid.slice(0, 3).map((r) => String(r.values.full_name_ar ?? `${r.values.volunteer_code} · ${r.values.activity_date} · ${r.values.event}`)).join(' — ')}
              </p>
              <Button className="mt-3" onClick={run} loading={progress !== null}>
                {progress !== null ? `بيضيف ${progress} من ${valid.length}` : `إضافة ${valid.length} ${KIND_LABEL[kind]}`}
              </Button>
              {invalid.length > 0 && <p className="mt-1 text-xs text-muted">الصفوف اللي فيها غلط مش هتتضاف. صلّحها في الملف وارفعه تاني بعدين.</p>}
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-2 rounded-xl bg-surface p-3 text-sm">
          <p className="flex items-center gap-1.5 font-bold text-emerald-700">
            <Check className="size-4" /> اتضاف {result.inserted}
          </p>
          {result.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">اتخطّى {result.skipped.length} لأنهم متسجلين قبل كده</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
                {result.skipped.map((s) => (
                  <li key={s.line}>
                    صف {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.failed.length > 0 && (
            <div className="text-xs text-red-700">
              <p className="font-semibold">{result.failed.length} فيهم مشكلة:</p>
              <ul className="max-h-40 overflow-y-auto">
                {result.failed.map((f) => (
                  <li key={f.line}>
                    صف {f.line}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

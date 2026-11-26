import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, KeyRound, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Spinner, Textarea } from '@/components/ui'
import { accountCall, tempPassword } from '@/lib/account'
import { usePermissions } from '@/lib/auth'
import { fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { sdb, useStudentRules } from '@/lib/students'

interface Report {
  rule_id: string
  agreed: number
  pending: number
  comments: { guardian_id: string; student_id: string | null; name: string; comment: string; agreed: boolean; old: boolean; at: string }[]
}

/** Staff: the rules guardians agree to. Saving a new or reworded rule asks every guardian again. */
export function StudentRulesPage() {
  const qc = useQueryClient()
  const p = usePermissions()
  const canEdit = p.can('students.edit')
  const rules = useStudentRules()
  const report = useQuery({
    queryKey: ['student-rules-report'],
    queryFn: async () => {
      const { data, error } = await sdb().rpc('rules_report')
      if (error) throw error
      return new Map((data as Report[]).map((r) => [r.rule_id, r]))
    },
  })
  const [items, setItems] = useState<{ id?: string; body: string }[] | null>(null)
  useEffect(() => {
    if (rules.data && items === null) setItems(rules.data.map((r) => ({ id: r.id, body: r.body })))
  }, [rules.data, items])
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sdb().rpc('save_rules', { p: (items ?? []).filter((x) => x.body.trim()) })
      if (error) throw error
      return Number(data)
    },
    onSuccess: (n) => {
      toast.success(n ? `اتحفظت، واتبعت إشعار لأولياء الأمور بـ ${n} قاعدة جديدة أو متعدلة` : 'اتحفظت')
      setItems(null)
      qc.invalidateQueries({ queryKey: ['student-rules'] })
      qc.invalidateQueries({ queryKey: ['student-rules-report'] })
    },
    onError: toastError,
  })
  if (rules.isLoading || items === null) return <Spinner />
  const original = new Map((rules.data ?? []).map((r) => [r.id, r.body]))
  const dirty = items.length !== (rules.data ?? []).length || items.some((x) => !x.id || original.get(x.id) !== x.body)
  const move = (i: number, d: number) =>
    setItems((xs) => {
      const a = [...(xs ?? [])]
      const [x] = a.splice(i, 1)
      a.splice(i + d, 0, x)
      return a
    })
  const first = report.data ? [...report.data.values()][0] : undefined
  const total = first ? first.agreed + first.pending : 0
  return (
    <>
      <PageHeader
        title="قواعد الطلاب"
        subtitle="ولي الأمر بيوافق عليها من صفحته (موافق أو تعليق على كل قاعدة). لو وافق على الورق علّمها من صفحة الطالب."
        actions={
          canEdit && (
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              حفظ
            </Button>
          )
        }
      />
      {total > 0 && <p className="mb-3 text-sm text-muted">أولياء أمور طلاب الترم ده: {total}</p>}
      <Card>
        <ol className="space-y-3">
          {items.map((x, i) => {
            const rep = x.id ? report.data?.get(x.id) : undefined
            const changed = x.id && original.get(x.id) !== x.body
            return (
              <li key={x.id ?? `new-${i}`} className="rounded-xl p-3 ring-1 ring-line">
                <div className="flex items-start gap-2">
                  <span className="mt-2 font-bold text-brand-700">{i + 1}.</span>
                  {canEdit ? (
                    <Textarea rows={2} className="flex-1" value={x.body} onChange={(e) => setItems((xs) => xs!.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)))} />
                  ) : (
                    <p className="flex-1 pt-1.5 text-sm leading-7">{x.body}</p>
                  )}
                  {canEdit && (
                    <div className="flex flex-col">
                      <button className="p-1 text-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="فوق">
                        <ArrowUp className="size-4" />
                      </button>
                      <button className="p-1 text-muted disabled:opacity-30" disabled={i === items.length - 1} onClick={() => move(i, 1)} title="تحت">
                        <ArrowDown className="size-4" />
                      </button>
                      <button className="p-1 text-red-600" onClick={() => setItems((xs) => xs!.filter((_, j) => j !== i))} title="امسح">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {!x.id ? (
                    <Badge tone="orange">جديدة</Badge>
                  ) : changed ? (
                    <Badge tone="orange">اتعدلت: هتتطلب موافقة تاني</Badge>
                  ) : (
                    rep && (
                      <>
                        <Badge tone="green">وافق {rep.agreed}</Badge>
                        <Badge tone={rep.pending ? 'orange' : 'gray'}>لسه {rep.pending}</Badge>
                      </>
                    )
                  )}
                </div>
                {rep && rep.comments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {rep.comments.map((c, k) => (
                      <li key={k} className="rounded-lg bg-surface p-2 text-sm">
                        {c.student_id ? (
                          <Link to={`/students/${c.student_id}`} className="font-semibold text-brand-700">
                            {c.name}
                          </Link>
                        ) : (
                          <b>{c.name}</b>
                        )}
                        : {c.comment}
                        <span className="text-xs text-muted">
                          {' '}
                          · {fmtDate(c.at)}
                          {c.old ? ' · على الكلام القديم' : ''}
                          {c.agreed ? ' · ووافق' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
        {canEdit && (
          <Button variant="secondary" className="mt-3" onClick={() => setItems((xs) => [...(xs ?? []), { body: '' }])}>
            <Plus className="size-4" /> قاعدة جديدة
          </Button>
        )}
      </Card>
    </>
  )
}

interface Status {
  student_id: string
  done: boolean
  on_paper: boolean
  has_account: boolean
}

/** On the student's page: did the guardian agree, paper agreement, and passwords for the family page. */
export function FamilyAccessCard({ studentId, hasGuardian }: { studentId: string; hasGuardian: boolean }) {
  const qc = useQueryClient()
  const p = usePermissions()
  const [pw, setPw] = useState<null | 'guardian' | 'student'>(null)
  const st = useQuery({
    queryKey: ['student-rules-status', studentId],
    queryFn: async () => {
      const { data, error } = await sdb().rpc('rules_status', { p_students: [studentId] })
      if (error) throw error
      return ((data as Status[]) ?? [])[0] ?? null
    },
  })
  const paper = useMutation({
    mutationFn: async () => {
      const { error } = await sdb().rpc('mark_rules_paper', { p_student: studentId })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('اتسجل إن ولي الأمر وافق على الورق')
      qc.invalidateQueries({ queryKey: ['student-rules-status', studentId] })
      qc.invalidateQueries({ queryKey: ['student-rules-report'] })
    },
    onError: toastError,
  })
  const s = st.data
  return (
    <Card className="space-y-2">
      <h2 className="flex items-center gap-2 font-bold">
        <ScrollText className="size-4 text-brand-700" /> صفحة الأسرة والقواعد
      </h2>
      {st.isLoading ? (
        <Spinner />
      ) : !hasGuardian ? (
        <p className="text-sm text-muted">مفيش ولي أمر متسجل للطالب ده. ضيفه من «تعديل» عشان يقدر يدخل ويوافق على القواعد.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {s?.done ? <Badge tone="green">ولي الأمر وافق على القواعد{s.on_paper ? ' (على الورق)' : ''}</Badge> : <Badge tone="orange">ولي الأمر لسه موافقش على القواعد</Badge>}
            <Badge tone={s?.has_account ? 'brand' : 'gray'}>{s?.has_account ? 'ولي الأمر عنده حساب' : 'ولي الأمر لسه معملش حساب'}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {!s?.done && (p.can('students.edit') || p.can('students.review')) && (
              <Button variant="secondary" loading={paper.isPending} onClick={() => paper.mutate()}>
                وافق على الورق
              </Button>
            )}
            {p.can('students.accounts') && (
              <>
                <Button variant="secondary" onClick={() => setPw('guardian')}>
                  <KeyRound className="size-4" /> كلمة سر لولي الأمر
                </Button>
                <Button variant="secondary" onClick={() => setPw('student')}>
                  <KeyRound className="size-4" /> كلمة سر للطالب
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted">ولي الأمر بيدخل بموبايله، والطالب برقمه القومي، من «ولي أمر أو طالب» في صفحة الدخول.</p>
        </>
      )}
      {pw && <FamilyPasswordModal studentId={studentId} kind={pw} onClose={() => setPw(null)} />}
    </Card>
  )
}

function FamilyPasswordModal({ studentId, kind, onClose }: { studentId: string; kind: 'guardian' | 'student'; onClose: () => void }) {
  const qc = useQueryClient()
  const [pw, setPw] = useState(() => tempPassword())
  const [done, setDone] = useState<string | null>(null)
  const go = useMutation({
    mutationFn: () => accountCall({ action: 'family_set_password', kind, student_id: studentId, password: pw }, true) as Promise<{ login?: string }>,
    onSuccess: (out) => {
      setDone(out.login ?? '')
      qc.invalidateQueries({ queryKey: ['student-rules-status', studentId] })
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={kind === 'guardian' ? 'كلمة سر لولي الأمر' : 'كلمة سر للطالب'}>
      {done !== null ? (
        <div className="space-y-2 text-sm">
          <p>اتعملت. ابعتهم لـ{kind === 'guardian' ? 'ولي الأمر' : 'الطالب'}:</p>
          <p className="rounded-xl bg-surface p-3" dir="ltr">
            {kind === 'guardian' ? 'موبايل' : 'الرقم القومي'}: <b>{done}</b>
            <br />
            كلمة السر: <b>{pw}</b>
          </p>
          <p className="text-xs text-muted">يدخل من «ولي أمر أو طالب» في صفحة الدخول، ويقدر يغيّرها من «أول مرة تدخل أو نسيت كلمة السر؟».</p>
          <Button className="w-full" onClick={onClose}>
            تمام
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (pw.length >= 8) go.mutate()
          }}
        >
          <Field label="كلمة السر" hint="8 على الأقل">
            <Input value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" />
          </Field>
          <Button type="submit" className="w-full" loading={go.isPending} disabled={pw.length < 8}>
            احفظ
          </Button>
        </form>
      )}
    </Modal>
  )
}

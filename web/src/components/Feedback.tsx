import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Select, Spinner, Textarea } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { fmtShort, useDirectory } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { sdb } from '@/lib/students'
import { supabase } from '@/lib/supabase'

interface Row {
  id: string
  author_id: string | null
  author_name?: string | null
  kind?: string
  body: string
  given_on: string
}

const today = () => new Date().toISOString().slice(0, 10)
const daysSince = (d: string) => Math.floor((Date.now() - Date.parse(d)) / 86400_000)

/**
 * Feedback on a volunteer or a student: who wrote it, when, and what. Taken every 3 months or when
 * needed. For a volunteer, the interview notes are the first one. The person never sees their own.
 */
export function FeedbackCard({ volunteerId, studentId }: { volunteerId?: string; studentId?: string }) {
  const qc = useQueryClient()
  const p = usePermissions()
  const dir = useDirectory()
  const forVolunteer = Boolean(volunteerId)
  const key = ['feedback', volunteerId ?? studentId]
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = forVolunteer
        ? await supabase.from('volunteer_feedback').select('*').eq('volunteer_id', volunteerId!).order('given_on', { ascending: false })
        : await sdb().from('feedback').select('*').eq('student_id', studentId!).order('given_on', { ascending: false })
      if (res.error) throw res.error
      return res.data as Row[]
    },
  })
  const [f, setF] = useState({ body: '', kind: 'متابعة', given_on: today() })
  const add = useMutation({
    mutationFn: async () => {
      if (!f.body.trim()) throw { message: 'اكتب الفيد باك' }
      const row = { author_id: p.volunteerId, body: f.body.trim(), given_on: f.given_on || today() }
      const res = forVolunteer
        ? await supabase.from('volunteer_feedback').insert({ ...row, volunteer_id: volunteerId, kind: f.kind })
        : await sdb().from('feedback').insert({ ...row, student_id: studentId })
      if (res.error) throw res.error
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      setF({ body: '', kind: 'متابعة', given_on: today() })
      qc.invalidateQueries({ queryKey: key })
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = forVolunteer ? await supabase.from('volunteer_feedback').delete().eq('id', id) : await sdb().from('feedback').delete().eq('id', id)
      if (res.error) throw res.error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: toastError,
  })
  if (forVolunteer && volunteerId === p.volunteerId) return null
  const name = (r: Row) => (r.author_id ? dir.data?.find((v) => v.id === r.author_id)?.full_name_ar : null) ?? r.author_name ?? '—'
  const last = q.data?.[0]?.given_on
  const late = !last || daysSince(last) > 90
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquareText className="size-5 text-brand-700" />
        <p className="flex-1 font-bold">الفيد باك</p>
        {late ? <Badge tone="orange">{last ? `آخر فيد باك من ${daysSince(last)} يوم` : 'مفيش فيد باك لسه'}</Badge> : <Badge tone="green">آخر فيد باك {fmtShort(last!)}</Badge>}
      </div>
      <p className="text-xs text-muted">
        كل 3 شهور أو وقت الحاجة. {forVolunteer ? 'ملاحظات المقابلة هي أول فيد باك. المتطوع مبيشوفش الفيد باك بتاعه.' : 'ولي الأمر والطالب مبيشوفوهوش.'}
      </p>
      <div className="space-y-2 rounded-xl bg-surface p-3">
        <Textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="اكتب الفيد باك" />
        <div className="flex flex-wrap items-end gap-2">
          {forVolunteer && (
            <Field label="النوع">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['متابعة', 'مقابلة']} />
            </Field>
          )}
          <Field label="التاريخ">
            <Input type="date" value={f.given_on} onChange={(e) => setF({ ...f, given_on: e.target.value })} />
          </Field>
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!f.body.trim()}>
            ضيف
          </Button>
        </div>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted">مفيش فيد باك لسه.</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((r) => (
            <li key={r.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold text-ink">{name(r)}</span>
                <span>{fmtShort(r.given_on)}</span>
                {r.kind === 'مقابلة' && <Badge tone="purple">المقابلة</Badge>}
                {(r.author_id === p.volunteerId || p.can('volunteers.edit') || p.can('students.edit')) && (
                  <button className="ms-auto text-red-600" onClick={() => confirm('مسح الفيد باك ده؟') && remove.mutate(r.id)} aria-label="مسح">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

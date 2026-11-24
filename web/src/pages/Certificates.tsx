import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, Check, Copy, Download, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ContactLinks, VolunteerName } from '@/components/VolunteerLink'
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, RequestBadge, Spinner, Tabs, Textarea } from '@/components/ui'
import { idCardUrl, summaryText, useParticipationSummary, type CertificateRequest } from '@/lib/certificates'
import { fmtDate, fmtDateTime, useVolunteers } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export default function Certificates() {
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const vols = useVolunteers()
  const byId = useMemo(() => new Map((vols.data ?? []).map((v) => [v.id, v])), [vols.data])
  const [open, setOpen] = useState<CertificateRequest | null>(null)
  const q = useQuery({
    queryKey: ['certificates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('certificate_requests').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as CertificateRequest[]
    },
  })
  const rows = (q.data ?? []).filter((r) => (tab === 'pending' ? r.status === 'pending' : r.status !== 'pending'))
  return (
    <>
      <PageHeader title="شهادات التطوع" subtitle="طلبات المتطوعين بصورة البطاقة وتفاصيل مشاركاتهم" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pending', label: `مستنية (${(q.data ?? []).filter((r) => r.status === 'pending').length})` },
          { value: 'done', label: 'اترد عليها' },
        ]}
      />
      {q.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title={tab === 'pending' ? 'مفيش طلبات مستنية' : 'مفيش طلبات قديمة'} />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => {
            const v = byId.get(r.volunteer_id)
            return (
              <button key={r.id} onClick={() => setOpen(r)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface">
                <Award className="size-5 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{v?.full_name_ar ?? '—'}</p>
                  <p className="truncate text-xs text-muted">
                    {fmtDateTime(r.created_at)}
                    {r.purpose && ` · ${r.purpose}`}
                  </p>
                </div>
                <RequestBadge status={r.status} />
              </button>
            )
          })}
        </Card>
      )}
      {open && <Review request={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function Review({ request, onClose }: { request: CertificateRequest; onClose: () => void }) {
  const qc = useQueryClient()
  const vols = useVolunteers()
  const v = vols.data?.find((x) => x.id === request.volunteer_id)
  const summary = useParticipationSummary(request.volunteer_id)
  const nid = useQuery({
    queryKey: ['nid', request.volunteer_id],
    queryFn: async () => {
      const { data } = await supabase.from('volunteer_private').select('national_id').eq('volunteer_id', request.volunteer_id).maybeSingle()
      return (data?.national_id as string | null) ?? null
    },
  })
  const photo = useQuery({ queryKey: ['id-card', request.id_card_path], queryFn: () => idCardUrl(request.id_card_path), staleTime: 5 * 60_000 })
  const [note, setNote] = useState(request.review_note ?? '')

  const decide = useMutation({
    mutationFn: async (status: 'accepted' | 'rejected') => {
      const { error } = await supabase.from('certificate_requests').update({ status, review_note: note.trim() || null }).eq('id', request.id)
      if (error) throw error
      return status
    },
    onSuccess: (s) => {
      toast.success(s === 'accepted' ? 'اتعلّم إن الشهادة جاهزة، والمتطوع وصله إشعار' : 'الطلب اترفض، والمتطوع وصله إشعار')
      qc.invalidateQueries({ queryKey: ['certificates'] })
      onClose()
    },
    onError: toastError,
  })

  const text = v && summary.data ? summaryText(v.full_name_ar, v.code, summary.data, nid.data) : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('التفاصيل اتنسخت')
    } catch {
      toast.error('مقدرتش أنسخ. حدد النص وانسخه بإيدك.')
    }
  }

  return (
    <Modal open onClose={onClose} title={`شهادة تطوع · ${v?.full_name_ar ?? ''}`}>
      <div className="space-y-4">
        {v && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <VolunteerName id={v.id} name={v.full_name_ar} className="font-semibold" />
            <span className="ltr text-muted">{v.code}</span>
            <ContactLinks phone={v.phone} whatsapp={v.whatsapp} showNumber={false} />
            <RequestBadge status={request.status} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-surface px-3 py-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted">الاسم: </span>
            <span className="font-semibold">{v?.full_name_ar ?? '…'}</span>
          </p>
          <p>
            <span className="text-muted">الرقم القومي: </span>
            <span className="ltr inline-block font-mono font-semibold tracking-wider">{nid.isLoading ? '…' : nid.data ?? 'مش متسجل'}</span>
          </p>
          {request.purpose && (
            <p className="sm:col-span-2">
              <span className="text-muted">الغرض: </span>
              {request.purpose}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-bold">صورة البطاقة</p>
          {photo.isLoading ? (
            <Spinner />
          ) : photo.data ? (
            <div className="space-y-2">
              <img src={photo.data} alt="صورة البطاقة" className="max-h-72 w-full rounded-xl border border-line object-contain" />
              <a href={photo.data} target="_blank" rel="noreferrer" download>
                <Button variant="secondary" size="sm">
                  <Download className="size-4" /> تنزيل الصورة
                </Button>
              </a>
            </div>
          ) : (
            <p className="text-sm text-red-600">الصورة مش متاحة</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-bold">تفاصيل المشاركات</p>
          {summary.isLoading ? (
            <Spinner />
          ) : summary.data ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Badge tone="green">{summary.data.total} مشاركة</Badge>
                <Badge tone="brand">{summary.data.days} يوم</Badge>
                <Badge>{summary.data.beneficiaries} طالب</Badge>
              </div>
              <p className="text-xs text-muted">
                من {fmtDate(summary.data.first_date)} إلى {fmtDate(summary.data.last_date)}
              </p>
              <ul className="space-y-0.5 text-sm">
                {summary.data.by_event.map((e) => (
                  <li key={e.event} className="flex justify-between">
                    <span>{e.event}</span>
                    <span className="text-muted">
                      {e.count} مشاركة · {e.days} يوم
                    </span>
                  </li>
                ))}
              </ul>
              <Button variant="secondary" size="sm" onClick={copy}>
                <Copy className="size-4" /> انسخ التفاصيل
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">مفيش مشاركات</p>
          )}
        </div>

        <Field label="ملاحظة للمتطوع (اختياري)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: استلمها من الفرع يوم السبت" />
        </Field>
        <div className="flex gap-2">
          <Button variant="success" className="flex-1" loading={decide.isPending} onClick={() => decide.mutate('accepted')}>
            <Check className="size-4" /> الشهادة جاهزة
          </Button>
          <Button variant="secondary" className="text-red-600" loading={decide.isPending} onClick={() => decide.mutate('rejected')}>
            <X className="size-4" /> رفض
          </Button>
        </div>
      </div>
    </Modal>
  )
}

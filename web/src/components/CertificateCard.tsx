import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, ImageUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, RequestBadge } from './ui'
import { ID_CARD_BUCKET, type CertificateRequest } from '@/lib/certificates'
import { fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

const MAX_BYTES = 5 * 1024 * 1024

/** The volunteer asks for a volunteering certificate by uploading a photo of their ID card. */
export function CertificateCard({ volunteerId }: { volunteerId: string }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [purpose, setPurpose] = useState('')
  const q = useQuery({
    queryKey: ['my-certificates', volunteerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('certificate_requests').select('*').eq('volunteer_id', volunteerId).order('created_at', { ascending: false })
      if (error) throw error
      return data as CertificateRequest[]
    },
  })
  const pending = q.data?.find((r) => r.status === 'pending')
  const last = q.data?.[0]

  const send = useMutation({
    mutationFn: async () => {
      if (!file) throw { message: 'اختار صورة البطاقة' }
      if (file.size > MAX_BYTES) throw { message: 'الصورة أكبر من 5 ميجا. صوّرها تاني بحجم أصغر.' }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${volunteerId}/${Date.now()}.${ext}`
      const up = await supabase.storage.from(ID_CARD_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (up.error) throw up.error
      const { error } = await supabase.from('certificate_requests').insert({ volunteer_id: volunteerId, id_card_path: path, purpose: purpose.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('طلبك اتبعت مع صورة البطاقة')
      setFile(null)
      setPurpose('')
      qc.invalidateQueries({ queryKey: ['my-certificates', volunteerId] })
    },
    onError: toastError,
  })

  return (
    <Card>
      <p className="flex items-center gap-2 font-bold">
        <Award className="size-5 text-amber-600" /> شهادة تطوع
      </p>
      {pending ? (
        <p className="mt-2 text-sm">
          طلبك من {fmtDate(pending.created_at)} <RequestBadge status="pending" />. هيوصلك إشعار أول ما تجهز.
        </p>
      ) : (
        <>
          {last && (
            <p className="mt-2 text-sm">
              آخر طلب ({fmtDate(last.created_at)}): <RequestBadge status={last.status} />
              {last.review_note && <span className="block text-xs text-muted">{last.review_note}</span>}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">ارفع صورة واضحة للبطاقة، والإدارة هتطلع الشهادة بتفاصيل مشاركاتك. الصورة بتتحفظ في مكان خاص، والإدارة بس اللي بتشوفها.</p>
          <div className="mt-3 space-y-3">
            <Field label="الشهادة لإيه؟ (اختياري)">
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="مثلاً: للجامعة" />
            </Field>
            <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button variant="secondary" className="w-full" onClick={() => input.current?.click()}>
              <ImageUp className="size-4" /> {file ? file.name : 'صورة البطاقة'}
            </Button>
            <Button className="w-full" onClick={() => send.mutate()} loading={send.isPending} disabled={!file}>
              اطلب الشهادة
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

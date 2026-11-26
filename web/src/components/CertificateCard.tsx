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

/** The volunteer asks for a volunteering certificate by uploading photos of both sides of their ID card. */
export function CertificateCard({ volunteerId }: { volunteerId: string }) {
  const qc = useQueryClient()
  const frontInput = useRef<HTMLInputElement>(null)
  const backInput = useRef<HTMLInputElement>(null)
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
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
      if (!front || !back) throw { message: 'ارفع صورة وش البطاقة وضهرها' }
      if (front.size > MAX_BYTES || back.size > MAX_BYTES) throw { message: 'الصورة أكبر من 5 ميجا. صوّرها تاني بحجم أصغر.' }
      const upload = async (file: File, side: string) => {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${volunteerId}/${Date.now()}-${side}.${ext}`
        const up = await supabase.storage.from(ID_CARD_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
        if (up.error) throw up.error
        return path
      }
      const [frontPath, backPath] = await Promise.all([upload(front, 'front'), upload(back, 'back')])
      const { error } = await supabase
        .from('certificate_requests')
        .insert({ volunteer_id: volunteerId, id_card_path: frontPath, id_card_back_path: backPath, purpose: purpose.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('طلبك اتبعت مع صورة البطاقة')
      setFront(null)
      setBack(null)
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
          <p className="mt-2 text-xs text-muted">ارفع صورة واضحة لوش البطاقة وضهرها، والإدارة هتطلع الشهادة بتفاصيل مشاركاتك. الصورة بتتحفظ في مكان خاص، والإدارة بس اللي بتشوفها.</p>
          <div className="mt-3 space-y-3">
            <Field label="الشهادة لإيه؟ (اختياري)">
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="مثلاً: للجامعة" />
            </Field>
            <input ref={frontInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFront(e.target.files?.[0] ?? null)} />
            <input ref={backInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setBack(e.target.files?.[0] ?? null)} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant={front ? 'primary' : 'secondary'} className="w-full" onClick={() => frontInput.current?.click()}>
                <ImageUp className="size-4" /> {front ? 'الوش ✓' : 'وش البطاقة'}
              </Button>
              <Button variant={back ? 'primary' : 'secondary'} className="w-full" onClick={() => backInput.current?.click()}>
                <ImageUp className="size-4" /> {back ? 'الضهر ✓' : 'ضهر البطاقة'}
              </Button>
            </div>
            <Button className="w-full" onClick={() => send.mutate()} loading={send.isPending} disabled={!front || !back}>
              اطلب الشهادة
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

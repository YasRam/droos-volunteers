import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { VolunteerName } from '@/components/VolunteerLink'
import { Button, Card, Empty, Input, Spinner } from '@/components/ui'
import { fmtShort } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { RequestChanges } from '@/pages/MyProfile'

interface Row {
  id: string
  volunteer_id: string
  changes: Record<string, string | null>
  old_values: Record<string, string | null>
  photo_path: string | null
  created_at: string
  photoUrl: string | null
  name: string | null
}

/** HR: volunteers' requests to change their data or photo. Accepting applies them. */
export function ProfileRequests() {
  const q = useQuery({
    queryKey: ['profile-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_requests')
        .select('id, volunteer_id, changes, old_values, photo_path, created_at, volunteer:volunteers(full_name_ar)')
        .eq('status', 'pending')
        .order('created_at')
      if (error) throw error
      const rows = data as unknown as (Omit<Row, 'photoUrl' | 'name'> & { volunteer: { full_name_ar: string } | null })[]
      return Promise.all(
        rows.map(async (r) => {
          let photoUrl: string | null = null
          if (r.photo_path) {
            const { data: signed } = await supabase.storage.from('photos').createSignedUrl(r.photo_path, 3600)
            photoUrl = signed?.signedUrl ?? null
          }
          return { ...r, photoUrl, name: r.volunteer?.full_name_ar ?? null } as Row
        }),
      )
    },
  })
  if (q.isLoading) return <Spinner />
  if (!q.data?.length) return <Empty title="مفيش طلبات تعديل">لما متطوع يطلب يعدّل بياناته أو صورته من «بياناتي» هيظهر هنا.</Empty>
  return (
    <div className="space-y-3">
      {q.data.map((r) => (
        <RequestCard key={r.id} r={r} />
      ))}
    </div>
  )
}

function RequestCard({ r }: { r: Row }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const review = useMutation({
    mutationFn: async (approve: boolean) => {
      const { error } = await supabase.rpc('review_profile_request', { p_id: r.id, p_approve: approve, p_note: note || null })
      if (error) throw error
      return approve
    },
    onSuccess: (approve) => {
      toast.success(approve ? 'اتقبل والبيانات اتحدّثت' : 'اترفض')
      qc.invalidateQueries({ queryKey: ['profile-requests'] })
      qc.invalidateQueries({ queryKey: ['volunteer', r.volunteer_id] })
      qc.invalidateQueries({ queryKey: ['volunteer-photo', r.volunteer_id] })
      qc.invalidateQueries({ queryKey: ['volunteers'] })
    },
    onError: toastError,
  })
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 font-bold">
          <VolunteerName id={r.volunteer_id} name={r.name ?? 'متطوع'} />
        </p>
        <span className="text-xs text-muted">{fmtShort(r.created_at)}</span>
      </div>
      <RequestChanges r={r} photoUrl={r.photoUrl} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="min-w-48 flex-1" placeholder="ملاحظة للمتطوع (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button loading={review.isPending && review.variables} onClick={() => review.mutate(true)}>
          <Check className="size-4" /> اقبل
        </Button>
        <Button variant="secondary" loading={review.isPending && !review.variables} onClick={() => review.mutate(false)}>
          <X className="size-4" /> ارفض
        </Button>
      </div>
    </Card>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, UserRound } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button, Card } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** The volunteer's photo (private bucket): a signed link to show it, and an upload. */
export function useVolunteerPhoto(id: string | null | undefined) {
  const qc = useQueryClient()
  const photo = useQuery({
    queryKey: ['volunteer-photo', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('volunteer_form', { p_volunteer: id })
      if (error) throw error
      const path = (data as { photo_path?: string | null } | null)?.photo_path
      if (!path) return null
      const { data: signed } = await supabase.storage.from('photos').createSignedUrl(path, 3600)
      return signed?.signedUrl ?? null
    },
  })
  const upload = useMutation({
    mutationFn: async (picked: File) => {
      if (picked.size > 3 * 1024 * 1024) throw { message: 'الصورة أكبر من 3 ميجا' }
      const ext = picked.type === 'image/png' ? 'png' : picked.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${id}/photo.${ext}`
      const { error } = await supabase.storage.from('photos').upload(path, picked, { upsert: true, contentType: picked.type })
      if (error) throw error
      const { error: e2 } = await supabase.rpc('set_photo', { p_volunteer: id, p_path: path })
      if (e2) throw e2
    },
    onSuccess: () => {
      toast.success('الصورة اتحفظت')
      qc.invalidateQueries({ queryKey: ['volunteer-photo', id] })
      qc.invalidateQueries({ queryKey: ['volunteer-form', id] })
    },
    onError: toastError,
  })
  return { url: photo.data ?? null, loading: photo.isLoading, upload }
}

/** Hidden file input + a button that opens it. */
export function PhotoButton({ id, hasPhoto }: { id: string; hasPhoto: boolean }) {
  const { upload } = useVolunteerPhoto(id)
  const file = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button variant="secondary" loading={upload.isPending} onClick={() => file.current?.click()}>
        <Camera className="size-4" /> {hasPhoto ? 'غيّر الصورة' : 'ضيف صورة'}
      </Button>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) upload.mutate(picked)
          e.target.value = ''
        }}
      />
    </>
  )
}

/** Card for بياناتي: the photo and a button to add or change it. */
export function PhotoCard({ id }: { id: string }) {
  const { url } = useVolunteerPhoto(id)
  return (
    <Card className="flex items-center gap-4">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface text-muted">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <UserRound className="size-10" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-bold">صورتك</p>
        <p className="text-xs text-muted">{url ? 'بتظهر في استمارة التطوع.' : 'ضيف صورة شخصية واضحة عشان تظهر في استمارة التطوع.'}</p>
        <PhotoButton id={id} hasPhoto={Boolean(url)} />
      </div>
    </Card>
  )
}

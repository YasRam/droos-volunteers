import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import ActivityFields, { activitySchema, toActivityPayload, type ActivityValues } from '@/components/ActivityFields'
import { Button, Card, PageHeader } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { cairoToday, fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export default function CheckIn() {
  const { volunteerId, staff } = usePermissions()
  const qc = useQueryClient()
  const today = cairoToday()
  const [done, setDone] = useState<null | 'accepted' | 'pending'>(null)
  const form = useForm<ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: { activity_date: today, event: '', place: 'الفرع' },
  })

  const save = useMutation({
    mutationFn: async (v: ActivityValues) => {
      const { data, error } = await supabase
        .from('participations')
        .insert({ ...toActivityPayload(v), activity_date: today, volunteer_id: volunteerId })
        .select('status')
        .single()
      if (error) throw error
      return data.status as 'accepted' | 'pending'
    },
    onSuccess: (status) => {
      setDone(status)
      qc.invalidateQueries({ queryKey: ['my-activities'] })
      toast.success(status === 'accepted' ? 'اتسجل حضورك' : 'اتبعت الطلب، مستني موافقة')
    },
    onError: toastError,
  })

  if (done) {
    return (
      <Card className="mx-auto mt-6 max-w-md text-center">
        <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
        <h1 className="mt-3 text-xl font-bold">{done === 'accepted' ? 'اتسجل حضورك' : 'طلبك وصل'}</h1>
        <p className="mt-1 text-sm text-muted">
          {done === 'accepted' ? 'المشاركة اتحسبت على طول.' : 'الإدارة هتوافق عليه، وهيوصلك إشعار.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(null)
              form.reset({ activity_date: today, event: '', place: 'الفرع' })
            }}
          >
            تسجيل نشاط تاني
          </Button>
          <Link to="/me/activities">
            <Button>أنشطتي</Button>
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="حضرت النهارده"
        subtitle={`${fmtDate(today)} · ${staff ? 'هيتقبل على طول' : 'الطلب هيستنى موافقة الإدارة'}`}
      />
      <Card>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-5">
          <ActivityFields form={form} dateLocked />
          <Button type="submit" size="lg" className="w-full" loading={save.isPending}>
            سجّل حضوري
          </Button>
        </form>
      </Card>
    </>
  )
}

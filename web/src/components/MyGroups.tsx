import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import { Card, Spinner, Toggle } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** The volunteer's WhatsApp groups (general, his committees, the grades he teaches) and «دخلت الجروب». */
export function MyGroupsCard({ volunteerId, joined }: { volunteerId: string; joined: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['my-whatsapp-groups'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_whatsapp_groups')
      if (error) throw error
      return data as { kind: string; name: string; link: string }[]
    },
  })
  const set = useMutation({
    mutationFn: async (v: boolean) => {
      const { error } = await supabase.rpc('set_joined_group', { p_joined: v })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volunteer', volunteerId] }),
    onError: toastError,
  })
  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-2 font-bold">
        <MessageCircle className="size-4 text-emerald-600" /> جروبات الواتساب بتاعتك
      </p>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted">لسه مفيش لينكات جروبات متسجلة.</p>
      ) : (
        <ul className="space-y-1">
          {q.data.map((g) => (
            <li key={g.link}>
              <a href={g.link} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                <span>{g.name}</span>
                <span className="text-xs font-normal text-emerald-700">{g.kind}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <Toggle label="دخلت الجروب" checked={joined} disabled={set.isPending} onChange={(v) => set.mutate(v)} />
    </Card>
  )
}

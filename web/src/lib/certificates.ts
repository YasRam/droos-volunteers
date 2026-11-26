import { useQuery } from '@tanstack/react-query'
import { fmtDate } from './data'
import { supabase } from './supabase'

export interface ParticipationSummary {
  total: number
  days: number
  beneficiaries: number
  first_date: string | null
  last_date: string | null
  by_event: { event: string; count: number; days: number }[]
  by_month: { month: string; count: number }[]
}

export interface CertificateRequest {
  id: string
  volunteer_id: string
  id_card_path: string
  id_card_back_path: string | null
  purpose: string | null
  status: 'pending' | 'accepted' | 'rejected'
  review_note: string | null
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export const ID_CARD_BUCKET = 'id-cards'

export function useParticipationSummary(volunteerId?: string | null) {
  return useQuery({
    queryKey: ['participation-summary', volunteerId],
    enabled: Boolean(volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('participation_summary', { p_volunteer_id: volunteerId })
      if (error) throw error
      return data as ParticipationSummary | null
    },
  })
}

/** Plain-text summary to paste with the ID card photo when issuing the certificate. */
export function summaryText(name: string, code: string, s: ParticipationSummary, nationalId?: string | null) {
  const lines = [
    `الاسم: ${name}`,
    `الكود: ${code}`,
    ...(nationalId ? [`الرقم القومي: ${nationalId}`] : []),
    `الفترة: من ${fmtDate(s.first_date)} إلى ${fmtDate(s.last_date)}`,
    `إجمالي المشاركات: ${s.total} في ${s.days} يوم`,
    ...(s.beneficiaries ? [`عدد الطلاب اللي استفادوا: ${s.beneficiaries}`] : []),
    'التفاصيل:',
    ...s.by_event.map((e) => `- ${e.event}: ${e.count} مشاركة في ${e.days} يوم`),
  ]
  return lines.join('\n')
}

/** Short-lived link to a private ID card photo. */
export async function idCardUrl(path: string) {
  const { data, error } = await supabase.storage.from(ID_CARD_BUCKET).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

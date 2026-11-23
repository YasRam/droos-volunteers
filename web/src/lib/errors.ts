import { toast } from 'sonner'

interface PgError {
  code?: string
  message?: string
  details?: string
}

/** Turn a Supabase/Postgres error into a short Arabic sentence. */
export function errorMessage(err: unknown): string {
  const e = (err ?? {}) as PgError
  if (e.code === '23505') {
    if (e.message?.includes('participations_no_duplicate')) return 'النشاط ده متسجل قبل كده لنفس اليوم والمادة والسنة'
    if (e.message?.includes('email')) return 'الإيميل ده مستخدم لمتطوع تاني'
    return 'البيانات دي موجودة قبل كده'
  }
  if (e.code === '23514') return 'فيه خانة مكتوبة بشكل غلط (رقم التليفون 11 رقم ويبدأ بـ 01، والرقم القومي 14 رقم)'
  if (e.code === '42501') {
    // Our triggers raise Arabic messages with this code; RLS errors are English.
    return e.message && /[؀-ۿ]/.test(e.message) ? e.message : 'مش مسموح لك تعمل ده'
  }
  if (e.message && /[؀-ۿ]/.test(e.message)) return e.message
  if (e.message?.includes('Failed to fetch')) return 'مفيش اتصال بالإنترنت'
  return 'حصلت مشكلة، جرّب تاني'
}

export function toastError(err: unknown) {
  toast.error(errorMessage(err))
}

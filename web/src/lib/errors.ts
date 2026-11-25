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
  if (e.code === '23514') {
    const m = e.message ?? ''
    // our own rules (the volunteer journey) already speak Arabic
    if (/[\u0600-\u06FF]/.test(m)) return m
    if (/phone|whatsapp/.test(m)) return 'رقم التليفون لازم يكون 11 رقم ويبدأ بـ 01'
    if (/national_id/.test(m)) return 'الرقم القومي لازم يكون 14 رقم'
    if (/end_date/.test(m)) return 'تاريخ النهاية لازم يكون بعد تاريخ البداية أو نفس اليوم'
    if (/capacity/.test(m)) return 'عدد الأماكن لازم يكون أكبر من صفر'
    if (/date/.test(m)) return 'التاريخ مش مظبوط'
    return 'فيه خانة قيمتها مش مظبوطة، راجع البيانات'
  }
  if (e.code === '22007' || e.code === '22008') return 'التاريخ مش مظبوط'
  if (e.code === '22P02') return 'فيه رقم أو تاريخ مكتوب بشكل غلط'
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

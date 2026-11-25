import { supabase } from '@/lib/supabase'

const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/account`
const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

/** Calls the «account» edge function (sign-in without Google). Throws { message } in Arabic. */
export async function accountCall(body: Record<string, unknown>, withSession = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey }
  if (withSession) {
    const { data } = await supabase.auth.getSession()
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  }
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    throw { message: 'مش قادرين نوصل للسيرفر، اتأكد من النت' }
  }
  const out = (await res.json().catch(() => null)) as { ok: boolean; error?: string; email?: string } | null
  if (!out?.ok) throw { message: out?.error ?? 'الخدمة دي لسه مش متفعّلة، كلّم الأدمن' }
  return out
}

/** A temporary password people can read out and type: no look-alike letters. */
export function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(10)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

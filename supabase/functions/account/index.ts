// account: sign-in without Google.
//
//  { action: 'first_password', email, national_id, phone, password }
//     anyone: a volunteer proves who they are with the email the activity has for them,
//     their national ID and their mobile, and sets a password. Not for people with
//     permissions (they keep Google, or set a password from inside the site).
//     5 wrong tries an hour per email, 50 in all.
//
//  { action: 'set_password', volunteer_id, password }   + Authorization: Bearer <user JWT>
//     HR (hr.edit) or roles.manage set a temporary password for a volunteer. Only
//     roles.manage may do it for someone who has permissions.
//
//  { action: 'family_password', kind: 'guardian'|'student', login, national_id?, phone?, password }
//     anyone: a guardian (mobile + a national ID on the family's file) or a student (national ID +
//     a family mobile) sets a password. Login is <mobile or national id>@family.droos.
//
//  { action: 'family_set_password', kind, student_id, password }   + Authorization: Bearer <user JWT>
//     staff with students.accounts set a password for a student or his guardian.
//
// Deploy with "Verify JWT" OFF (the first action has no account yet); the second checks the JWT itself.

import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const cors = {
  'Access-Control-Allow-Origin': 'https://yasram.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => json({ ok: false, error }, status)

async function setPassword(email: string, userId: string | null, password: string) {
  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password })
    if (error) throw error
  } else {
    const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
  }
}

const students = db.schema('students')

/** Family accounts: the login can change (new mobile), so the email follows it. Returns the user id. */
async function setFamilyPassword(email: string, userId: string | null, password: string): Promise<string> {
  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password, email, email_confirm: true })
    if (error) throw error
    return userId
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  return data.user.id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('POST only', 405)
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return fail('bad request')
  }
  const password = String(body.password ?? '')
  if (password.length < 8) return fail('كلمة السر 8 حروف أو أرقام على الأقل')

  try {
    if (body.action === 'first_password') {
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!email.includes('@')) return fail('اكتب الإيميل')
      const { data, error } = await db.rpc('account_check', { p_email: email, p_nid: body.national_id ?? '', p_phone: body.phone ?? '' })
      if (error) throw error
      if (!data.ok) return fail(data.error)
      if (data.staff) return fail('حسابك فيه صلاحيات، فلازم تدخل بجوجل أول مرة وتحط كلمة السر من جوه الموقع')
      await setPassword(email, data.user_id, password)
      return json({ ok: true })
    }

    if (body.action === 'set_password') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: who, error: authError } = await db.auth.getUser(token)
      if (authError || !who.user?.email) return fail('ادخل الموقع تاني', 401)
      const { data: t, error } = await db.rpc('account_target', { p_caller: who.user.email, p_volunteer: body.volunteer_id })
      if (error) throw error
      if (!t) return fail('المتطوع ده مش موجود', 404)
      if (!t.allowed) return fail('محتاج صلاحية تعديل بيانات المقابلة', 403)
      if (!t.email) return fail('المتطوع ده مالوش إيميل. ضيف إيميله الأول')
      if (t.staff && !t.caller_manages_roles) return fail('ده معاه صلاحيات، وكلمة السر بتاعته بتتغير من الأدمن بس', 403)
      await setPassword(t.email, t.user_id, password)
      return json({ ok: true, email: t.email })
    }

    if (body.action === 'family_password') {
      const kind = body.kind === 'student' ? 'student' : 'guardian'
      const { data, error } = await students.rpc('family_check', {
        p_kind: kind, p_login: body.login ?? '', p_nid: body.national_id ?? '', p_phone: body.phone ?? null,
      })
      if (error) throw error
      if (!data.ok) return fail(data.error)
      const userId = await setFamilyPassword(data.login_email, data.user_id, password)
      const { error: linkError } = await students.rpc('family_link', { p_user: userId, p_kind: kind, p_id: data.id, p_login_email: data.login_email })
      if (linkError) throw linkError
      return json({ ok: true, email: data.login_email })
    }

    if (body.action === 'family_set_password') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: who, error: authError } = await db.auth.getUser(token)
      if (authError || !who.user?.email) return fail('ادخل الموقع تاني', 401)
      const kind = body.kind === 'student' ? 'student' : 'guardian'
      const { data: t, error } = await students.rpc('family_target', { p_caller: who.user.email, p_kind: kind, p_student: body.student_id })
      if (error) throw error
      if (!t) return fail('الطالب ده مش موجود', 404)
      if (!t.allowed) return fail('محتاج صلاحية «حسابات أولياء الأمور والطلاب»', 403)
      if (!t.id) return fail('الطالب ده مالوش ولي أمر متسجل. ضيفه الأول')
      if (!t.login) return fail(kind === 'guardian' ? 'مفيش موبايل لولي الأمر. ضيفه الأول' : 'مفيش رقم قومي للطالب. ضيفه الأول')
      const userId = await setFamilyPassword(t.login_email, t.user_id, password)
      const { error: linkError } = await students.rpc('family_link', {
        p_user: userId, p_kind: kind, p_id: t.id, p_login_email: t.login_email, p_by: who.user.email,
      })
      if (linkError) throw linkError
      return json({ ok: true, login: t.login })
    }

    return fail('unknown action')
  } catch (e) {
    console.error(e)
    return fail('حصلت مشكلة، جرّب تاني', 500)
  }
})

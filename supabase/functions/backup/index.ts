// backup: returns every table of the app as one JSON document.
//
// Called once a day by the Google Apps Script in the owner's Drive with the header
//   x-backup-token: <random token kept in the script's properties>
// The database stores only the SHA-256 of that token (public.backup_config.token_hash),
// set from the settings page. Each call is recorded in public.backup_runs.
//
// Deploy with "Verify JWT" OFF: the token above is the only credential.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Order = restore order (parents before children); value = sort key(s) for stable paging.
const TABLES: Record<string, string[]> = {
  app_settings: ['key'],
  lookups: ['id'],
  roles: ['key'],
  volunteers: ['id'],
  volunteer_private: ['volunteer_id'],
  volunteer_hr: ['volunteer_id'],
  staff_roles: ['email', 'role'],
  committee_leaders: ['email', 'committee'],
  group_activities: ['id'],
  meetings: ['id'],
  participations: ['id'],
  meeting_photos: ['id'],
  schedule_slots: ['id'],
  class_absences: ['id'],
  certificate_requests: ['id'],
  stages: ['key'],
  stage_done: ['volunteer_id', 'stage_key'],
  rules_acceptances: ['volunteer_id', 'version'],
  activity_rules: ['id'],
  rule_answers: ['volunteer_id', 'rule_id'],
  tshirt_requests: ['id'],
  camps: ['id'],
  camp_registrations: ['camp_id', 'volunteer_id'],
  recruit_log: ['id'],
  registration_requests: ['id'],
  notifications: ['id'],
  audit_log: ['id'],
  mail_settings: ['id'],
  mail_items: ['kind', 'item_id'],
  mail_log: ['id'],
  // students (schema «students»; needs it in Settings → API → Exposed schemas)
  'students.settings': ['id'],
  'students.org_info': ['id'],
  'students.terms': ['id'],
  'students.grades': ['code'],
  'students.attendance_marks': ['code'],
  'students.guardians': ['id'],
  'students.students': ['id'],
  'students.student_private': ['student_id'],
  'students.phones': ['id'],
  'students.accounts': ['user_id'],
  'students.applications': ['id'],
  'students.enrollments': ['id'],
  'students.groups': ['id'],
  'students.group_members': ['group_id', 'student_id'],
  'students.whatsapp_groups': ['id'],
  'students.class_sessions': ['id'],
  'students.audiences': ['id'],
  'students.schedule_pauses': ['id'],
  'students.slot_requests': ['id'],
  'students.attendance': ['session_id', 'student_id'],
  'students.exam_results': ['session_id', 'student_id'],
  'students.flags': ['id'],
  'students.leaves': ['id'],
  'students.notes': ['id'],
  'students.announcements': ['id'],
  'students.change_requests': ['id'],
  'students.dismissal_requests': ['id'],
  'students.care_notes': ['student_id'],
  'students.family_finance': ['student_id'],
  'students.rules': ['id'],
  'students.rule_answers': ['guardian_id', 'rule_id'],
}

const PAGE = 1000

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time compare of two hex strings. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function dump(table: string, keys: string[]) {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const [schema, name] = table.includes('.') ? table.split('.') : ['public', table]
    let q = db.schema(schema).from(name).select('*')
    for (const k of keys) q = q.order(k, { ascending: true })
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const token = req.headers.get('x-backup-token') ?? ''
  const cfg = await db.from('backup_config').select('token_hash').eq('id', true).single()
  if (cfg.error) return json({ error: 'config' }, 500)
  if (!cfg.data.token_hash || token.length < 32 || !same(await sha256(token), cfg.data.token_hash)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const body = await req.json().catch(() => ({})) as {
    file_name?: string
    images?: boolean
    sheets?: { month: string }
    report?: { ok: boolean; bytes?: number; rows?: number; tables?: number; images?: number; error?: string }
    mail?: 'batch' | 'edits'
    mail_sent?: { kind: string; ids: string[]; subject?: string; ok: boolean; error?: string; body?: string }
  }

  // Management emails (the script sends them from droosmng): what to send, and what was sent
  if (body.mail === 'batch' || body.mail === 'edits') {
    const r = await db.rpc(body.mail === 'batch' ? 'mail_followup_batch' : 'mail_followup_edits')
    if (r.error) return json({ error: r.error.message }, 500)
    const out = r.data as { meetings?: { photos: string[]; photo_urls?: string[] }[] }
    for (const m of out.meetings ?? []) {
      if (!m.photos?.length) continue
      const signed = await db.storage.from('activity-photos').createSignedUrls(m.photos, 3600)
      m.photo_urls = (signed.data ?? []).map((x) => x.signedUrl).filter(Boolean) as string[]
    }
    return json(out)
  }
  if (body.mail_sent) {
    const m = body.mail_sent
    const r = await db.rpc('mail_mark_sent', {
      p_kind: m.kind, p_ids: m.ids ?? [], p_subject: m.subject ?? null, p_ok: !!m.ok, p_error: m.error ?? null, p_body: m.body ?? null,
    })
    if (r.error) return json({ error: r.error.message }, 500)
    return json({ ok: true })
  }

  // Sheet sync: the month's evaluation and meetings rows, plus where to write them
  if (body.sheets) {
    const month = String(body.sheets.month ?? '')
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'month' }, 400)
    const [ev, mt, links] = await Promise.all([
      db.rpc('report_eval', { p_month: `${month}-01` }),
      db.rpc('report_meetings', { p_month: `${month}-01` }),
      db.from('app_settings').select('key, value').in('key', ['report_sheet_eval', 'report_sheet_meetings']),
    ])
    const err = ev.error ?? mt.error ?? links.error
    if (err) return json({ error: err.message }, 500)
    const link = Object.fromEntries((links.data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]))
    return json({ eval: ev.data, meetings: mt.data, eval_sheet: link.report_sheet_eval ?? null, meetings_sheet: link.report_sheet_meetings ?? null })
  }

  // ID card photos: list every file with a short-lived download link; the script copies new ones.
  if (body.images) {
    const bucket = db.storage.from('id-cards')
    const top = await bucket.list('', { limit: 1000 })
    if (top.error) return json({ error: top.error.message }, 500)
    const paths: string[] = []
    for (const folder of top.data) {
      if (folder.id) continue // a file at the root, not a volunteer folder
      const files = await bucket.list(folder.name, { limit: 1000 })
      if (files.error) return json({ error: files.error.message }, 500)
      for (const f of files.data) if (f.id) paths.push(`${folder.name}/${f.name}`)
    }
    if (!paths.length) return json({ images: [] })
    const signed = await bucket.createSignedUrls(paths, 3600)
    if (signed.error) return json({ error: signed.error.message }, 500)
    return json({ images: signed.data.filter((x) => x.signedUrl).map((x) => ({ path: x.path, url: x.signedUrl })) })
  }

  // Second call from the script: it reports whether the file was saved in Drive.
  if (body.report) {
    await db.from('backup_runs').insert({
      ok: body.report.ok,
      rows: body.report.rows ?? null,
      tables: body.report.tables ?? null,
      images: body.report.images ?? null,
      bytes: body.report.bytes ?? null,
      file_name: body.file_name ?? null,
      error: body.report.error?.slice(0, 500) ?? null,
    })
    return json({ ok: true })
  }

  try {
    const data: Record<string, unknown[]> = {}
    let rows = 0
    for (const [t, keys] of Object.entries(TABLES)) {
      data[t] = await dump(t, keys)
      rows += data[t].length
    }
    const counts = Object.fromEntries(Object.keys(TABLES).map((t) => [t, data[t].length]))
    return json({ app: 'droos-volunteers', schema: 32, exported_at: new Date().toISOString(), counts, rows, tables: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('backup_runs').insert({ ok: false, error: msg.slice(0, 500) })
    return json({ error: msg }, 500)
  }
})

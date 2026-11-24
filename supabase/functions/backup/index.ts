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
  participations: ['id'],
  schedule_slots: ['id'],
  certificate_requests: ['id'],
  notifications: ['id'],
  audit_log: ['id'],
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
    let q = db.from(table).select('*')
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
    return json({ app: 'droos-volunteers', schema: 12, exported_at: new Date().toISOString(), counts, rows, tables: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('backup_runs').insert({ ok: false, error: msg.slice(0, 500) })
    return json({ error: msg }, 500)
  }
})

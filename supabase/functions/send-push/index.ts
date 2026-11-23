// send-push: delivers rows of public.notifications to the recipients' phones (Web Push).
//
// Called by the database (trigger on public.notifications, via pg_net) with
//   { "ids": [notification ids] }  and the header  x-push-secret: <push_config.hook_secret>.
// An empty ids list just makes sure the VAPID keys exist (first-run setup).
//
// The VAPID key pair is generated here on the first call and stored in public.push_config
// (readable by the service role only). The public key is also written to
// app_settings.vapid_public_key, where the web app reads it to subscribe.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

interface PushConfig {
  hook_secret: string
  vapid_subject: string
  vapid_public: string | null
  vapid_private: string | null
}

interface NotificationRow {
  id: number
  recipient_email: string
  title: string
  body: string | null
  link: string | null
}

interface Subscription {
  endpoint: string
  email: string
  p256dh: string
  auth: string
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function loadConfig(): Promise<PushConfig> {
  const { data, error } = await db.from('push_config').select('hook_secret, vapid_subject, vapid_public, vapid_private').eq('id', true).single()
  if (error) throw error
  const cfg = data as PushConfig
  if (cfg.vapid_public && cfg.vapid_private) return cfg

  const keys = webpush.generateVAPIDKeys()
  const saved = await db.from('push_config').update({ vapid_public: keys.publicKey, vapid_private: keys.privateKey }).eq('id', true)
  if (saved.error) throw saved.error
  const published = await db.from('app_settings').upsert({ key: 'vapid_public_key', value: keys.publicKey })
  if (published.error) throw published.error
  return { ...cfg, vapid_public: keys.publicKey, vapid_private: keys.privateKey }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let cfg: PushConfig
  try {
    cfg = await loadConfig()
  } catch (e) {
    return json({ error: 'config', detail: String(e) }, 500)
  }
  if (req.headers.get('x-push-secret') !== cfg.hook_secret) return json({ error: 'forbidden' }, 403)

  const { ids } = (await req.json().catch(() => ({}))) as { ids?: number[] }
  if (!ids?.length) return json({ ok: true, ready: true })

  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public!, cfg.vapid_private!)

  const { data: notes, error: e1 } = await db.from('notifications').select('id, recipient_email, title, body, link').in('id', ids)
  if (e1) return json({ error: e1.message }, 500)
  const rows = (notes ?? []) as NotificationRow[]
  const emails = [...new Set(rows.map((n) => n.recipient_email.toLowerCase()))]
  if (!emails.length) return json({ ok: true, sent: 0 })

  const { data: subs, error: e2 } = await db.from('push_subscriptions').select('endpoint, email, p256dh, auth').in('email', emails)
  if (e2) return json({ error: e2.message }, 500)
  const byEmail = new Map<string, Subscription[]>()
  for (const s of (subs ?? []) as Subscription[]) {
    const k = s.email.toLowerCase()
    byEmail.set(k, [...(byEmail.get(k) ?? []), s])
  }

  let sent = 0
  const gone: string[] = []
  const delivered: string[] = []
  await Promise.all(
    rows.flatMap((n) =>
      (byEmail.get(n.recipient_email.toLowerCase()) ?? []).map(async (s) => {
        const payload = JSON.stringify({ title: n.title, body: n.body ?? '', url: n.link ?? '/', tag: `n${n.id}` })
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: 'high' })
          sent++
          delivered.push(s.endpoint)
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // The phone unsubscribed or the browser data was cleared: forget this endpoint.
          if (status === 404 || status === 410) gone.push(s.endpoint)
          else console.error('push failed', status, String(err))
        }
      }),
    ),
  )

  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone)
  if (delivered.length) await db.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).in('endpoint', [...new Set(delivered)])
  return json({ ok: true, sent, removed: gone.length })
})

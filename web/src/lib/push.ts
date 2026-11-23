import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type PushState =
  | 'unsupported' // browser can't do Web Push at all
  | 'needs-install' // iPhone/iPad: works only after «Add to Home Screen»
  | 'blocked' // the person refused; only the browser settings can undo it
  | 'off' // possible, not turned on on this device
  | 'on' // this device receives notifications

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

function base64UrlToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function currentState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export function usePushState() {
  return useQuery({ queryKey: ['push-state'], queryFn: currentState, staleTime: Infinity })
}

export function usePushActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['push-state'] })

  const enable = async () => {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      await refresh()
      throw new Error(permission === 'denied' ? 'الإشعارات اترفضت. فعّلها من إعدادات المتصفح.' : 'لازم توافق على الإشعارات')
    }
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'vapid_public_key').maybeSingle()
    if (error) throw error
    if (!data?.value) throw new Error('الإشعارات لسه مش متجهزة من ناحية السيرفر. كلّم الأدمن.')

    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(data.value) }))
    const keys = sub.toJSON().keys ?? {}
    const saved = await supabase.from('push_subscriptions').upsert({
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    })
    if (saved.error) throw saved.error
    await refresh()
  }

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    await refresh()
  }

  return { enable, disable }
}

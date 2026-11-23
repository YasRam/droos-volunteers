// Loaded into the app's service worker (vite.config.ts → workbox.importScripts).
// Shows phone notifications sent by the send-push function, and opens the right page on tap.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'دروس التقوية', {
      body: data.body || '',
      dir: 'rtl',
      lang: 'ar',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const scope = self.registration.scope // e.g. https://yasram.github.io/droos-volunteers/
  const path = String(event.notification.data?.url || '/').replace(/^\//, '')
  const target = new URL(path, scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(scope) && 'focus' in w) {
          w.navigate(target)
          return w.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

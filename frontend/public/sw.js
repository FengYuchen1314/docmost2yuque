const CACHE = 'zhixu-shell-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put('/index.html', response.clone()))
      return response
    }).catch(() => caches.match('/index.html')))
    return
  }
  if (!['script', 'style', 'font', 'image'].includes(request.destination) && !SHELL.includes(url.pathname)) return
  event.respondWith(caches.match(request).then((cached) => {
    const network = fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
      return response
    })
    return cached || network
  }))
})

self.addEventListener('push', (event) => {
  let message = { title: '知序', body: '你有一条新消息', url: '/app/notifications' }
  try { message = { ...message, ...event.data.json() } } catch { /* use the safe fallback */ }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: message.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/app/notifications'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) { existing.navigate(target); return existing.focus() }
    return self.clients.openWindow(target)
  }))
})

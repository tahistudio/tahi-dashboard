// Bump this whenever a precached page changes. `install` only re-runs when the
// bytes of this file change, so an existing installation would otherwise keep
// serving the version of /offline it cached the first time, forever.
//   v4: the rebuilt offline page (retry, back-online state, reassurance list).
const CACHE_NAME = 'tahi-v4'
const OFFLINE_URL = '/offline'

const PRECACHE_URLS = [
  '/offline',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Non-fatal: addAll rejects the whole batch if any single URL fails (a
    // redirect, an outage mid-install), which used to abort the install and
    // leave the people most likely to need a fallback without one. A worker
    // with a warm fetch handler and a cold cache still beats no worker.
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached || new Response('Offline', { status: 503 }))
    )
  )
})

// Caches the app shell only. There is no offline data: without a keyboard attached the app has
// nothing to show, so pretending otherwise would be dishonest.
//
// Every path is relative to the worker's own scope, so the same file works at the site root and
// under a sub-path such as GitHub Pages' /<repo>/.
const SHELL_CACHE = 'k1-shell-v2'
const ROOT = new URL(self.registration.scope).pathname   // '/' or '/<repo>/'
const SHELL = ['', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'].map((file) => ROOT + file)

const fetchAndStore = async (cache, request) => {
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Hashed build assets never change under their name, so the cached copy is always right.
  if (url.pathname.startsWith(ROOT + 'assets/')) {
    event.respondWith(caches.open(SHELL_CACHE).then(async (cache) => (await cache.match(request)) ?? fetchAndStore(cache, request)))
    return
  }
  // The shell is network-first so a new build is never hidden behind a stale copy.
  if (request.mode === 'navigate' || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        try {
          return await fetchAndStore(cache, request)
        } catch {
          return (await cache.match(request)) ?? (await cache.match(ROOT)) ?? Response.error()
        }
      }),
    )
  }
})

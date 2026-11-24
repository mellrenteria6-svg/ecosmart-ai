// Service worker de EcoSmart AI
//  - Producción: guarda la app en caché para abrirla sin conexión (RNF01, RNF03)
//  - Siempre: recibe las notificaciones push y abre la app al tocarlas (RF23)
const CACHE = 'ecosmart-v3'
// En desarrollo (sw.js?modo=dev) no se usa caché para no interferir con la recarga en caliente
const DESARROLLO = new URL(self.location.href).searchParams.get('modo') === 'dev'
// Carpeta donde vive la página: "/" en la PC, "/ecosmart-ai/" en GitHub Pages
const BASE = new URL('./', self.location.href).pathname

self.addEventListener('install', (e) => {
  if (!DESARROLLO) e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, BASE + 'index.html', BASE + 'favicon.svg', BASE + 'manifest.webmanifest'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE || DESARROLLO).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (DESARROLLO) return
  const req = e.request
  const url = new URL(req.url)
  // La API nunca se guarda en caché: los datos deben venir siempre del servidor
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(BASE + 'api/')) return
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copia))
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match(BASE + 'index.html'))),
  )
})

// RF23 — Aviso push enviado por el servidor
self.addEventListener('push', (e) => {
  let aviso = { titulo: 'EcoSmart AI', mensaje: 'Tienes un aviso nuevo.', url: '#/' }
  try {
    aviso = { ...aviso, ...e.data.json() }
  } catch {
    if (e.data) aviso.mensaje = e.data.text()
  }
  e.waitUntil(
    self.registration.showNotification(aviso.titulo, {
      body: aviso.mensaje,
      icon: BASE + 'favicon.svg',
      badge: BASE + 'favicon.svg',
      lang: 'es',
      data: { url: aviso.url },
    }),
  )
})

// Al tocar el aviso: enfoca la app si ya está abierta o la abre en la sección indicada
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const destino = new URL(BASE + (e.notification.data?.url ?? '#/'), self.location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      const abierta = ventanas.find((v) => new URL(v.url).origin === self.location.origin)
      if (abierta) {
        abierta.navigate(destino).catch(() => {})
        return abierta.focus()
      }
      return self.clients.openWindow(destino)
    }),
  )
})

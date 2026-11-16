// Trabajador de servicio: guarda la aplicación en el dispositivo para que abra sin conexión.
// Estrategia: se responde al instante con la copia guardada y, si hay señal, se actualiza
// por detrás para la próxima visita. Al cambiar de versión, subir el número de CACHE.
const CACHE = 'simulador-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// La página avisa qué archivos cargó en la primera visita para guardarlos todos.
self.addEventListener('message', e => {
  if (!e.data || e.data.tipo !== 'guardar') return;
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(e.data.urls.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const guardada = await c.match(r);
    const red = fetch(r).then(resp => { if (resp.ok) c.put(r, resp.clone()); return resp; }).catch(() => null);
    if (guardada) { e.waitUntil(red); return guardada; }
    const fresca = await red;
    if (fresca) return fresca;
    if (r.mode === 'navigate') { const inicio = await c.match('./') || await c.match('index.html'); if (inicio) return inicio; }
    return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});

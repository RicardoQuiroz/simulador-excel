// Trabajador de servicio: guarda la aplicación en el dispositivo para que abra sin conexión.
// Estrategia: si hay señal, se usa la versión publicada (así cada cambio llega en la
// primera visita) y se guarda una copia. Si no hay señal o tarda más de ESPERA, se usa
// la copia guardada. Al cambiar de versión, subir el número de CACHE.
const CACHE = 'simulador-v5';
const ESPERA = 4000; // milisegundos

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
    // Se pide por la dirección (no se copia la petición: Chrome no deja copiar la de una página).
    // "no-cache": se pregunta al servidor si cambió, así nunca se usa una copia vieja del navegador.
    const red = fetch(r.url, { cache: 'no-cache', credentials: 'same-origin' }).then(resp => { if (resp.ok) c.put(r, resp.clone()); return resp; }).catch(() => null);
    if (guardada) {
      // Señal lenta: se responde con la copia y la versión nueva se guarda para la próxima vez.
      const plazo = new Promise(ok => setTimeout(() => ok(null), ESPERA));
      const fresca = await Promise.race([red, plazo]);
      if (fresca && fresca.ok) return fresca;
      e.waitUntil(red);
      return guardada;
    }
    const fresca = await red;
    if (fresca && (fresca.ok || r.mode !== 'navigate')) return fresca;
    if (r.mode === 'navigate') { const inicio = await c.match(r, { ignoreSearch: true }) || await c.match('./') || await c.match('index.html'); if (inicio) return inicio; }
    return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});

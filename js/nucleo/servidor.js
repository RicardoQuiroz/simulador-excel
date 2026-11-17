// Conexión con el servidor del simulador.
// Al abrir la actividad desde el LMS, la página llega con un código de un solo uso después
// del "#" de la dirección. Aquí se canjea por un pase de sesión, que se guarda solo mientras
// la pestaña esté abierta. No se usan cookies.

const CLAVE = 'simulador:sesion';
const leer = () => { try { return JSON.parse(sessionStorage.getItem(CLAVE)); } catch (_) { return null; } };
const guardar = v => { try { v ? sessionStorage.setItem(CLAVE, JSON.stringify(v)) : sessionStorage.removeItem(CLAVE); } catch (_) { /* sin almacenamiento */ } };

export class SesionTerminada extends Error {}

// Devuelve null si la página no se abrió desde el LMS.
export async function conectar(base) {
  let sesion = leer();
  const m = /[#&]c=([\w-]+)/.exec(location.hash);
  if (m) {
    // El código se borra de la barra de direcciones de inmediato.
    history.replaceState(null, '', location.pathname + location.search);
    const r = await fetch(base + '/sesion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: m[1] }) });
    if (r.ok) { sesion = { token: (await r.json()).token, base }; guardar(sesion); }
    else { guardar(null); throw new SesionTerminada(); }
  }
  if (!sesion || sesion.base !== base) return null;

  async function api(ruta, cuerpo) {
    const r = await fetch(base + ruta, {
      method: cuerpo ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + sesion.token, 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    if (r.status === 401) { guardar(null); throw new SesionTerminada(); }
    if (!r.ok) {
      const e = new Error('Servidor: ' + r.status);
      e.estado = r.status;
      try { e.mensaje = (await r.json()).error || null; } catch (_) { e.mensaje = null; }
      throw e;
    }
    return r.json();
  }
  return { api };
}

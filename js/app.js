// Arranque del simulador.
// - Abierto desde el LMS: pide al servidor la lección, el idioma y los catálogos de esa actividad.
// - Abierto directamente en la computadora de desarrollo: usa la lección de ejemplo, sin servidor.
import config from './config.js';
import regLocal from './regional/es-MX.js';
import { crearLibro } from './nucleo/libro.js';
import { crearMotor } from './formulas/motor.js';
import { crearDespachador } from './nucleo/despachador.js';
import { crearVista } from './vista/escritorio.js';
import { crearLeccion } from './leccion/maquina.js';
import { crearPanel } from './leccion/panel.js';
import { crearSonidos } from './leccion/sonidos.js';
import { crearReproductor } from './leccion/reproductor.js';
import { crearGrabadora } from './leccion/grabadora.js';
import { SONIDOS, aplicarCatalogos } from './leccion/catalogos.js';
import { crearBuzon } from './nucleo/buzon.js';
import { conectar, SesionTerminada } from './nucleo/servidor.js';

const LECCION_LOCAL = 'lecciones/ejemplo-funcion-si.json';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const marco = document.getElementById('marco'), capa = document.getElementById('capa');
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Guarda datos en este dispositivo. Puede fallar (modo privado, página incrustada con el
// almacenamiento bloqueado): en ese caso todo funciona igual, solo que no se recuerda entre visitas.
function crearAlmacen(clave) {
  return {
    leer() { try { return JSON.parse(localStorage.getItem(clave)); } catch (_) { return null; } },
    escribir(v) { try { localStorage.setItem(clave, JSON.stringify(v)); } catch (_) { /* sin almacenamiento */ } }
  };
}

// ------------------------------------------------------------------ servidor
// En la computadora de desarrollo, el servidor de prueba (pruebas/servidor-lti.mjs) atiende en /sim.
// Ahí nunca se usa el servidor real, para que los ensayos no toquen los datos verdaderos.
const base = local ? location.origin + '/sim' : config.servidor;
let srv = null, remoto = null, problema = null;
try { if (base) srv = await conectar(base); } catch (e) { problema = e instanceof SesionTerminada ? 'sesionTerminada' : 'sinServidor'; }

const copia = crearAlmacen('simulador:paquete');
if (srv) {
  try { remoto = await srv.api('/leccion'); if (remoto.leccion) copia.escribir(remoto); }
  catch (e) {
    if (e instanceof SesionTerminada) problema = 'sesionTerminada';
    else { remoto = copia.leer(); if (!remoto) problema = 'sinServidor'; } // sin señal: se usa la última copia
  }
}
const reg = (remoto && remoto.regional) || regLocal;
if (remoto && remoto.catalogos) aplicarCatalogos(remoto.catalogos);
const T = reg.textos.leccion;

// ------------------------------------------------------------------ hoja de cálculo
const libro = crearLibro();
const motor = crearMotor(libro, reg);
const desp = crearDespachador(libro, motor, reg);
const vista = crearVista(document.getElementById('app'), libro, motor, desp, reg);
window.simulador = { libro, motor, desp, vista, reg };

// En celulares el teclado en pantalla tapa parte de la página: se ajusta la altura al espacio visible.
if (window.visualViewport) {
  const ajustar = () => { marco.style.height = visualViewport.height + 'px'; scrollTo(0, 0); };
  visualViewport.addEventListener('resize', ajustar);
  visualViewport.addEventListener('scroll', ajustar);
}

// Aviso de conexión perdida.
const chip = document.createElement('div');
chip.className = 'conexion'; chip.setAttribute('role', 'status'); chip.textContent = reg.textos.sinConexion;
marco.appendChild(chip);
const conexion = () => { chip.hidden = navigator.onLine; };
addEventListener('online', conexion); addEventListener('offline', conexion);
conexion();

// Funcionamiento sin conexión. En la computadora de desarrollo queda apagado para ver siempre
// los cambios recientes; se puede encender añadiendo "offline" después del # de la dirección.
if ('serviceWorker' in navigator && (!local || location.hash.includes('offline'))) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(r => {
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(x => x.name).filter(u => u.startsWith(location.origin))];
    r.active.postMessage({ tipo: 'guardar', urls: [...new Set(urls)] });
  }).catch(() => { /* sin soporte: la app funciona igual, solo que necesita conexión */ });
}

// ------------------------------------------------------------------ pantallas de aviso
function tarjeta(html) {
  capa.innerHTML = '<div class="tarjeta" role="dialog" aria-modal="true">' + html + '</div>';
  capa.hidden = false;
}

// El docente elige qué lección abre esta actividad del curso.
function elegirLeccion(lecciones, actual, puedeCancelar) {
  tarjeta(`<h1>${esc(T.elegirTitulo)}</h1><p class="t-texto">${esc(T.elegirAyuda)}</p>
    <label class="t-campo">${esc(T.elegirLeccion)}
      <select id="el-leccion">${lecciones.map(l => `<option value="${esc(l.id)}"${l.id === actual ? ' selected' : ''}>${esc(l.titulo)}</option>`).join('')}</select></label>
    <label class="t-campo">${esc(T.elegirMax)}<input id="el-max" type="number" min="1" max="99" inputmode="numeric"></label>
    <div class="t-botones"><button class="primario" id="el-guardar">${esc(T.elegirGuardar)}</button>
      ${puedeCancelar ? `<button id="el-cancelar">${esc(T.elegirCancelar)}</button>` : ''}</div>`);
  capa.querySelector('#el-guardar').addEventListener('click', async () => {
    const max = parseInt(capa.querySelector('#el-max').value, 10);
    try {
      await srv.api('/colocacion', { leccion: capa.querySelector('#el-leccion').value, maxIntentos: Number.isInteger(max) ? max : null });
      location.reload();
    } catch (_) { vista.aviso(T.sinServidor); }
  });
  const cancelar = capa.querySelector('#el-cancelar');
  if (cancelar) cancelar.addEventListener('click', () => location.reload());
}

// ------------------------------------------------------------------ lección
async function leccionLocal() {
  const r = await fetch(LECCION_LOCAL);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

try {
  if (problema) tarjeta(`<p class="t-texto">${esc(T[problema])}</p>`);
  else if (!srv && config.servidor && !local) tarjeta(`<p class="t-texto">${esc(T.abrirDesdeCurso)}</p>`);
  else if (remoto && remoto.pendiente) tarjeta(`<p class="t-texto">${esc(T.leccionPendiente)}</p>`);
  else if (remoto && remoto.configurar) elegirLeccion(remoto.lecciones, null, false);
  else {
    const leccion = remoto ? remoto.leccion : await leccionLocal();
    const docente = remoto ? ['docente', 'propietario'].includes(remoto.usuario.rol) : location.hash.includes('docente');
    const sonidos = crearSonidos(SONIDOS);
    const repro = crearReproductor({ marco, vista, desp, sonidos });
    const grab = crearGrabadora(vista);
    // Bandeja de salida: eventos e intentos esperan aquí hasta que haya conexión.
    const enviar = srv && (async lote => {
      const eventos = lote.filter(x => x.clase !== 'intento');
      if (eventos.length) await srv.api('/eventos', { eventos });
      for (const intento of lote.filter(x => x.clase === 'intento')) await srv.api('/intento', intento);
    });
    const buzon = crearBuzon('simulador:buzon', enviar || null);
    const lec = crearLeccion({
      leccion, libro, motor, desp, vista, reg, sonidos, repro, grab, buzon,
      almacen: crearAlmacen('simulador:' + leccion.identidad.id),
      intentosPrevios: remoto ? remoto.intentos : null,
      maxIntentos: remoto && remoto.colocacion ? remoto.colocacion.maxIntentos : null
    });
    crearPanel(document.getElementById('panel'), capa, lec, reg, {
      docente,
      alConfigurar: remoto && docente && remoto.lecciones ? () => elegirLeccion(remoto.lecciones, leccion.identidad.id, true) : null
    });
    window.simulador.leccion = lec;
    window.simulador.buzon = buzon;
    buzon.vaciar();
  }
} catch (e) {
  vista.aviso('No se pudo cargar la lección. Puedes usar la hoja libremente.');
  console.error(e);
}

// Panel de seguimiento en vivo del docente. Se abre desde una actividad del simulador con
// el botón "Seguimiento en vivo": usa el mismo pase de sesión de esa pestaña.
import config from './config.js';
import regLocal from './regional/es-MX.js';
import { conectar, SesionTerminada } from './nucleo/servidor.js';

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const base = local ? location.origin + '/sim' : config.servidor;
const $ = id => document.getElementById(id);
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let M = regLocal.textos.monitor;
const pon = (txt, v) => Object.entries(v).reduce((a, [k, x]) => a.split('{' + k + '}').join(x), txt);
const duracion = s => s === null || s === undefined ? '—' : s < 60 ? pon(M.segundos, { s }) : pon(M.minutos, { m: Math.floor(s / 60), s: s % 60 });
const hora = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function aviso(texto) { $('m-cuerpo').innerHTML = `<div class="m-aviso">${esc(texto)}</div>`; $('m-estado').textContent = ''; }
function textos() {
  document.title = M.titulo; $('m-titulo').textContent = M.titulo;
  $('m-volver').textContent = '← ' + M.volver; $('m-volver').title = M.volver;
}
textos();

// Inicio del día en la hora de este dispositivo, para el resumen de hoy.
const hoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

let srv = null;
try { srv = base && await conectar(base); } catch (_) { srv = null; }
if (!srv) aviso(M.sinSesion);
else {
  let primera = true, reloj = 0, cada = 15;
  async function actualizar() {
    clearTimeout(reloj);
    try {
      const d = await srv.api('/monitor?desde=' + encodeURIComponent(hoy()) + (primera ? '&textos=1' : ''));
      if (primera && d.regional && d.regional.textos && d.regional.textos.monitor) { M = d.regional.textos.monitor; textos(); }
      primera = false;
      cada = (d.ajustes && d.ajustes.refrescoSeg) || 15;
      pintar(d);
      $('m-estado').classList.remove('mal');
      $('m-estado').textContent = pon(M.actualizado, { hora: new Date().toLocaleTimeString(), n: cada });
    } catch (e) {
      if (e instanceof SesionTerminada) { aviso(M.sinSesion); return; }
      if (/403/.test(e.message)) { aviso(M.soloDocente); return; }
      $('m-estado').classList.add('mal'); $('m-estado').textContent = M.sinConexion;
    }
    if (!document.hidden) reloj = setTimeout(actualizar, cada * 1000);
  }
  // Con la pestaña oculta no se pide nada: ahorra datos.
  addEventListener('visibilitychange', () => { if (!document.hidden) actualizar(); else clearTimeout(reloj); });
  actualizar();
}

function pintar(d) {
  const C = M.columnas;
  const trabados = d.conectados.filter(x => x.trabado);
  const filas = d.conectados.map(x => `<tr class="${x.trabado ? 'trabado' : ''}">
      <td data-c="${esc(C.nombre)}"><b>${esc(x.nombre)}</b><span class="chico">${esc(M.estados[x.estado] || x.estado || '')}</span></td>
      <td data-c="${esc(C.actividad)}">${esc(x.leccion)}<span class="chico">${esc(x.curso)}</span></td>
      <td data-c="${esc(C.paso)}">${x.pasoNumero ? esc(pon(M.pasoDe, { n: x.pasoNumero, total: x.pasosTotal })) + '<span class="chico">' + esc(x.pasoTitulo) + '</span>' : '—'}</td>
      <td data-c="${esc(C.tiempo)}">${esc(duracion(x.segundosPaso))}</td>
      <td data-c="${esc(C.errores)}">${x.errores}</td>
      <td data-c="${esc(C.equipo)}">${esc(M.equipo[x.dispositivo] || '—')}</td></tr>`).join('');

  const alertas = trabados.map(x => `<div class="m-alerta"><b>${esc(x.nombre)}</b>${esc(pon(M.trabadoPor, { t: duracion(x.segundosPaso), p: x.pasoNumero || '—', e: x.errores }))}
      <span class="chico">${esc(x.pasoTitulo || '')}</span></div>`).join('');

  const mapa = d.actividades.map(a => `<div class="m-actividad"><h3>${esc(a.leccion)}${a.titulo && a.titulo !== a.leccion ? ' · ' + esc(a.titulo) : ''}</h3>
      ${a.pasos.map(p => `<div class="m-paso"><span class="m-num">${p.numero}</span><span>${esc(p.titulo)}</span>
        <span class="m-cuantos ${p.personas.length ? '' : 'cero'}">${p.personas.length}</span>
        ${p.personas.length ? `<span class="m-nombres">${p.personas.map(esc).join(', ')}</span>` : ''}</div>`).join('')}
      ${a.fuera.length ? `<div class="m-paso"><span class="m-num">·</span><span>${esc(M.fueraDePasos)}</span><span class="m-cuantos">${a.fuera.length}</span>
        <span class="m-nombres">${a.fuera.map(x => esc(x.nombre) + ' (' + esc(M.estados[x.estado] || x.estado) + ')').join(', ')}</span></div>` : ''}</div>`).join('');

  const E = M.eventos;
  const recientes = d.recientes.map(e => {
    const clave = e.tipo === 'checkpoint_respuesta' && e.datos.correcta ? 'checkpoint_bien' : e.tipo;
    return `<li><time>${esc(hora(e.t))}</time><b>${esc(e.nombre)}</b> ${esc(pon(E[clave] || e.tipo, { p: e.paso || '', nota: e.datos.nota ?? '' }))}</li>`;
  }).join('');

  const R = d.resumen;
  const dificiles = R.dificiles.map(p => `<div>${esc(p.paso)} <span class="chico">${esc(p.leccion)} · ${p.primeraPct}% · ${esc(p.veces === 1 ? M.unaVez : pon(M.veces, { n: p.veces }))}</span>
      <div class="m-barra"><i style="width:${p.primeraPct}%"></i></div></div>`).join('');
  const errores = R.errores.map(x => `<li>${esc(x.texto)} <b>(${esc(x.veces === 1 ? M.unaVez : pon(M.veces, { n: x.veces }))})</b></li>`).join('');

  $('m-cuerpo').innerHTML = `
    <section class="m-caja alerta"><h2>${esc(pon(M.trabados, { n: trabados.length }))}</h2>${alertas || `<p class="m-vacio">${esc(M.ningunTrabado)}</p>`}</section>
    <section class="m-caja"><h2>${esc(M.resumen)}</h2>
      <div class="m-cifras"><div class="m-cifra"><b>${R.iniciados}</b><span>${esc(M.iniciados)}</span></div>
        <div class="m-cifra"><b>${R.terminados}</b><span>${esc(M.terminados)}</span></div>
        <div class="m-cifra"><b>${R.promedio ?? '—'}</b><span>${esc(M.promedio)}</span></div></div>
      <h4>${esc(M.dificiles)}</h4><p class="m-ayuda">${esc(M.dificilesAyuda)}</p>${dificiles || `<p class="m-vacio">${esc(M.nadaAun)}</p>`}
      <h4>${esc(M.erroresFrecuentes)}</h4><p class="m-ayuda">${esc(M.erroresAyuda)}</p>${errores ? `<ul>${errores}</ul>` : `<p class="m-vacio">${esc(M.nadaAun)}</p>`}</section>
    <section class="m-caja ancha"><h2>${esc(pon(M.conectados, { n: d.conectados.length }))}</h2>
      ${filas ? `<table class="m-tabla"><thead><tr>${['nombre', 'actividad', 'paso', 'tiempo', 'errores', 'equipo'].map(k => `<th>${esc(C[k])}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>`
        : `<p class="m-vacio">${esc(M.ningunConectado)}</p>`}</section>
    <section class="m-caja"><h2>${esc(M.mapa)}</h2><p class="m-ayuda">${esc(M.mapaAyuda)}</p>${mapa || `<p class="m-vacio">${esc(M.ningunConectado)}</p>`}</section>
    <section class="m-caja"><h2>${esc(M.recientes)}</h2>${recientes ? `<ul class="m-lista">${recientes}</ul>` : `<p class="m-vacio">${esc(M.sinRecientes)}</p>`}</section>`;
}

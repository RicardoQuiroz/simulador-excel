// Editor de lecciones del docente. Se abre desde una actividad del simulador con el botón
// "Editor de lecciones" y usa el mismo pase de sesión de esa pestaña.
// Tres formas de empezar: desde archivos de Excel, describiendo la lección al asistente o en blanco.
// Después: formulario, revisión automática, vista previa y guardado.
import config from '../config.js';
import regLocal from '../regional/es-MX.js';
import { conectar, SesionTerminada } from '../nucleo/servidor.js';
import { ERRORES_COMUNES, aplicarCatalogos } from '../leccion/catalogos.js';
import { FUNCIONES } from '../formulas/funciones.js';
import { crearDialecto, parseRango } from '../formulas/analizador.js';
import { leerXlsx } from './xlsx.js';
import { proponer, leccionVacia, formulaLocal, formulaCanon } from './proponer.js';
import { revisar, probar, CAMPOS } from './probar.js';

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const base = local ? location.origin + '/sim' : config.servidor;
const $ = id => document.getElementById(id);
const cuerpo = $('e-cuerpo'), barra = $('e-barra');
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pon = (txt, v) => Object.entries(v || {}).reduce((a, [k, x]) => a.split('{' + k + '}').join(x), String(txt || ''));
const copia = x => JSON.parse(JSON.stringify(x));
const ss = {
  leer(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (_) { return null; } },
  escribir(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* sin memoria */ } }
};

let reg = regLocal, E = regLocal.textos.editor, dialecto = crearDialecto(regLocal);
let srv = null, info = null; // info = respuesta de /editor
let estado = null;           // { lec, editable, sucio, mensaje }
const BORRADOR = 'simulador:editor';

function textos() {
  document.title = E.titulo; $('e-titulo').textContent = E.titulo;
  $('e-volver').textContent = '← ' + E.volver; $('e-volver').title = E.volver;
}
function aviso(html, clase = '') { cuerpo.innerHTML = `<div class="e-aviso ${clase}">${html}</div>`; barra.hidden = true; }
const mensajeError = e => e && e.mensaje ? e.mensaje : pon(E.errorGeneral, { e: e && e.message });

// ------------------------------------------------------------------ inicio
function inicio() {
  estado = null; ss.escribir(BORRADOR, null);
  barra.hidden = true;
  const fecha = t => t ? new Date(t).toLocaleDateString() : '—';
  const filas = (info.lecciones || []).map(l => `<tr>
      <td data-c="${esc(E.colTitulo)}"><b>${esc(l.titulo)}</b>${info.actividad && info.actividad.leccion === l.id ? `<span class="e-etiqueta">${esc(E.enUso)}</span>` : ''}</td>
      <td data-c="${esc(E.colAutor)}">${esc(l.propia ? E.autorTu : l.autor || E.autorSistema)}</td>
      <td data-c="${esc(E.colFecha)}">${esc(fecha(l.actualizada))}</td>
      <td class="acciones">${l.editable ? `<button class="chico" data-a="abrir" data-id="${esc(l.id)}">${esc(E.editar)}</button> ` : ''}<button class="chico" data-a="copiar" data-id="${esc(l.id)}">${esc(E.copiar)}</button></td></tr>`).join('');
  cuerpo.innerHTML = `
    <h2>${esc(E.nueva)}</h2>
    <div class="e-opciones">
      <button class="e-opcion" data-a="ir-importar"><b>${esc(E.nuevaExcel)}</b><span>${esc(E.nuevaExcelAyuda)}</span></button>
      <button class="e-opcion" data-a="ir-describir" ${info.asistente ? '' : 'disabled'}><b>${esc(E.nuevaDescribir)}</b><span>${esc(info.asistente ? E.nuevaDescribirAyuda : E.asistenteApagado)}</span></button>
      <button class="e-opcion" data-a="en-blanco"><b>${esc(E.nuevaBlanco)}</b><span>${esc(E.nuevaBlancoAyuda)}</span></button>
    </div>
    <h2>${esc(E.tusLecciones)}</h2>
    <p class="e-ayuda">${esc(E.tusLeccionesAyuda)}</p>
    <div class="e-caja"><table class="e-tabla"><thead><tr><th>${esc(E.colTitulo)}</th><th>${esc(E.colAutor)}</th><th>${esc(E.colFecha)}</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

async function abrir(id, comoCopia) {
  aviso(`<p class="e-espera">${esc(E.cargando)}</p>`);
  try {
    const r = await srv.api('/editor/leccion?id=' + encodeURIComponent(id));
    const lec = r.leccion;
    if (comoCopia) { lec.identidad = { ...lec.identidad, id: '', version: 0, titulo: lec.identidad.titulo + ' (copia)' }; }
    estado = { lec, editable: comoCopia ? true : r.editable, sucio: !!comoCopia, mensaje: null };
    guardarBorrador(); formulario();
  } catch (e) { aviso(esc(mensajeError(e)), 'mal'); }
}

// ------------------------------------------------------------------ importar desde Excel
function pantallaImportar() {
  barra.hidden = true;
  cuerpo.innerHTML = `<h2>${esc(E.importarTitulo)}</h2>
    <ol class="e-pasos-num">${E.importarPasos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>
    <div class="e-caja">
      <label class="e-campo">${esc(E.archivoEjercicio)}<input type="file" id="f-ej" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <label class="e-campo">${esc(E.archivoSolucion)}<input type="file" id="f-sol" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <p class="e-ayuda">${esc(E.soloXlsx)}</p>
      <div id="f-msg"></div>
      <button class="primario" data-a="leer-archivos">${esc(E.leerArchivos)}</button>
      <button data-a="inicio">← ${esc(E.irLista)}</button>
    </div>`;
}

const listaAvisos = avisos => {
  const vistos = new Map();
  for (const a of avisos) {
    const t = pon((E.avisos || {})[a.clave] || a.clave, { ...a, funciones: (a.funciones || []).map(f => dialecto.nombreFn(f)).join(', ') });
    vistos.set(t, (vistos.get(t) || 0) + 1);
  }
  return [...vistos.keys()].slice(0, 30);
};

async function leerArchivo(input) {
  const f = input.files && input.files[0];
  if (!f) return null;
  try { return await leerXlsx(await f.arrayBuffer()); }
  catch (_) { const e = new Error('noEsXlsx'); e.nombre = f.name; throw e; }
}

async function leerArchivos() {
  const msg = $('f-msg');
  if (typeof DecompressionStream === 'undefined') { msg.innerHTML = `<div class="e-aviso mal">${esc(E.sinNavegador)}</div>`; return; }
  const fe = $('f-ej'), fs = $('f-sol');
  if (!fe.files.length) { msg.innerHTML = `<div class="e-aviso mal">${esc(E.faltaEjercicio)}</div>`; return; }
  msg.innerHTML = `<p class="e-espera">${esc(E.cargando)}</p>`;
  try {
    const ej = await leerArchivo(fe), sol = await leerArchivo(fs);
    const titulo = fe.files[0].name.replace(/\.xlsx$/i, '').replace(/^\d+\s*/, '');
    let lec;
    if (sol) lec = proponer(ej.libro, sol.libro, reg, { titulo });
    else { lec = leccionVacia(titulo); lec.libroInicial = ej.libro; }
    const avisos = listaAvisos([...ej.avisos, ...(sol ? sol.avisos : [])]);
    let html = '';
    if (sol && !lec.pasos.length) html += `<div class="e-aviso ojo">${esc(E.sinDiferencias)}</div>`;
    else if (sol) html += `<div class="e-aviso bien">${esc(pon(E.propuestaLista, { n: lec.pasos.length }))}</div>`;
    if (avisos.length) html += `<div class="e-aviso ojo"><p><b>${esc(E.avisosTitulo)}</b></p><ul>${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
    estado = { lec, editable: true, sucio: true, mensaje: html ? { html } : null };
    guardarBorrador(); formulario();
  } catch (e) {
    msg.innerHTML = `<div class="e-aviso mal">${esc(e.message === 'noEsXlsx' ? pon(E.noEsXlsx, { nombre: e.nombre }) : mensajeError(e))}</div>`;
  }
}

// ------------------------------------------------------------------ describir al asistente
function pantallaDescribir() {
  barra.hidden = true;
  cuerpo.innerHTML = `<h2>${esc(E.describirTitulo)}</h2>
    <ol class="e-pasos-num">${E.describirPasos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>
    <div class="e-caja">
      <label class="e-campo"><textarea id="d-texto" rows="7" placeholder="${esc(E.describirEjemplo)}"></textarea></label>
      <div id="d-msg"></div>
      <button class="primario" data-a="describir">${esc(E.crearPropuesta)}</button>
      <button data-a="inicio">← ${esc(E.irLista)}</button>
    </div>`;
}

async function pedirAsistente(modo, pedido, lec, msg, botones) {
  msg.innerHTML = `<p class="e-espera">${esc(E.pensando)}</p>`;
  botones.forEach(b => { b.disabled = true; });
  try {
    const r = await srv.api('/editor/asistente', { modo, pedido, leccion: lec || undefined, funciones: [...Object.keys(FUNCIONES), 'IF', 'IFERROR'] });
    return r.leccion;
  } catch (e) {
    msg.innerHTML = `<div class="e-aviso mal">${esc(mensajeError(e))}</div>`;
    return null;
  } finally { botones.forEach(b => { b.disabled = false; }); }
}

async function describir() {
  const texto = $('d-texto').value.trim(), msg = $('d-msg');
  if (texto.length < 5) { $('d-texto').focus(); return; }
  const lec = await pedirAsistente('crear', texto, null, msg, [...cuerpo.querySelectorAll('button')]);
  if (!lec) return;
  completar(lec);
  estado = { lec, editable: true, sucio: true, mensaje: null };
  guardarBorrador(); formulario();
  await revisarYProbar(true);
}

// Rellena lo que una respuesta del asistente pudiera traer incompleto.
function completar(lec) {
  const v = leccionVacia('');
  for (const k of Object.keys(v)) if (lec[k] === undefined) lec[k] = v[k];
  lec.identidad = { ...v.identidad, ...lec.identidad };
  lec.interfaz = { ...v.interfaz, ...lec.interfaz };
  for (const p of lec.pasos || []) { if (!Array.isArray(p.pistas)) p.pistas = []; if (!Array.isArray(p.erroresComunes)) p.erroresComunes = []; if (!p.validar) p.validar = { combinar: 'todas', reglas: [] }; }
}

// ------------------------------------------------------------------ formulario
const ruta = (obj, r) => r.split('.').reduce((o, k) => o == null ? o : o[k], obj);
function fijar(obj, r, valor) {
  const ks = r.split('.'), ult = ks.pop();
  let o = obj;
  for (const k of ks) { if (o[k] == null) o[k] = /^\d+$/.test(k) ? [] : {}; o = o[k]; }
  o[ult] = valor;
}

const campo = (etq, r, tipo = 'texto', extra = '') => {
  const v = ruta(estado.lec, r);
  const valor = tipo === 'lineas' ? (v || []).join('\n') : v === undefined || v === null ? '' : v;
  if (tipo === 'area' || tipo === 'lineas') return `<label class="e-campo">${esc(etq)}<textarea data-c="${r}" data-t="${tipo}" rows="${tipo === 'lineas' ? 3 : 2}" ${extra}>${esc(valor)}</textarea></label>`;
  return `<label class="e-campo">${esc(etq)}<input data-c="${r}" data-t="${tipo}" value="${esc(valor)}" ${tipo === 'numero' ? 'type="number" inputmode="numeric" min="0"' : ''} ${extra}></label>`;
};

function textoRegla(r, k) {
  if (k === 'referencia' || k === 'referenciaPrimeraFila') return r[k] ? formulaLocal(r[k], reg) : '';
  if (k === 'funcion') return r[k] ? dialecto.nombreFn(r[k]) : '';
  if (k === 'valor') return r[k] === undefined ? '' : typeof r[k] === 'number' ? String(r[k]).replace('.', reg.sepDec) : String(r[k]);
  return r[k] === undefined ? '' : String(r[k]);
}

function htmlRegla(r, rr) {
  const tipos = Object.keys(CAMPOS).map(t => `<option value="${t}"${t === r.tipo ? ' selected' : ''}>${esc((E.reglas || {})[t] || t)}</option>`).join('');
  const campos = (CAMPOS[r.tipo] || []).filter(k => k !== 'fmt').map(k => {
    if (k === 'modo') return '';
    return `<label>${esc((E.camposRegla || {})[k] || k)}<input data-r="${rr}" data-k="${k}" value="${esc(textoRegla(r, k))}"></label>`;
  });
  if (r.tipo === 'valor_celda') campos.push(`<label>${esc(E.camposRegla.valor)}<input data-r="${rr}" data-k="valor" value="${esc(textoRegla(r, 'valor'))}"></label>`);
  if (r.tipo === 'referencia') campos.push(`<label>${esc(E.camposRegla.modo)}<select data-r="${rr}" data-k="modo">${Object.entries(E.modosRef).map(([k, t]) => `<option value="${k}"${r.modo === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`);
  if (r.tipo === 'formato') {
    const fmt = r.fmt || {};
    campos.push(`<div>${Object.entries(E.fmtCasillas).map(([k, t]) => `<label class="e-marca"><input type="checkbox" data-r="${rr}" data-fmt="${k}"${fmt[k] ? ' checked' : ''}>${esc(t)}</label>`).join('')}</div>`);
    const nums = ['', 'numero', 'moneda', 'porcentaje', 'fecha', 'texto'];
    campos.push(`<label>${esc(E.fmtNumero)}<select data-r="${rr}" data-fmt="num">${nums.map(n => `<option value="${n}"${(fmt.num || '') === n ? ' selected' : ''}>${esc(n ? E.formatos['num_' + n] : E.fmtSinCambio)}</option>`).join('')}</select></label>`);
  }
  return `<div class="e-regla"><select data-r="${rr}" data-k="tipo">${tipos}</select><div class="e-fila">${campos.join('')}</div>
    <div><button class="chico peligro" data-a="quitar-regla" data-r="${rr}">${esc(E.quitarRegla)}</button></div></div>`;
}

function htmlPaso(p, i, total) {
  const r = 'pasos.' + i;
  const res = String(p.resaltar || '').replace(/^(celda|rango):/, '');
  const marcados = new Set((p.erroresComunes || []).filter(x => x.error).map(x => x.error));
  const propios = (p.erroresComunes || []).filter(x => !x.error).length;
  const reglas = (p.validar && p.validar.reglas) || [];
  return `<div class="e-paso" id="paso-${i}">
    <div class="e-paso-cab"><h3>${esc(pon(E.paso, { n: i + 1 }))}</h3><div>
      <button class="chico" data-a="subir" data-i="${i}" ${i ? '' : 'disabled'} title="${esc(E.subir)}">↑ ${esc(E.subir)}</button>
      <button class="chico" data-a="bajar" data-i="${i}" ${i < total - 1 ? '' : 'disabled'} title="${esc(E.bajar)}">↓ ${esc(E.bajar)}</button>
      <button class="chico peligro" data-a="quitar-paso" data-i="${i}">${esc(E.quitarPaso)}</button></div></div>
    ${campo(E.campoInstruccion, r + '.instruccion', 'area')}
    <div class="e-fila">
      <label class="e-campo">${esc(E.campoResaltar)}<input data-resaltar="${i}" value="${esc(res)}"></label>
      ${campo(E.campoPuntos, r + '.puntos', 'numero')}
    </div>
    <p class="e-ayuda"><b>${esc(E.campoPistas)}</b></p>
    ${[0, 1, 2].map(k => campo(E.pistaN[k], r + '.pistas.' + k, 'area')).join('')}
    ${campo(E.campoMensaje, r + '.alCompletar.mensaje')}
    <div class="e-reglas"><h3>${esc(E.revision)}</h3><p class="e-ayuda">${esc(E.revisionAyuda)}</p>
      <label class="e-campo"><select data-c="${r}.validar.combinar" data-t="texto"><option value="todas"${(p.validar || {}).combinar !== 'alguna' ? ' selected' : ''}>${esc(E.combinarTodas)}</option><option value="alguna"${(p.validar || {}).combinar === 'alguna' ? ' selected' : ''}>${esc(E.combinarAlguna)}</option></select></label>
      ${reglas.map((x, k) => htmlRegla(x, r + '.validar.reglas.' + k)).join('')}
      <button class="chico" data-a="agregar-regla" data-i="${i}">${esc(E.agregarRegla)}</button>
    </div>
    <div class="e-reglas"><h3>${esc(E.erroresTitulo)}</h3><p class="e-ayuda">${esc(E.erroresAyuda)}</p>
      <div class="e-errores">${Object.entries(ERRORES_COMUNES).map(([k, t]) => `<label class="e-marca"><input type="checkbox" data-error="${esc(k)}" data-i="${i}"${marcados.has(k) ? ' checked' : ''}>${esc(t)}</label>`).join('')}</div>
      ${propios ? `<p class="e-ayuda">${esc(pon(E.erroresPropios, { n: propios }))}</p>` : ''}
    </div></div>`;
}

function htmlPregunta(cp, i) {
  const r = 'checkpoints.' + i, ops = (cp.pregunta && cp.pregunta.opciones) || [];
  const pasos = estado.lec.pasos.map((p, k) => `<option value="${esc(p.id)}"${cp.despuesDelPaso === p.id ? ' selected' : ''}>${esc(pon(E.paso, { n: k + 1 }))}</option>`).join('');
  return `<div class="e-pregunta"><div class="e-paso-cab"><h3>${esc(pon(E.pregunta, { n: i + 1 }))}</h3>
      <button class="chico peligro" data-a="quitar-pregunta" data-i="${i}">${esc(E.quitarPregunta)}</button></div>
    ${campo(E.campoEnunciado, r + '.pregunta.enunciado', 'area')}
    <label class="e-campo">${esc(E.campoDespues)}<select data-c="${r}.despuesDelPaso" data-t="texto">${pasos}</select></label>
    ${ops.map((o, k) => `<div class="e-opcion-preg">${campo(pon(E.opcion, { n: k + 1 }), r + '.pregunta.opciones.' + k + '.texto')}
      <label class="e-marca"><input type="radio" name="correcta-${i}" data-correcta="${i}" data-k="${k}"${o.correcta ? ' checked' : ''}>${esc(E.correcta)}</label>
      ${campo(E.explicacion, r + '.pregunta.opciones.' + k + '.explicacion', 'area')}</div>`).join('')}
  </div>`;
}

function formulario() {
  const L = estado.lec;
  const celdas = (L.libroInicial.hojas || []).reduce((a, h) => a + Object.keys(h.celdas || {}).length, 0);
  const preguntas = (L.checkpoints || []).map((c, i) => c.tipo === 'pregunta' ? htmlPregunta(c, i) : '').join('');
  const demo = L.demo || [];
  cuerpo.innerHTML = `
    <div id="e-msg">${estado.mensaje ? (estado.mensaje.clase ? `<div class="e-aviso ${estado.mensaje.clase}">${estado.mensaje.html}</div>` : estado.mensaje.html) : ''}</div>
    ${estado.editable ? '' : `<div class="e-aviso ojo">${esc(E.noEditable)}</div>`}
    <details class="e-seccion" open><summary>${esc(E.secGeneral)}</summary><div class="e-dentro">
      ${campo(E.campoTitulo, 'identidad.titulo')}
      <div class="e-fila">${campo(E.campoMateria, 'identidad.materia')}${campo(E.campoTema, 'identidad.tema')}${campo(E.campoDuracion, 'identidad.duracionMin', 'numero')}</div>
      ${campo(E.campoObjetivos, 'pedagogia.objetivos', 'lineas')}
      <label class="e-marca"><input type="checkbox" data-c="modos.libre" data-t="bool"${!L.modos || L.modos.libre !== false ? ' checked' : ''}>${esc(E.modoLibre)}</label>
    </div></details>
    <details class="e-seccion" open><summary>${esc(E.secHoja)}</summary><div class="e-dentro">
      <p>${esc(pon(E.hojaResumen, { hojas: L.libroInicial.hojas.length, celdas }))} ${esc(E.hojaVer)}</p>
      <label class="e-campo">${esc(E.hojaReemplazar)}<input type="file" id="f-hoja" accept=".xlsx"></label>
      <label class="e-campo">${esc(E.campoEditables)}<input data-editables="1" value="${esc(((L.interfaz || {}).celdasEditables || []).join(', '))}"></label>
      <p class="e-ayuda">${esc(E.editablesAyuda)}</p>
    </div></details>
    <details class="e-seccion" open><summary>${esc(E.secPasos)} (${L.pasos.length})</summary><div class="e-dentro">
      ${L.pasos.map((p, i) => htmlPaso(p, i, L.pasos.length)).join('')}
      <button data-a="agregar-paso">${esc(E.agregarPaso)}</button>
    </div></details>
    <details class="e-seccion"><summary>${esc(E.secPreguntas)} (${(L.checkpoints || []).filter(c => c.tipo === 'pregunta').length})</summary><div class="e-dentro">
      ${preguntas}<button data-a="agregar-pregunta" ${L.pasos.length ? '' : 'disabled'}>${esc(E.agregarPregunta)}</button>
    </div></details>
    <details class="e-seccion"><summary>${esc(E.secDemo)}</summary><div class="e-dentro">
      <p>${esc(demo.length ? pon(E.demoTiene, { n: demo.length }) : E.demoNo)}</p>
      <ol class="e-pasos-num">${E.demoComo.map(p => `<li>${esc(p)}</li>`).join('')}</ol>
      ${demo.length ? `<button class="peligro" data-a="quitar-demo">${esc(E.demoQuitar)}</button>` : ''}
    </div></details>
    <details class="e-seccion"><summary>${esc(E.secCierre)}</summary><div class="e-dentro">
      ${campo(E.campoCierre, 'cierre.mensaje', 'area')}${campo(E.campoResumen, 'cierre.resumen', 'lineas')}
    </div></details>
    ${info.asistente ? `<details class="e-seccion"><summary>${esc(E.ajustarTitulo)}</summary><div class="e-dentro">
      <p class="e-ayuda">${esc(E.ajustarAyuda)}</p>
      <label class="e-campo"><textarea id="a-texto" rows="3"></textarea></label><div id="a-msg"></div>
      <button data-a="ajustar">${esc(E.ajustar)}</button></div></details>` : ''}
    <details class="e-seccion" id="sec-tecnico"><summary>${esc(E.secTecnico)}</summary><div class="e-dentro">
      <p class="e-ayuda">${esc(E.tecnicoAyuda)}</p><textarea class="e-json" id="t-json" spellcheck="false"></textarea><div id="t-msg"></div>
      <button data-a="aplicar-json">${esc(E.aplicarJson)}</button></div></details>`;
  pintarBarra();
}

function pintarBarra(guardada) {
  barra.hidden = false;
  barra.innerHTML = `<button data-a="revisar">${esc(E.revisarProbar)}</button>
    <button data-a="previa">${esc(E.vistaPrevia)}</button>
    <button class="primario" data-a="guardar">${esc(estado.editable ? E.guardar : E.guardarCopia)}</button>
    ${guardada ? `<button data-a="usar">${esc(E.usarAqui)}</button>` : ''}
    <button data-a="salir">← ${esc(E.irLista)}</button>`;
}

function mostrarMensaje(html, clase) {
  estado.mensaje = { html, clase }; guardarBorrador();
  const m = $('e-msg');
  if (m) { m.innerHTML = `<div class="e-aviso ${clase}">${html}</div>`; m.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

// ------------------------------------------------------------------ edición
function alEscribir(ev) {
  const t = ev.target;
  if (!estado || !t.dataset) return;
  const L = estado.lec;
  if (t.dataset.c) {
    const tipo = t.dataset.t;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (tipo === 'numero') v = t.value === '' ? undefined : Math.max(0, Number(t.value));
    if (tipo === 'lineas') v = t.value.split('\n').map(x => x.trim()).filter(Boolean);
    fijar(L, t.dataset.c, v);
  } else if (t.dataset.resaltar !== undefined) {
    const p = L.pasos[+t.dataset.resaltar], x = t.value.trim().toUpperCase();
    const q = parseRango(x);
    t.classList.toggle('mal', !!x && !q);
    p.resaltar = !x ? undefined : (x.includes(':') ? 'rango:' : 'celda:') + x;
  } else if (t.dataset.editables) {
    const zonas = t.value.split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    t.classList.toggle('mal', zonas.some(z => !parseRango(z)));
    L.interfaz = { ...(L.interfaz || {}), celdasEditables: zonas };
  } else if (t.dataset.r && t.dataset.k && t.dataset.k !== 'tipo') {
    const r = ruta(L, t.dataset.r), k = t.dataset.k, x = t.value.trim();
    if (k === 'referencia' || k === 'referenciaPrimeraFila') {
      try { r[k] = x ? formulaCanon(x, reg) : ''; t.classList.remove('mal'); } catch (_) { r[k] = x.replace(/^=/, ''); t.classList.add('mal'); }
    } else if (k === 'funcion') r[k] = dialecto.canonFn(x.toUpperCase()).replace(/^__/, '');
    else if (k === 'valor') {
      const n = x.replace(reg.sepMiles === '.' ? /\./g : /,/g, '').replace(reg.sepDec, '.');
      if (x === '') delete r.valor; else r.valor = /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : x;
    } else if (k === 'celda' || k === 'rango' || k === 'a') { r[k] = x.toUpperCase(); t.classList.toggle('mal', !!x && !parseRango(x.replace(/\$/g, ''))); }
    else r[k] = x;
  } else if (t.dataset.r && t.dataset.fmt) {
    const r = ruta(L, t.dataset.r); r.fmt = r.fmt || {};
    if (t.type === 'checkbox') { if (t.checked) r.fmt[t.dataset.fmt] = true; else delete r.fmt[t.dataset.fmt]; }
    else if (t.value) r.fmt.num = t.value; else delete r.fmt.num;
  } else if (t.dataset.error) {
    const p = L.pasos[+t.dataset.i]; p.erroresComunes = (p.erroresComunes || []).filter(x => x.error !== t.dataset.error);
    if (t.checked) p.erroresComunes.push({ error: t.dataset.error });
  } else if (t.dataset.correcta !== undefined) {
    const ops = L.checkpoints[+t.dataset.correcta].pregunta.opciones;
    ops.forEach((o, k) => { o.correcta = k === +t.dataset.k; });
  } else return;
  cambio();
}

async function alCambiar(ev) {
  const t = ev.target;
  if (t.dataset && t.dataset.r && t.dataset.k === 'tipo') {
    const L = estado.lec, ks = t.dataset.r.split('.'), k = +ks.pop(), lista = ruta(L, ks.join('.'));
    lista[k] = { tipo: t.value, ...(lista[k].celda ? { celda: lista[k].celda } : {}), ...(lista[k].rango ? { rango: lista[k].rango } : {}) };
    cambio(); formulario();
    return;
  }
  if (t.id === 'f-hoja' && t.files.length) {
    try {
      const r = await leerXlsx(await t.files[0].arrayBuffer());
      estado.lec.libroInicial = r.libro; cambio();
      const avisos = listaAvisos(r.avisos);
      formulario();
      if (avisos.length) mostrarMensaje(`<p><b>${esc(E.avisosTitulo)}</b></p><ul>${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`, 'ojo');
    } catch (_) { mostrarMensaje(esc(pon(E.noEsXlsx, { nombre: t.files[0].name })), 'mal'); }
    return;
  }
  alEscribir(ev);
}

const nuevoId = () => { let n = estado.lec.pasos.length + 1; while (estado.lec.pasos.some(p => p.id === 'p' + n)) n++; return 'p' + n; };

// ------------------------------------------------------------------ revisión
function textoProblema(p) {
  const d = { ...p, paso: p.paso === undefined ? '' : p.paso };
  if (p.clave === 'rangoInvalido' && p.paso === undefined) d.paso = '';
  else if (p.clave === 'rangoInvalido') d.paso = ' (' + pon(E.paso, { n: p.paso }) + ')';
  return pon((E.problemas || {})[p.clave] || p.clave, d);
}

function diagnostico() {
  const L = estado.lec;
  const graves = revisar(L), leves = [];
  if (!graves.length) {
    const r = probar(L, reg);
    for (const x of r.pasos) {
      if (!x.ok) graves.push({ clave: 'pasoFalla', paso: x.numero, detalle: x.fallos.map(f => ((E.reglas || {})[f.tipo] || f.tipo) + (f.celda ? ' ' + f.celda : '')).join('; ') });
      else if (x.yaCumplido) leves.push({ clave: 'pasoYaHecho', paso: x.numero });
    }
  }
  return { graves, leves };
}

async function revisarYProbar() {
  const { graves, leves } = diagnostico();
  if (!graves.length && !leves.length) { mostrarMensaje(esc(E.revisionOk), 'bien'); return true; }
  const lista = xs => `<ul>${xs.map(x => `<li>${esc(textoProblema(x))}</li>`).join('')}</ul>`;
  const reparar = info.asistente && graves.length ? `<p style="margin-top:8px"><button data-a="reparar">${esc(E.repararIA)}</button></p>` : '';
  if (graves.length) mostrarMensaje(`<p><b>${esc(E.revisionProblemas)}</b></p>${lista(graves)}${leves.length ? lista(leves) : ''}${reparar}`, 'mal');
  else mostrarMensaje(`<p><b>${esc(E.revisionAvisos)}</b></p>${lista(leves)}`, 'ojo');
  return !graves.length;
}

async function guardar() {
  if (!(await revisarYProbar())) return;
  const b = barra.querySelector('[data-a="guardar"]'); b.disabled = true; b.textContent = E.guardando;
  try {
    const r = await srv.api('/editor/guardar', { leccion: estado.lec, copia: !estado.editable });
    estado.lec.identidad = { ...estado.lec.identidad, id: r.id, version: r.version };
    estado.editable = true; estado.sucio = false; guardarBorrador();
    info = await srv.api('/editor').catch(() => info);
    pintarBarra(true);
    mostrarMensaje(esc(E.guardada), 'bien');
  } catch (e) { pintarBarra(); mostrarMensaje(esc(mensajeError(e)), 'mal'); }
}

async function usarAqui() {
  try {
    await srv.api('/colocacion', { leccion: estado.lec.identidad.id });
    mostrarMensaje(esc(pon(E.usada, { t: estado.lec.identidad.titulo })), 'bien');
  } catch (e) { mostrarMensaje(esc(mensajeError(e)), 'mal'); }
}

function vistaPrevia() {
  guardarBorrador();
  ss.escribir('simulador:previa', { ...copia(estado.lec), identidad: { ...estado.lec.identidad, id: estado.lec.identidad.id || 'vista-previa' } });
  ss.escribir('simulador:previa-regional', { regional: info.regional || null, catalogos: info.catalogos || null });
  saliendoAPrevia = true;
  location.href = './#previa';
}

// ------------------------------------------------------------------ botones
document.addEventListener('input', alEscribir);
document.addEventListener('change', alCambiar);
document.addEventListener('toggle', ev => {
  if (ev.target.id === 'sec-tecnico' && ev.target.open) $('t-json').value = JSON.stringify(estado.lec, null, 2);
}, true);
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const L = estado && estado.lec, i = +b.dataset.i;
  switch (b.dataset.a) {
    case 'inicio': inicio(); break;
    case 'salir':
      if (estado && estado.sucio && !confirm(E.sinCambiosGuardados)) return;
      inicio(); break;
    case 'abrir': abrir(b.dataset.id, false); break;
    case 'copiar': abrir(b.dataset.id, true); break;
    case 'ir-importar': pantallaImportar(); break;
    case 'ir-describir': pantallaDescribir(); break;
    case 'en-blanco': estado = { lec: leccionVacia(''), editable: true, sucio: true, mensaje: null }; guardarBorrador(); formulario(); break;
    case 'leer-archivos': leerArchivos(); break;
    case 'describir': describir(); break;
    case 'subir': case 'bajar': {
      const j = b.dataset.a === 'subir' ? i - 1 : i + 1;
      [L.pasos[i], L.pasos[j]] = [L.pasos[j], L.pasos[i]];
      cambio(); formulario(); const el = $('paso-' + j); if (el) el.scrollIntoView({ block: 'center' });
      break;
    }
    case 'quitar-paso':
      if (!confirm(pon(E.confirmarQuitar, { n: i + 1 }))) return;
      L.checkpoints = (L.checkpoints || []).filter(c => c.despuesDelPaso !== L.pasos[i].id);
      L.pasos.splice(i, 1); cambio(); formulario(); break;
    case 'agregar-paso':
      L.pasos.push({ id: nuevoId(), instruccion: '', puntos: 10, validar: { combinar: 'todas', reglas: [{ tipo: 'valor_celda', celda: 'A1' }] }, pistas: ['', '', ''], erroresComunes: [], alCompletar: { sonido: 'correcto' } });
      cambio(); formulario(); { const el = $('paso-' + (L.pasos.length - 1)); if (el) el.scrollIntoView({ block: 'center' }); }
      break;
    case 'agregar-regla': { const p = L.pasos[i]; p.validar = p.validar || { combinar: 'todas', reglas: [] }; p.validar.reglas.push({ tipo: 'es_formula', celda: '' }); cambio(); formulario(); $('paso-' + i).scrollIntoView({ block: 'center' }); break; }
    case 'quitar-regla': { const ks = b.dataset.r.split('.'), k = +ks.pop(); ruta(L, ks.join('.')).splice(k, 1); cambio(); formulario(); break; }
    case 'agregar-pregunta':
      L.checkpoints = L.checkpoints || [];
      L.checkpoints.push({ id: 'c' + (L.checkpoints.length + 1) + '-' + Date.now().toString(36).slice(-3), despuesDelPaso: L.pasos[L.pasos.length - 1].id, tipo: 'pregunta', puntos: 10,
        pregunta: { enunciado: '', opciones: [0, 1, 2].map(k => ({ texto: '', correcta: k === 0, explicacion: '' })) }, siFalla: { accion: 'explicarYContinuar' } });
      cambio(); formulario(); break;
    case 'quitar-pregunta': L.checkpoints.splice(i, 1); cambio(); formulario(); break;
    case 'quitar-demo': L.demo = []; L.pasos.forEach(p => { delete p.microDemo; }); cambio(); formulario(); break;
    case 'aplicar-json':
      try { const n = JSON.parse($('t-json').value); completar(n); estado.lec = n; cambio(); formulario(); }
      catch (e) { $('t-msg').innerHTML = `<div class="e-aviso mal">${esc(pon(E.jsonInvalido, { e: e.message }))}</div>`; }
      break;
    case 'ajustar': case 'reparar': {
      const pedido = b.dataset.a === 'reparar'
        ? [...document.querySelectorAll('#e-msg li')].map(x => '- ' + x.textContent).join('\n')
        : ($('a-texto') || {}).value || '';
      if (pedido.trim().length < 5) return;
      const msg = b.dataset.a === 'reparar' ? $('e-msg') : $('a-msg');
      const n = await pedirAsistente('ajustar', pedido, L, msg, [b]);
      if (!n) return;
      completar(n); estado.lec = n; cambio(); formulario();
      if (await revisarYProbar(true)) mostrarMensaje(esc(E.ajustado), 'bien');
      break;
    }
    case 'revisar': revisarYProbar(); break;
    case 'previa': vistaPrevia(); break;
    case 'guardar': guardar(); break;
    case 'usar': usarAqui(); break;
  }
});

// ------------------------------------------------------------------ arranque
textos();
try { srv = base && await conectar(base); } catch (_) { srv = null; }
if (!srv) aviso(esc(E.sinSesion));
else {
  try {
    info = await srv.api('/editor?textos=1');
    if (info.regional && info.regional.textos) {
      reg = info.regional;
      if (reg.textos.editor) E = reg.textos.editor;
      else reg = { ...reg, textos: { ...reg.textos, editor: E } };
    }
    dialecto = crearDialecto(reg);
    if (info.catalogos) aplicarCatalogos(info.catalogos);
    textos();
    estado = ss.leer(BORRADOR);
    const demo = ss.leer('simulador:previa-demo');
    if (estado && demo) { estado.lec.demo = demo; estado.sucio = true; estado.mensaje = { clase: 'bien', html: esc(pon(E.demoRecibida, { n: demo.length })) }; }
    ss.escribir('simulador:previa-demo', null);
    if (estado) formulario(); else inicio();
  } catch (e) {
    if (e instanceof SesionTerminada) aviso(esc(E.sinSesion));
    else if (e.estado === 403) aviso(esc(E.soloDocente));
    else aviso(esc(E.sinConexion), 'mal');
  }
}
addEventListener('beforeunload', ev => { if (estado && estado.sucio && !saliendoAPrevia) { ev.preventDefault(); ev.returnValue = ''; } });
let saliendoAPrevia = false;
const guardarBorrador = () => ss.escribir(BORRADOR, estado);
const cambio = () => { if (estado) { estado.sucio = true; guardarBorrador(); } };

// Revisión de una lección antes de guardarla.
// 1) revisar(): que la estructura esté completa (títulos, pasos, reglas, celdas, fórmulas).
// 2) probar(): resuelve la lección paso a paso con la solución que se deduce de sus reglas
//    y confirma que cada paso se aprueba con ella, y que no estaba aprobado antes de hacerlo.
// No usa nada de la pantalla: funciona igual en el navegador y en las pruebas automáticas.

import { parseRango, parseDir, desplazar, analizar, recorrer, CANON } from '../formulas/analizador.js';
import { FUNCIONES } from '../formulas/funciones.js';
import { crearLibro, crearHoja, cargarJSON, obtener, asegurar } from '../nucleo/libro.js';
import { crearMotor } from '../formulas/motor.js';
import { VALIDADORES, validar } from '../leccion/validadores.js';

// Qué datos necesita cada tipo de regla.
export const CAMPOS = {
  valor_celda: ['celda'], es_formula: ['celda'], usa_funcion: ['celda', 'funcion'], no_usa_funcion: ['celda', 'funcion'],
  referencia: ['celda', 'a'], usa_rango: ['celda', 'rango'], usa_nombre: ['celda', 'nombre'],
  formula_equivalente: ['celda', 'referencia'], rango_relleno: ['rango', 'referenciaPrimeraFila'],
  rango_valores_fijos: ['rango'], formato: ['rango', 'fmt'], seleccion: ['rango'], comando_ejecutado: ['id'],
  nombre_definido: ['nombre'], hoja: ['nombre']
};
const CELDAS = ['celda', 'a'], RANGOS = ['rango'], FORMULAS = ['referencia', 'referenciaPrimeraFila'];

function formulaValida(t) {
  try {
    let ok = true;
    recorrer(analizar(String(t).replace(/^=/, ''), CANON), n => { if (n.t === 'fn' && !FUNCIONES[n.n] && n.n !== 'IF' && n.n !== 'IFERROR') ok = false; });
    return ok;
  } catch (_) { return false; }
}

function revisarRegla(r, donde, problemas) {
  if (!r || !VALIDADORES[r.tipo]) { problemas.push({ clave: 'reglaDesconocida', ...donde, tipo: r && r.tipo }); return; }
  for (const c of CAMPOS[r.tipo] || []) {
    const v = r[c];
    if (v === undefined || v === null || v === '') { problemas.push({ clave: 'faltaDato', ...donde, campo: c }); continue; }
    if (CELDAS.includes(c) && !parseDir(String(v).replace(/\$/g, ''))) problemas.push({ clave: 'celdaInvalida', ...donde, valor: v });
    if (RANGOS.includes(c) && !parseRango(v)) problemas.push({ clave: 'rangoInvalido', ...donde, valor: v });
    if (FORMULAS.includes(c) && !formulaValida(v)) problemas.push({ clave: 'formulaInvalida', ...donde, valor: v });
  }
}

export function revisar(lec) {
  const p = [];
  if (!lec || typeof lec !== 'object') return [{ clave: 'vacia' }];
  if (!lec.identidad || !String(lec.identidad.titulo || '').trim()) p.push({ clave: 'sinTitulo' });
  const li = lec.libroInicial;
  if (!li || !Array.isArray(li.hojas) || !li.hojas.length) p.push({ clave: 'sinHoja' });
  if (!Array.isArray(lec.pasos) || !lec.pasos.length) p.push({ clave: 'sinPasos' });
  const ids = new Set();
  (lec.pasos || []).forEach((paso, i) => {
    const donde = { paso: i + 1 };
    if (!paso.id || ids.has(paso.id)) p.push({ clave: 'pasoSinId', ...donde });
    ids.add(paso.id);
    if (!String(paso.instruccion || '').trim()) p.push({ clave: 'sinInstruccion', ...donde });
    const reglas = paso.validar && paso.validar.reglas;
    if (!Array.isArray(reglas) || !reglas.length) p.push({ clave: 'sinReglas', ...donde });
    else reglas.forEach(r => revisarRegla(r, donde, p));
    if (paso.resaltar && !/^(celda:|rango:)/.test(paso.resaltar) && !/^ui:/.test(paso.resaltar)) p.push({ clave: 'resaltarInvalido', ...donde, valor: paso.resaltar });
    if (paso.resaltar && /^(celda|rango):/.test(paso.resaltar) && !parseRango(paso.resaltar.split(':').slice(1).join(':'))) p.push({ clave: 'resaltarInvalido', ...donde, valor: paso.resaltar });
    if (paso.pistas && !Array.isArray(paso.pistas)) p.push({ clave: 'pistasInvalidas', ...donde });
  });
  for (const z of (lec.interfaz && lec.interfaz.celdasEditables) || []) if (!parseRango(z)) p.push({ clave: 'rangoInvalido', valor: z });
  (lec.checkpoints || []).forEach((cp, i) => {
    const donde = { pregunta: i + 1 };
    if (cp.despuesDelPaso && !ids.has(cp.despuesDelPaso)) p.push({ clave: 'preguntaSinPaso', ...donde });
    if (cp.tipo === 'pregunta') {
      const q = cp.pregunta || {}, ops = q.opciones || [];
      if (!String(q.enunciado || '').trim()) p.push({ clave: 'preguntaSinEnunciado', ...donde });
      if (ops.length < 2) p.push({ clave: 'preguntaPocasOpciones', ...donde });
      if (ops.filter(o => o.correcta).length !== 1) p.push({ clave: 'preguntaSinCorrecta', ...donde });
    }
  });
  return p;
}

// ------------------------------------------------------------------ solución deducida
function hacer(r, libro, motor, comandos, hojaNombre) {
  const hoja = libro.hojas.find(h => h.nombre === (r.hoja || hojaNombre)) || libro.hojas[0];
  const cada = (q, fn) => { for (let f = q.f1; f <= q.f2; f++) for (let c = q.c1; c <= q.c2; c++) fn(c, f); };
  switch (r.tipo) {
    case 'formula_equivalente': { const p = parseDir(r.celda); const x = asegurar(hoja, p.c, p.f); x.ast = motor.analizarCanon(r.referencia); x.v = null; break; }
    case 'rango_relleno': {
      const q = parseRango(r.rango), ref = motor.analizarCanon(r.referenciaPrimeraFila);
      cada(q, (c, f) => { const x = asegurar(hoja, c, f); x.ast = desplazar(ref, c - q.c1, f - q.f1); x.v = null; });
      break;
    }
    case 'valor_celda': {
      if (!('valor' in r)) break;
      const p = parseDir(r.celda), x = obtener(hoja, p.c, p.f);
      if (x && x.ast) break; // es una consecuencia de una fórmula: no se escribe encima
      const y = asegurar(hoja, p.c, p.f); y.v = r.valor; y.ast = null;
      break;
    }
    case 'formato': cada(parseRango(r.rango), (c, f) => {
      const x = asegurar(hoja, c, f);
      for (const [k, v] of Object.entries(r.fmt || {})) { if (v === false || v === null) delete x.fmt[k]; else x.fmt[k] = v; }
    }); break;
    case 'seleccion': {
      const i = libro.hojas.indexOf(hoja), q = parseRango(r.rango);
      libro.activa = i; hoja.sel = { c1: q.c1, f1: q.f1, c2: q.c2, f2: q.f2, ac: q.c1, af: q.f1 };
      break;
    }
    case 'comando_ejecutado': comandos.add(r.id); break;
    case 'nombre_definido': if (r.rango) { const q = parseRango(r.rango); libro.nombres.set(r.nombre.toLowerCase(), { nombre: r.nombre, hoja: hoja.nombre, ...q }); } break;
    case 'hoja': if (!libro.hojas.some(h => h.nombre.toLowerCase() === r.nombre.toLowerCase())) libro.hojas.push(crearHoja(r.nombre)); break;
  }
}

const cumple = (v, ctx) => {
  const reglas = (v && v.reglas) || [];
  const res = reglas.map(r => ({ regla: r, ...validar(r, ctx) }));
  const ok = v && v.combinar === 'alguna' ? res.some(x => x.ok) : res.every(x => x.ok);
  return { ok, fallos: res.filter(x => !x.ok) };
};

// Devuelve { ok, pasos: [{ id, numero, ok, yaCumplido, fallos }], reto }.
export function probar(lec, reg) {
  const libro = crearLibro(), motor = crearMotor(libro, reg);
  cargarJSON(libro, lec.libroInicial, motor);
  motor.recalcular();
  const hojaNombre = lec.libroInicial.hojaActiva || libro.hojas[0].nombre;
  const salida = [];
  (lec.pasos || []).forEach((paso, i) => {
    const comandos = new Set();
    const ctx = () => ({ libro, motor, reg, hojaNombre, comandos, rech: null });
    const antes = cumple(paso.validar, ctx());
    try { for (const r of (paso.validar && paso.validar.reglas) || []) hacer(r, libro, motor, comandos, hojaNombre); } catch (_) { /* se informa abajo */ }
    motor.recalcular();
    const despues = cumple(paso.validar, ctx());
    salida.push({ id: paso.id, numero: i + 1, ok: despues.ok, yaCumplido: antes.ok, fallos: despues.fallos.map(f => ({ tipo: f.regla.tipo, motivo: f.motivo, celda: f.regla.celda || f.regla.rango })) });
  });
  return { ok: salida.every(x => x.ok && !x.yaCumplido), pasos: salida };
}

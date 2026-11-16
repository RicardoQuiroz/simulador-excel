// Validadores: comprueban si el libro cumple una regla de la lección.
// Cada uno recibe (regla, ctx) y devuelve { ok: true } o { ok: false, motivo }.
// ctx = { libro, motor, reg, hojaNombre, comandos, rech }

import { parseDir, parseRango, recorrer, desplazar, dir } from '../formulas/analizador.js';
import { Err } from '../formulas/funciones.js';
import { crearLibro, cargarJSON, aJSON, obtener, asegurar, resultado, hojaActiva } from '../nucleo/libro.js';
import { crearMotor } from '../formulas/motor.js';

const OK = { ok: true }, no = motivo => ({ ok: false, motivo });
const hojaDe = (ctx, r) => ctx.libro.hojas.find(h => h.nombre === (r.hoja || ctx.hojaNombre)) || hojaActiva(ctx.libro);
const celdaDe = (ctx, r) => { const p = parseDir(r.celda), h = hojaDe(ctx, r); return p ? obtener(h, p.c, p.f) : undefined; };
const cada = (r, fn) => { for (let f = r.f1; f <= r.f2; f++) for (let c = r.c1; c <= r.c2; c++) if (fn(c, f) === false) return false; return true; };

export const areaRegla = r => r.celda ? parseRango(r.celda) : r.rango ? parseRango(r.rango) : null;

function igual(a, b, opc = {}) {
  if (a instanceof Err || b instanceof Err) return a instanceof Err && b instanceof Err && a.c === b.c;
  if (a === null || a === undefined) a = '';
  if (b === null || b === undefined) b = '';
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (opc.tol || 1e-6) * Math.max(1, Math.abs(a), Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') {
    a = a.trim(); b = b.trim();
    return opc.ignorarMayusculas === false ? a === b : a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

// ---------- equivalencia de fórmulas por comportamiento ----------
// Copia el libro, cambia los datos numéricos varias veces y compara la fórmula del
// estudiante con la de referencia. Así se acepta cualquier solución correcta.
function banco(ctx) {
  if (ctx._banco) return ctx._banco;
  const libro = crearLibro(), motor = crearMotor(libro, ctx.reg);
  cargarJSON(libro, aJSON(ctx.libro, ctx.motor), motor);
  return (ctx._banco = { libro, motor });
}
function equivalente(ctx, r, c, f, astRef) {
  const b = banco(ctx), h = b.libro.hojas.find(x => x.nombre === (r.hoja || ctx.hojaNombre)) || b.libro.hojas[0];
  const cel = asegurar(h, c, f), astEst = cel.ast, vEst = cel.v;
  let entradas = [...h.celdas.values()].filter(x => x !== cel && !x.ast && typeof x.v === 'number');
  if (r.variar) {
    const zonas = r.variar.map(parseRango).filter(Boolean);
    entradas = [];
    for (const z of zonas) cada(z, (x, y) => { const e = obtener(h, x, y); if (e && e !== cel && !e.ast && typeof e.v === 'number') entradas.push(e); });
  }
  const originales = entradas.map(e => e.v);
  const medir = () => {
    cel.ast = astEst; cel.v = vEst; b.motor.recalcular();
    const a = resultado(cel);
    cel.ast = astRef; cel.v = null; b.motor.recalcular();
    return igual(a, resultado(cel), r);
  };
  const rondas = Math.max(40, r.juegosDeDatos || 0);
  let motivo = null;
  for (let k = 0; k <= rondas && !motivo; k++) {
    if (k === 1) entradas.forEach(e => { e.v = 100; });           // todos iguales: distingue > de >=
    else if (k > 1) entradas.forEach((e, i) => {
      const o = originales[i], tope = Math.max(10, Math.abs(o) * 2);
      e.v = Number.isInteger(o) ? Math.floor(Math.random() * (tope + 1)) : Math.round(Math.random() * tope * 100) / 100;
    });
    // Casos de borde: algunas celdas toman el valor de otra, su mitad, su doble o uno más o menos.
    // Así se distinguen condiciones como "<", "<=", "menos de la mitad", etc.
    if (k > 1 && entradas.length > 1) entradas.forEach(e => {
      if (Math.random() > 0.35) return;
      const otra = entradas[Math.floor(Math.random() * entradas.length)];
      if (otra !== e) e.v = [otra.v, otra.v / 2, otra.v * 2, otra.v + 1, otra.v - 1, otra.v / 2 + 1, otra.v / 2 - 1][Math.floor(Math.random() * 7)];
    });
    if (!medir()) motivo = k === 0 ? 'distintaAhora' : 'distintaOtros';
  }
  entradas.forEach((e, i) => { e.v = originales[i]; });
  cel.ast = astEst; cel.v = vEst;
  b.motor.recalcular();
  return motivo;
}

const nodos = (ast, t) => { const r = []; if (ast) recorrer(ast, n => { if (n.t === t) r.push(n); }); return r; };
const mismoRango = (n, q) => n.t === 'rango' && Math.min(n.a.c, n.b.c) === q.c1 && Math.max(n.a.c, n.b.c) === q.c2 && Math.min(n.a.f, n.b.f) === q.f1 && Math.max(n.a.f, n.b.f) === q.f2;
const sinFormula = cel => no(cel && cel.v !== null ? 'valorFijo' : 'vacia');

export const VALIDADORES = {
  valor_celda(r, ctx) {
    const cel = celdaDe(ctx, r), v = resultado(cel);
    if (r.sinFormula && (!cel || cel.ast)) return no('esFormula');
    if (r.valorTexto && typeof v !== 'string') return no('distinto');
    if ('valor' in r) return igual(v, r.valor, { ...r, tol: r.tolerancia }) ? OK : no(v === null ? 'vacia' : 'distinto');
    return v === null || v === '' ? no('vacia') : OK;
  },
  es_formula(r, ctx) { const cel = celdaDe(ctx, r); return cel && cel.ast ? OK : sinFormula(cel); },
  usa_funcion(r, ctx) {
    const cel = celdaDe(ctx, r);
    return cel && cel.ast && nodos(cel.ast, 'fn').some(n => n.n === r.funcion) ? OK : no('defecto');
  },
  no_usa_funcion(r, ctx) {
    const cel = celdaDe(ctx, r);
    return cel && cel.ast && nodos(cel.ast, 'fn').some(n => n.n === r.funcion) ? no('defecto') : OK;
  },
  referencia(r, ctx) {
    const cel = celdaDe(ctx, r), p = parseDir(r.a);
    const refs = nodos(cel && cel.ast, 'ref').filter(n => n.c === p.c && n.f === p.f);
    if (!refs.length) return no('noUsa');
    const cumple = n => r.modo === 'absoluta' ? n.absC && n.absF : r.modo === 'relativa' ? !n.absC && !n.absF : n.absC !== n.absF;
    return refs.every(cumple) ? OK : no('defecto');
  },
  usa_rango(r, ctx) {
    const cel = celdaDe(ctx, r), q = parseRango(r.rango);
    if (!cel || !cel.ast) return sinFormula(cel);
    return nodos(cel.ast, 'rango').some(n => mismoRango(n, q)) ? OK : no('defecto');
  },
  usa_nombre(r, ctx) {
    const cel = celdaDe(ctx, r);
    return nodos(cel && cel.ast, 'nombre').some(n => n.v.toLowerCase() === r.nombre.toLowerCase()) ? OK : no('defecto');
  },
  formula_equivalente(r, ctx) {
    const cel = celdaDe(ctx, r), p = parseDir(r.celda);
    if (!cel || !cel.ast) return sinFormula(cel);
    const m = equivalente(ctx, r, p.c, p.f, ctx.motor.analizarCanon(r.referencia));
    return m ? no(m) : OK;
  },
  rango_relleno(r, ctx) {
    const q = parseRango(r.rango), h = hojaDe(ctx, r), ref = ctx.motor.analizarCanon(r.referenciaPrimeraFila);
    let motivo = null;
    cada(q, (c, f) => {
      const cel = obtener(h, c, f);
      if (!cel || (cel.v === null && !cel.ast)) motivo = 'vacia';
      else if (!cel.ast) motivo = 'valorFijo';
      else motivo = equivalente(ctx, r, c, f, desplazar(ref, c - q.c1, f - q.f1));
      return !motivo;
    });
    return motivo ? no(motivo) : OK;
  },
  rango_valores_fijos(r, ctx) {
    const h = hojaDe(ctx, r);
    let hay = false;
    cada(parseRango(r.rango), (c, f) => { const cel = obtener(h, c, f); if (cel && !cel.ast && cel.v !== null) hay = true; });
    return hay ? OK : no('defecto');
  },
  formato(r, ctx) {
    const h = hojaDe(ctx, r), q = areaRegla(r);
    const bien = cada(q, (c, f) => {
      const m = (obtener(h, c, f) || { fmt: {} }).fmt;
      return Object.entries(r.fmt).every(([k, v]) => v === true ? !!m[k] : v === false || v === null ? !m[k] : m[k] === v);
    });
    return bien ? OK : no('defecto');
  },
  seleccion(r, ctx) {
    const h = hojaActiva(ctx.libro), q = parseRango(r.rango), s = h.sel;
    return h.nombre === (r.hoja || ctx.hojaNombre) && s.c1 === q.c1 && s.f1 === q.f1 && s.c2 === q.c2 && s.f2 === q.f2 ? OK : no('defecto');
  },
  comando_ejecutado(r, ctx) { return ctx.comandos && ctx.comandos.has(r.id) ? OK : no('defecto'); },
  nombre_definido(r, ctx) {
    const d = ctx.libro.nombres.get(r.nombre.toLowerCase());
    if (!d) return no('defecto');
    if (!r.rango) return OK;
    const q = parseRango(r.rango);
    return d.c1 === q.c1 && d.f1 === q.f1 && d.c2 === q.c2 && d.f2 === q.f2 ? OK : no('defecto');
  },
  hoja(r, ctx) { return ctx.libro.hojas.some(h => h.nombre.toLowerCase() === r.nombre.toLowerCase()) ? OK : no('defecto'); }
};

export function validar(regla, ctx) {
  const v = VALIDADORES[regla.tipo];
  if (!v) return no('tipoDesconocido');
  try { return v(regla, ctx); } catch (e) { return no('defecto'); }
}

// ---------- detectores de errores comunes ----------
// Reciben (ctx, paso). ctx.rech = { texto, codigo } cuando la fórmula fue rechazada al escribirla.
const sinCadenas = t => t.replace(/"[^"]*"?/g, '""');
function objetivo(ctx, paso) {
  const reglas = (paso.validar && paso.validar.reglas) || [];
  // Se prefiere la regla que trae la fórmula de referencia: es la que define el paso.
  const r = reglas.find(x => x.referencia || x.referenciaPrimeraFila) || reglas.find(x => x.celda) || reglas.find(x => x.rango);
  if (!r) return {};
  const q = areaRegla(r);
  return { regla: r, cel: obtener(hojaDe(ctx, r), q.c1, q.f1), c: q.c1, f: q.f1 };
}
const pareceFormula = v => typeof v === 'string' && (/^\s*[A-Za-zÀ-ɏ.]+\s*\(.*\)\s*$/.test(v) || /^\s*\$?[A-Za-z]{1,2}\$?\d+\s*[-+*\/<>=]/.test(v));

export const DETECTORES = {
  'olvido-signo-igual': (ctx, paso) => { const { cel } = objetivo(ctx, paso); return !!cel && !cel.ast && pareceFormula(cel.v); },
  'valor-en-vez-de-formula': (ctx, paso) => {
    const { cel } = objetivo(ctx, paso);
    return !!cel && !cel.ast && cel.v !== null && !pareceFormula(cel.v);
  },
  'separador-incorrecto': ctx => !!ctx.rech && ctx.reg.sepArg === ';' && /\(.*,/.test(sinCadenas(ctx.rech.texto)),
  'comillas-sin-cerrar': ctx => !!ctx.rech && ctx.rech.codigo === 'comillas',
  'parentesis-sin-cerrar': ctx => !!ctx.rech && ctx.rech.codigo === 'parentesis',
  'texto-sin-comillas': (ctx, paso) => {
    if (ctx.rech) return /[(;]\s*[A-Za-zÀ-ɏ]+(\s+[A-Za-zÀ-ɏ]+)+\s*[;)]/.test(sinCadenas(ctx.rech.texto));
    const { cel } = objetivo(ctx, paso);
    return nodos(cel && cel.ast, 'nombre').some(n => !ctx.libro.nombres.has(n.v.toLowerCase()));
  },
  'rango-incompleto': (ctx, paso) => {
    const { cel, regla } = objetivo(ctx, paso);
    const texto = regla && (regla.referencia || regla.referenciaPrimeraFila);
    if (!cel || !cel.ast || !texto) return false;
    const esperados = nodos(ctx.motor.analizarCanon(texto), 'rango'), usados = nodos(cel.ast, 'rango');
    const caja = n => ({ c1: Math.min(n.a.c, n.b.c), c2: Math.max(n.a.c, n.b.c), f1: Math.min(n.a.f, n.b.f), f2: Math.max(n.a.f, n.b.f) });
    return esperados.some(e => {
      const E = caja(e);
      return usados.some(u => { const U = caja(u); return !mismoRango(u, E) && U.c1 >= E.c1 && U.c2 <= E.c2 && U.f1 >= E.f1 && U.f2 <= E.f2; });
    });
  },
  'argumentos-si-invertidos': (ctx, paso) => {
    const { cel, regla, c, f } = objetivo(ctx, paso);
    if (!cel || !cel.ast || !regla || !regla.referencia) return false;
    let n = cel.ast;
    while (n.t === 'par') n = n.a;
    if (n.t !== 'fn' || n.n !== 'IF' || n.args.length !== 3) return false;
    // ¿La fórmula de referencia con sus ramas cambiadas se comporta como la del estudiante?
    let ref = ctx.motor.analizarCanon(regla.referencia);
    while (ref.t === 'par') ref = ref.a;
    if (ref.t !== 'fn' || ref.n !== 'IF' || ref.args.length !== 3) return false;
    const cambiada = { ...ref, args: [ref.args[0], ref.args[2], ref.args[1]] };
    return !equivalente(ctx, regla, c, f, cambiada);
  }
};

export { dir };

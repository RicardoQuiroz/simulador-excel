// Catálogo de funciones. Cada entrada: [mínArgs, máxArgs, implementación, categoría].
// Los argumentos llegan como escalares o como matrices (las referencias siempre son matrices).
// Los errores de Excel se propagan lanzando un objeto Err.

export class Err { constructor(c) { this.c = c; } }
const E = c => new Err(c);
const esMat = Array.isArray;
const mat = a => esMat(a) ? a : [[a === undefined ? null : a]];

export function esc(a) {
  if (esMat(a)) a = a[0][0];
  if (a instanceof Err) throw a;
  return a === undefined ? null : a;
}
export function num(v) {
  v = esc(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return 0;
  const t = v.trim();
  if (t !== '' && !isNaN(t)) return Number(t);
  throw E('#VALUE!');
}
export function bool(v) {
  v = esc(v);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  const u = v.toUpperCase();
  if (u === 'TRUE' || u === 'VERDADERO') return true;
  if (u === 'FALSE' || u === 'FALSO') return false;
  throw E('#VALUE!');
}

const orden = v => typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3;
export function compara(a, b) {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = orden(a), rb = orden(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a < b ? -1 : a > b ? 1 : 0;
}

function* planos(args) {
  for (const a of args) {
    if (esMat(a)) { for (const fila of a) for (const v of fila) yield [v, true]; }
    else yield [a === undefined ? null : a, false];
  }
}
// Números de una lista de argumentos: en rangos se ignoran textos y lógicos, como en Excel.
function numeros(args) {
  const r = [];
  for (const [v, enRango] of planos(args)) {
    if (v instanceof Err) throw v;
    if (typeof v === 'number') r.push(v);
    else if (!enRango && v !== null) r.push(num(v));
  }
  return r;
}
function logicos(args) {
  const r = [];
  for (const [v, enRango] of planos(args)) {
    if (v instanceof Err) throw v;
    if (typeof v === 'boolean') r.push(v);
    else if (typeof v === 'number') r.push(v !== 0);
    else if (typeof v === 'string' && !enRango) r.push(bool(v));
  }
  if (!r.length) throw E('#VALUE!');
  return r;
}
const sumar = n => n.reduce((s, x) => s + x, 0);

function redondear(x, d) {
  d = Math.trunc(d);
  const r = Number(Math.round(Number(Math.abs(x) + 'e' + d)) + 'e' + (-d));
  return isNaN(r) ? x : Math.sign(x) * r;
}

// Criterios de CONTAR.SI, SUMAR.SI, etc.: ">100", "<>0", "Ana", "A*"
function criterio(c) {
  c = esc(c);
  let op = '=', v = c;
  if (typeof c === 'string') {
    const m = /^(<=|>=|<>|<|>|=)([\s\S]*)$/.exec(c);
    if (m) { op = m[1]; v = m[2]; }
    const t = v.trim(), u = t.toUpperCase();
    if (t !== '' && !isNaN(t)) v = Number(t);
    else if (u === 'VERDADERO' || u === 'TRUE') v = true;
    else if (u === 'FALSO' || u === 'FALSE') v = false;
  }
  if (v === null) v = 0;
  const veredicto = k => op === '=' ? k === 0 : op === '<>' ? k !== 0 : op === '<' ? k < 0 : op === '>' ? k > 0 : op === '<=' ? k <= 0 : k >= 0;
  if (typeof v === 'string') {
    const re = new RegExp('^' + v.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return x => {
      if (x instanceof Err) return false;
      const s = x === null ? '' : typeof x === 'string' ? x : null;
      if (op === '=') return s !== null && re.test(s);
      if (op === '<>') return !(s !== null && re.test(s));
      return typeof x === 'string' && veredicto(compara(x, v));
    };
  }
  return x => {
    if (x instanceof Err || x === null || typeof x !== typeof v) return op === '<>';
    return veredicto(compara(x, v));
  };
}
// Posiciones [fila, columna] que cumplen todos los pares (rango, criterio).
function mascara(pares, filas, cols) {
  const ms = [], cs = [];
  for (let k = 0; k + 1 < pares.length; k += 2) { ms.push(mat(pares[k])); cs.push(criterio(pares[k + 1])); }
  if (filas === undefined) { filas = ms[0].length; cols = ms[0][0].length; }
  for (const m of ms) if (m.length !== filas || m[0].length !== cols) throw E('#VALUE!');
  const r = [];
  for (let i = 0; i < filas; i++) for (let j = 0; j < cols; j++) {
    let pasa = true;
    for (let k = 0; k < ms.length && pasa; k++) pasa = cs[k](ms[k][i][j]);
    if (pasa) r.push([i, j]);
  }
  return r;
}
function sumaEn(m, pos) {
  let t = 0, n = 0;
  for (const [i, j] of pos) {
    const v = m[i] ? m[i][j] : undefined;
    if (v instanceof Err) throw v;
    if (typeof v === 'number') { t += v; n++; }
  }
  return [t, n];
}

function buscar(val, lista, aprox) {
  if (!aprox) {
    for (let i = 0; i < lista.length; i++) {
      const x = lista[i];
      if (x !== null && !(x instanceof Err) && typeof x === typeof val && compara(x, val) === 0) return i;
    }
    return -1;
  }
  let r = -1;
  for (let i = 0; i < lista.length; i++) {
    const x = lista[i];
    if (x === null || x instanceof Err || typeof x !== typeof val) continue;
    if (compara(x, val) <= 0) r = i; else break;
  }
  return r;
}
const dato = v => { if (v instanceof Err) throw v; return v === undefined ? null : v; };

// ---------- fechas (número de serie, como Excel) ----------
const EPOCA = Date.UTC(1899, 11, 30);
export const aSerie = (a, m, d) => Math.round((Date.UTC(a, m - 1, d) - EPOCA) / 864e5);
export function deSerie(s) {
  const x = new Date(EPOCA + Math.floor(s) * 864e5);
  return { a: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), ds: x.getUTCDay() };
}
const hoy = () => { const h = new Date(); return aSerie(h.getFullYear(), h.getMonth() + 1, h.getDate()); };

const txt = (a, x) => x.texto(esc(a));
const largo = a => { const n = a === undefined ? 1 : Math.trunc(num(a)); if (n < 0) throw E('#VALUE!'); return n; };

export const FUNCIONES = {
  // Matemáticas
  SUM: [1, 255, a => sumar(numeros(a)), 'mat'],
  ROUND: [2, 2, a => redondear(num(a[0]), num(a[1])), 'mat'],
  INT: [1, 1, a => Math.floor(num(a[0])), 'mat'],
  ABS: [1, 1, a => Math.abs(num(a[0])), 'mat'],
  RAND: [0, 0, () => Math.random(), 'mat'],
  RANDBETWEEN: [2, 2, a => {
    const lo = Math.ceil(num(a[0])), hi = Math.floor(num(a[1]));
    if (lo > hi) throw E('#NUM!');
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }, 'mat'],
  SUMIF: [2, 3, a => sumaEn(mat(a[2] === undefined || a[2] === null ? a[0] : a[2]), mascara([a[0], a[1]]))[0], 'mat'],
  SUMIFS: [3, 255, a => {
    const s = mat(a[0]);
    return sumaEn(s, mascara(a.slice(1), s.length, s[0].length))[0];
  }, 'mat'],

  // Estadísticas
  AVERAGE: [1, 255, a => { const n = numeros(a); if (!n.length) throw E('#DIV/0!'); return sumar(n) / n.length; }, 'est'],
  MAX: [1, 255, a => { const n = numeros(a); return n.length ? Math.max(...n) : 0; }, 'est'],
  MIN: [1, 255, a => { const n = numeros(a); return n.length ? Math.min(...n) : 0; }, 'est'],
  COUNT: [1, 255, a => {
    let k = 0;
    for (const [v, enRango] of planos(a)) {
      if (typeof v === 'number') k++;
      else if (!enRango && (typeof v === 'boolean' || (typeof v === 'string' && v.trim() !== '' && !isNaN(v)))) k++;
    }
    return k;
  }, 'est'],
  COUNTA: [1, 255, a => { let k = 0; for (const [v] of planos(a)) if (v !== null) k++; return k; }, 'est'],
  COUNTBLANK: [1, 1, a => { let k = 0; for (const [v] of planos(a)) if (v === null || v === '') k++; return k; }, 'est'],
  COUNTIF: [2, 2, a => mascara(a).length, 'est'],
  COUNTIFS: [2, 254, a => mascara(a).length, 'est'],
  AVERAGEIF: [2, 3, a => {
    const [t, n] = sumaEn(mat(a[2] === undefined || a[2] === null ? a[0] : a[2]), mascara([a[0], a[1]]));
    if (!n) throw E('#DIV/0!');
    return t / n;
  }, 'est'],

  // Lógicas (SI y SI.ERROR las resuelve el motor porque no evalúan todos sus argumentos)
  IF: [2, 3, null, 'log'],
  IFERROR: [2, 2, null, 'log'],
  AND: [1, 255, a => logicos(a).every(Boolean), 'log'],
  OR: [1, 255, a => logicos(a).some(Boolean), 'log'],
  NOT: [1, 1, a => !bool(a[0]), 'log'],

  // Búsqueda y referencia
  VLOOKUP: [3, 4, a => {
    const v = esc(a[0]), t = mat(a[1]), col = Math.trunc(num(a[2]));
    const aprox = a[3] === undefined ? true : bool(a[3]);
    if (col < 1) throw E('#VALUE!');
    if (col > t[0].length) throw E('#REF!');
    const i = buscar(v, t.map(f => f[0]), aprox);
    if (i < 0) throw E('#N/A');
    return dato(t[i][col - 1]);
  }, 'bus'],
  HLOOKUP: [3, 4, a => {
    const v = esc(a[0]), t = mat(a[1]), fila = Math.trunc(num(a[2]));
    const aprox = a[3] === undefined ? true : bool(a[3]);
    if (fila < 1) throw E('#VALUE!');
    if (fila > t.length) throw E('#REF!');
    const j = buscar(v, t[0], aprox);
    if (j < 0) throw E('#N/A');
    return dato(t[fila - 1][j]);
  }, 'bus'],
  INDEX: [2, 3, a => {
    const m = mat(a[0]);
    let f = Math.trunc(num(a[1])), c = a[2] === undefined ? undefined : Math.trunc(num(a[2]));
    if (c === undefined) { if (m.length === 1) { c = f; f = 1; } else c = 1; }
    if (f === 0) f = 1;
    if (c === 0) c = 1;
    const v = m[f - 1] ? m[f - 1][c - 1] : undefined;
    if (v === undefined) throw E('#REF!');
    return dato(v);
  }, 'bus'],
  MATCH: [2, 3, a => {
    const v = esc(a[0]), m = mat(a[1]);
    const lista = m.length === 1 ? m[0] : m.map(f => f[0]);
    const tipo = a[2] === undefined ? 1 : num(a[2]);
    let i = -1;
    if (tipo === 0) i = buscar(v, lista, false);
    else if (tipo > 0) i = buscar(v, lista, true);
    else for (let k = 0; k < lista.length; k++) {
      const x = lista[k];
      if (x === null || typeof x !== typeof v) continue;
      if (compara(x, v) >= 0) i = k; else break;
    }
    if (i < 0) throw E('#N/A');
    return i + 1;
  }, 'bus'],

  // Texto
  CONCATENATE: [1, 255, (a, x) => a.map(v => txt(v, x)).join(''), 'tex'],
  LEFT: [1, 2, (a, x) => txt(a[0], x).slice(0, largo(a[1])), 'tex'],
  RIGHT: [1, 2, (a, x) => { const n = largo(a[1]), s = txt(a[0], x); return n ? s.slice(-n) : ''; }, 'tex'],
  MID: [3, 3, (a, x) => {
    const ini = Math.trunc(num(a[1])), n = Math.trunc(num(a[2]));
    if (ini < 1 || n < 0) throw E('#VALUE!');
    return txt(a[0], x).substr(ini - 1, n);
  }, 'tex'],
  LEN: [1, 1, (a, x) => txt(a[0], x).length, 'tex'],
  UPPER: [1, 1, (a, x) => txt(a[0], x).toUpperCase(), 'tex'],
  LOWER: [1, 1, (a, x) => txt(a[0], x).toLowerCase(), 'tex'],
  TRIM: [1, 1, (a, x) => txt(a[0], x).trim().replace(/ +/g, ' '), 'tex'],

  // Fecha y hora
  TODAY: [0, 0, hoy, 'fec'],
  NOW: [0, 0, () => { const h = new Date(); return hoy() + (h.getHours() * 3600 + h.getMinutes() * 60 + h.getSeconds()) / 86400; }, 'fec'],
  YEAR: [1, 1, a => deSerie(num(a[0])).a, 'fec'],
  MONTH: [1, 1, a => deSerie(num(a[0])).m, 'fec'],
  DAY: [1, 1, a => deSerie(num(a[0])).d, 'fec']
};

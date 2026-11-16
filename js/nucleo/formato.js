// Conversión entre lo que el usuario escribe, lo que se guarda y lo que se muestra.

import { Err, aSerie, deSerie } from '../formulas/funciones.js';

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dos = n => String(n).padStart(2, '0');
const agrupar = (entero, sep) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

export function numGeneral(v, reg) {
  let s = String(parseFloat(v.toPrecision(10)));
  if (s.includes('e')) s = s.toUpperCase();
  return s.replace('.', reg.sepDec);
}
function fijo(v, dec, miles, reg) {
  const [e, d] = Math.abs(v).toFixed(dec).split('.');
  const cuerpo = (miles ? agrupar(e, reg.sepMiles) : e) + (d ? reg.sepDec + d : '');
  return (v < 0 && /[1-9]/.test(cuerpo) ? '-' : '') + cuerpo;
}
function fechaCorta(v) { const x = deSerie(v); return dos(x.d) + '/' + dos(x.m) + '/' + x.a; }

// Texto que se ve en la celda.
export function mostrar(v, fmt, reg) {
  if (v === null || v === undefined) return '';
  if (v instanceof Err) return reg.errores[v.c] || v.c;
  if (typeof v === 'boolean') return reg.logicos[v ? 'TRUE' : 'FALSE'];
  if (typeof v === 'string') return v;
  fmt = fmt || {};
  switch (fmt.num) {
    case 'numero': return fijo(v, fmt.dec === undefined ? 2 : fmt.dec, !!fmt.miles, reg);
    case 'moneda': return (v < 0 ? '-' : '') + reg.moneda + fijo(Math.abs(v), fmt.dec === undefined ? 2 : fmt.dec, true, reg);
    case 'porcentaje': return fijo(v * 100, fmt.dec === undefined ? 0 : fmt.dec, false, reg) + '%';
    case 'fecha': return fechaCorta(v);
    case 'fechaLarga': {
      const x = deSerie(v);
      return reg.dias[(x.ds + 6) % 7] + ', ' + x.d + ' de ' + reg.meses[x.m - 1] + ' de ' + x.a;
    }
    case 'hora': {
      const s = Math.round((v - Math.floor(v)) * 86400);
      return dos(Math.floor(s / 3600) % 24) + ':' + dos(Math.floor(s / 60) % 60) + ':' + dos(s % 60);
    }
    default:
      return fmt.dec !== undefined ? fijo(v, fmt.dec, !!fmt.miles, reg) : numGeneral(v, reg);
  }
}

export const alineacionNatural = v =>
  typeof v === 'number' ? 'der' : (typeof v === 'boolean' || v instanceof Err) ? 'centro' : 'izq';

// Texto que aparece en la barra de fórmulas y al editar.
export function textoEdicion(cel, motor, reg) {
  if (!cel) return '';
  if (cel.ast) return '=' + motor.aLocal(cel.ast);
  const v = cel.v;
  if (v === null) return '';
  if (typeof v === 'boolean') return reg.logicos[v ? 'TRUE' : 'FALSE'];
  if (typeof v === 'number') {
    if (cel.fmt.num === 'porcentaje') return numGeneral(parseFloat((v * 100).toPrecision(12)), reg) + '%';
    if (cel.fmt.num === 'fecha' || cel.fmt.num === 'fechaLarga') return fechaCorta(v);
    return numGeneral(v, reg);
  }
  return v;
}

// Interpreta lo que el usuario escribió. Devuelve { v, ast, fmt? }.
export function interpretar(texto, fmt, reg, motor) {
  if (texto === '') return { v: null, ast: null };
  if (fmt && fmt.num === 'texto') return { v: texto, ast: null };
  // Los teléfonos y algunos programas cambian las comillas rectas por tipográficas: se aceptan igual.
  if (texto[0] === '=') texto = texto.replace(/[“”„«»]/g, '"');
  if (texto[0] === '=' && texto.length > 1) return { v: null, ast: motor.analizarLocal(texto.slice(1)) };
  if (texto[0] === "'") return { v: texto.slice(1), ast: null };

  const t = texto.trim();
  const general = !fmt || !fmt.num;

  const re = reg._reNum || (reg._reNum = new RegExp(
    '^(-)?\\s*(' + escRe(reg.moneda) + ')?\\s*(\\d{1,3}(?:' + escRe(reg.sepMiles) + '\\d{3})+|\\d*)(?:' +
    escRe(reg.sepDec) + '(\\d*))?\\s*(%)?$'));
  const m = re.exec(t);
  if (m && (m[3] || m[4])) {
    let v = parseFloat((m[3] || '0').split(reg.sepMiles).join('') + '.' + (m[4] || '0'));
    if (m[1]) v = -v;
    const r = { v, ast: null };
    if (m[5]) { r.v = parseFloat((v / 100).toPrecision(15)); if (general) r.fmt = { num: 'porcentaje', dec: (m[4] || '').length }; }
    else if (m[2] && general) r.fmt = { num: 'moneda', dec: 2 };
    return r;
  }
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(t)) return { v: Number(t), ast: null };

  const u = t.toUpperCase();
  if (u === reg.logicos.TRUE) return { v: true, ast: null };
  if (u === reg.logicos.FALSE) return { v: false, ast: null };

  const f = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2}|\d{4}))?$/.exec(t);
  if (f) {
    const d = +f[1], mes = +f[2];
    let a = f[3] === undefined ? new Date().getFullYear() : +f[3];
    if (f[3] && f[3].length === 2) a += a < 30 ? 2000 : 1900;
    const serie = aSerie(a, mes, d), x = deSerie(serie);
    if (x.d === d && x.m === mes && x.a === a) {
      const r = { v: serie, ast: null };
      if (general) r.fmt = { num: 'fecha' };
      return r;
    }
  }
  return { v: texto, ast: null };
}

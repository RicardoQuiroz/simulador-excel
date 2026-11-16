// Analizador de fórmulas: texto -> árbol (AST) -> texto.
// Trabaja con "dialectos": el canónico (nombres en inglés, coma) y el regional.

export const MAXC = 26;   // columnas A..Z
export const MAXF = 200;  // filas 1..200

export class ErrorFormula extends Error {
  constructor(codigo, detalle) { super(codigo); this.codigo = codigo; this.detalle = detalle; }
}

export const ERRORES = ['#DIV/0!', '#N/A', '#NAME?', '#VALUE!', '#REF!', '#NUM!', '#CIRC!'];
const DESCONOCIDA = '__'; // prefijo de funciones que no existen en el idioma activo

// ---------- direcciones ----------
export function colALetra(n) {
  let s = ''; n++;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
export function letraACol(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
export const dir = (c, f) => colALetra(c) + (f + 1);

export function parseDir(t) {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5})$/.exec(t);
  if (!m) return null;
  const c = letraACol(m[2]), f = +m[4] - 1;
  if (c >= MAXC || f < 0 || f >= MAXF) return null;
  return { c, f, absC: !!m[1], absF: !!m[3] };
}
export function parseRango(t) {
  const p = String(t).split(':');
  if (p.length > 2) return null;
  const a = parseDir(p[0].trim()), b = p[1] === undefined ? a : parseDir(p[1].trim());
  if (!a || !b) return null;
  return { c1: Math.min(a.c, b.c), f1: Math.min(a.f, b.f), c2: Math.max(a.c, b.c), f2: Math.max(a.f, b.f) };
}
export const textoRango = r =>
  (r.c1 === r.c2 && r.f1 === r.f2) ? dir(r.c1, r.f1) : dir(r.c1, r.f1) + ':' + dir(r.c2, r.f2);

// ---------- dialectos ----------
export const CANON = {
  sepArg: ',', sepDec: '.',
  canonFn: n => n, nombreFn: n => n,
  logicos: { TRUE: 'TRUE', FALSE: 'FALSE' },
  errores: {}
};

export function crearDialecto(reg) {
  const aCanon = new Map(), deCanon = new Map();
  for (const [k, v] of Object.entries(reg.funciones)) { aCanon.set(v[0], k); deCanon.set(k, v[0]); }
  return {
    sepArg: reg.sepArg, sepDec: reg.sepDec,
    // Un nombre en inglés escrito en una hoja en español no existe: da #¿NOMBRE?
    canonFn: n => aCanon.get(n) || (deCanon.has(n) ? DESCONOCIDA + n : n),
    nombreFn: n => n.startsWith(DESCONOCIDA) ? n.slice(DESCONOCIDA.length) : (deCanon.get(n) || n),
    logicos: reg.logicos,
    errores: reg.errores
  };
}

// ---------- léxico ----------
const RE_ID = /[$A-Za-z_À-ɏ][\w$.À-ɏ]*/y;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokenizar(s, d) {
  const sd = escRe(d.sepDec);
  const reNum = d._reNum || (d._reNum = new RegExp('(?:\\d+(?:' + sd + '\\d+)?|' + sd + '\\d+)(?:[eE][+-]?\\d+)?', 'y'));
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === ' ' || ch === ' ') { i++; continue; }
    if (ch === '"') {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= n) throw new ErrorFormula('comillas');
        if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
        v += s[j++];
      }
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (ch === "'") {
      const j = s.indexOf("'!", i + 1);
      if (j < 0) throw new ErrorFormula('referencia');
      out.push({ t: 'hoja', v: s.slice(i + 1, j) }); i = j + 2; continue;
    }
    if (ch === '#') {
      const resto = s.slice(i).toUpperCase();
      let ok = false;
      for (const canon of ERRORES) {
        const loc = (d.errores[canon] || canon).toUpperCase();
        if (resto.startsWith(loc)) { out.push({ t: 'err', v: canon }); i += loc.length; ok = true; break; }
      }
      if (!ok) throw new ErrorFormula('simbolo');
      continue;
    }
    reNum.lastIndex = i;
    let m = reNum.exec(s);
    if (m) { out.push({ t: 'num', v: parseFloat(m[0].replace(d.sepDec, '.')) }); i = reNum.lastIndex; continue; }
    RE_ID.lastIndex = i;
    m = RE_ID.exec(s);
    if (m) {
      i = RE_ID.lastIndex;
      if (s[i] === '!') { out.push({ t: 'hoja', v: m[0] }); i++; } else out.push({ t: 'id', v: m[0] });
      continue;
    }
    const dos = s.substr(i, 2);
    if (dos === '<=' || dos === '>=' || dos === '<>') { out.push({ t: 'op', v: dos }); i += 2; continue; }
    if (ch === d.sepArg) { out.push({ t: 'op', v: ';' }); i++; continue; }
    if ('+-*/^&=<>%():'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new ErrorFormula('simbolo', ch);
  }
  return out;
}

// ---------- sintaxis ----------
const COMPARADORES = ['=', '<>', '<', '>', '<=', '>='];

export function analizar(texto, d = CANON) {
  const tk = tokenizar(texto, d);
  let p = 0;
  const esOp = v => tk[p] && tk[p].t === 'op' && tk[p].v === v;
  const comer = v => { if (!esOp(v)) throw new ErrorFormula(v === ')' ? 'parentesis' : 'sintaxis'); p++; };
  const nivel = (ops, sig) => () => {
    let a = sig();
    while (tk[p] && tk[p].t === 'op' && ops.includes(tk[p].v)) { const op = tk[p++].v; a = { t: 'bin', op, a, b: sig() }; }
    return a;
  };
  const refDe = (tok, hoja) => {
    const r = tok && tok.t === 'id' && parseDir(tok.v);
    return r ? (hoja ? { t: 'ref', ...r, hoja } : { t: 'ref', ...r }) : null;
  };
  const rango = a => {
    if (!esOp(':')) return a;
    const b = refDe(tk[p + 1]);
    if (!b) throw new ErrorFormula('referencia');
    p += 2;
    return { t: 'rango', a, b };
  };
  function prim() {
    const t = tk[p];
    if (!t) throw new ErrorFormula('incompleta');
    if (t.t === 'num' || t.t === 'str' || t.t === 'err') { p++; return { t: t.t, v: t.v }; }
    if (t.t === 'op' && t.v === '(') { p++; const a = comp(); comer(')'); return { t: 'par', a }; }
    if (t.t === 'hoja') {
      p++;
      const r = refDe(tk[p], t.v);
      if (!r) throw new ErrorFormula('referencia');
      p++;
      return rango(r);
    }
    if (t.t === 'id') {
      p++;
      if (esOp('(')) {
        p++;
        const args = [];
        if (esOp(')')) p++;
        else for (;;) {
          if (esOp(';') || esOp(')')) args.push({ t: 'vacio' }); else args.push(comp());
          if (esOp(';')) { p++; continue; }
          comer(')'); break;
        }
        return { t: 'fn', n: d.canonFn(t.v.toUpperCase()), args };
      }
      const r = refDe(t);
      if (r) return rango(r);
      const u = t.v.toUpperCase();
      if (u === d.logicos.TRUE.toUpperCase()) return { t: 'bool', v: true };
      if (u === d.logicos.FALSE.toUpperCase()) return { t: 'bool', v: false };
      if (t.v.includes('$') || /^[A-Za-z]{1,3}\d+$/.test(t.v)) throw new ErrorFormula('referencia');
      return { t: 'nombre', v: t.v };
    }
    throw new ErrorFormula(t.v === ')' ? 'parentesis' : 'sintaxis');
  }
  function post() { let a = prim(); while (esOp('%')) { p++; a = { t: 'pct', a }; } return a; }
  function unario() {
    if (esOp('-') || esOp('+')) { const op = tk[p++].v; return { t: 'un', op, a: unario() }; }
    return post();
  }
  const pot = nivel(['^'], unario);
  const mult = nivel(['*', '/'], pot);
  const suma = nivel(['+', '-'], mult);
  const concat = nivel(['&'], suma);
  const comp = nivel(COMPARADORES, concat);

  const ast = comp();
  if (p < tk.length) throw new ErrorFormula(tk[p].t === 'op' && tk[p].v === ')' ? 'parentesis' : 'sintaxis');
  return ast;
}

// ---------- árbol -> texto ----------
const refTxt = r => (r.absC ? '$' : '') + colALetra(r.c) + (r.absF ? '$' : '') + (r.f + 1);
const hojaTxt = h => /^[A-Za-z_À-ɏ][\w.À-ɏ]*$/.test(h) && !parseDir(h) ? h : "'" + h + "'";

export function serializar(n, d = CANON) {
  const s = x => serializar(x, d);
  switch (n.t) {
    case 'num': return String(n.v).replace('.', d.sepDec);
    case 'str': return '"' + n.v.replace(/"/g, '""') + '"';
    case 'bool': return d.logicos[n.v ? 'TRUE' : 'FALSE'];
    case 'err': return d.errores[n.v] || n.v;
    case 'ref': return (n.hoja ? hojaTxt(n.hoja) + '!' : '') + refTxt(n);
    case 'rango': return s(n.a) + ':' + refTxt(n.b);
    case 'nombre': return n.v;
    case 'fn': return d.nombreFn(n.n) + '(' + n.args.map(s).join(d.sepArg) + ')';
    case 'bin': return s(n.a) + n.op + s(n.b);
    case 'un': return n.op + s(n.a);
    case 'pct': return s(n.a) + '%';
    case 'par': return '(' + s(n.a) + ')';
    default: return '';
  }
}

// ---------- recorridos ----------
export function recorrer(n, f) {
  f(n);
  if (n.t === 'fn') n.args.forEach(a => recorrer(a, f));
  else if (n.t === 'bin') { recorrer(n.a, f); recorrer(n.b, f); }
  else if (n.t === 'un' || n.t === 'pct' || n.t === 'par') recorrer(n.a, f);
  else if (n.t === 'rango') { f(n.a); f(n.b); }
}

export function transformar(n, f) {
  const r = f(n);
  if (r) return r;
  if (n.t === 'fn') return { ...n, args: n.args.map(a => transformar(a, f)) };
  if (n.t === 'bin') return { ...n, a: transformar(n.a, f), b: transformar(n.b, f) };
  if (n.t === 'un' || n.t === 'pct' || n.t === 'par') return { ...n, a: transformar(n.a, f) };
  return n;
}

// Desplaza las referencias relativas (copiar, pegar, rellenar).
export function desplazar(ast, dc, df) {
  if (!dc && !df) return ast;
  const mover = r => {
    const c = r.absC ? r.c : r.c + dc, f = r.absF ? r.f : r.f + df;
    return (c < 0 || f < 0 || c >= MAXC || f >= MAXF) ? null : { ...r, c, f };
  };
  const roto = { t: 'err', v: '#REF!' };
  return transformar(ast, n => {
    if (n.t === 'ref') return mover(n) || roto;
    if (n.t === 'rango') { const a = mover(n.a), b = mover(n.b); return a && b ? { t: 'rango', a, b } : roto; }
    return null;
  });
}

// F4: alterna A1 -> $A$1 -> A$1 -> $A1 en la referencia donde está el cursor.
export function alternarRef(v, pos) {
  const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g;
  let m;
  while ((m = re.exec(v))) {
    const ini = m.index, fin = ini + m[0].length;
    if (pos < ini || pos > fin) continue;
    const a = !!m[1], b = !!m[3];
    const sig = !a && !b ? ['$', '$'] : a && b ? ['', '$'] : !a && b ? ['$', ''] : ['', ''];
    const nuevo = sig[0] + m[2] + sig[1] + m[4];
    return { texto: v.slice(0, ini) + nuevo + v.slice(fin), pos: ini + nuevo.length };
  }
  return null;
}
